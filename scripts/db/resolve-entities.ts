/**
 * Phase 3 of the cross-source reconciliation plan
 * (.claude/plans/i-would-like-to-serialized-lake.md).
 *
 * Generic player entity-resolution engine for *new* sources. Reads the source's
 * raw table + blocking key from `meta.source_entity`, then matches its rows to
 * the master `unified_star.dim_player` identity:
 *   1. deterministic pass — normalized name + birth date (the community-standard
 *      djblechn-su recipe);
 *   2. probabilistic backstop — DuckDB jaro_winkler_similarity on name, gated by
 *      birth-date agreement when both sides have it.
 * Matches are written to `xref.player_xref`; misses to `xref.player_unresolved`
 * plus their best near-miss candidate to `audit.match_candidates`.
 *
 * Existing sources (bref / nba_api_sqlite / nba_stats) are already seeded by
 * build-xref.ts; this engine is for sources whose ids do NOT share the NBA/BBR
 * key space (e.g. ESPN, Spotrac).
 *
 *   bun run scripts/db/resolve-entities.ts --source espn            # dry run
 *   bun run scripts/db/resolve-entities.ts --source espn --apply
 *   optional: --threshold 0.92   (fuzzy name-similarity cutoff)
 */
import { DuckDBInstance } from '@duckdb/node-api';

const argv = process.argv.slice(2);
const getArg = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const sourceId = getArg('--source');
const threshold = Number(getArg('--threshold') ?? '0.92');
const dryRun = !argv.includes('--apply');

if (!sourceId) {
  console.error('Usage: resolve-entities.ts --source <source_id> [--threshold 0.92] [--apply]');
  process.exit(1);
}

// Name normalization. normFull keeps generational suffixes (Jr/Sr/II/...) so
// "ron harper jr" stays distinct from "ron harper"; normStrip removes them as a
// lower-confidence fallback (so "jimmy butler iii" can still reach "jimmy butler").
const normFull = (col: string) =>
  `trim(regexp_replace(lower(strip_accents(CAST(${col} AS VARCHAR))), '[^a-z0-9 ]', '', 'g'))`;
const normStrip = (col: string) =>
  `trim(regexp_replace(${normFull(col)}, '( jr| sr| ii| iii| iv| v)+$', ''))`;

const db = await DuckDBInstance.fromCache('./data/nba.duckdb');
const conn = await db.connect();
const q = async (sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJson();

// 1. Look up the source's player grain in the registry.
const reg = (await q(`
  SELECT raw_schema, raw_table, natural_key, blocking_key, source_id_column
  FROM meta.source_entity WHERE source_id = '${sourceId}' AND entity = 'player'
`)) as Array<Record<string, unknown>>;
if (reg.length === 0) {
  console.error(`No player entity registered for source '${sourceId}' in meta.source_entity.`);
  process.exit(1);
}
const r = reg[0];
const rawTable = `${r.raw_schema}.${r.raw_table}`;
const blocking = r.blocking_key as string[];
const idCol = (r.source_id_column as string) ?? (r.natural_key as string[])[0];

// Split blocking key into a name part (text cols) and an optional birth-date col.
const birthCol = blocking.find((c) => /birth/i.test(c));
const nameCols = blocking.filter((c) => c !== birthCol);
if (nameCols.length === 0) {
  console.error(`Source '${sourceId}' player blocking key has no name column: [${blocking}]`);
  process.exit(1);
}
const rawName = nameCols.map((c) => `COALESCE(CAST(${c} AS VARCHAR),'')`).join(" || ' ' || ");
const srcNameFull = normFull(rawName);
const srcNameStrip = normStrip(rawName);
const srcBirthExpr = birthCol ? `TRY_CAST(${birthCol} AS DATE)` : 'NULL::DATE';

console.log(`${dryRun ? '[DRY RUN] ' : ''}Resolving '${sourceId}' players against dim_player`);
console.log(
  `  raw: ${rawTable}  id: ${idCol}  name: [${nameCols}]  birth: ${birthCol ?? '(none)'}\n`,
);

// CTEs: distinct source players + master reference, then a tiered match.
// A match is only accepted when it resolves to exactly ONE master — when a name
// maps to several master rows (e.g. dim_player duplicates, or true namesakes),
// it is left unresolved and its candidates recorded, rather than guessed.
const cte = `
WITH src AS (
  SELECT DISTINCT CAST(${idCol} AS VARCHAR) AS source_key,
         ${srcNameFull} AS name_full, ${srcNameStrip} AS name_strip, ${srcBirthExpr} AS birth_date
  FROM ${rawTable}
  WHERE ${idCol} IS NOT NULL
),
mst AS (
  SELECT CAST(player_id AS VARCHAR) AS master_id,
         ${normFull('full_name')} AS name_full, ${normStrip('full_name')} AS name_strip, birth_date
  FROM unified_star.dim_player WHERE player_id IS NOT NULL
),
-- Tier 1: exact match on full name (suffix-sensitive) + birth-date gate.
ef AS (
  SELECT s.source_key, s.name_full, m.master_id
  FROM src s JOIN mst m
    ON s.name_full = m.name_full AND (s.birth_date IS NULL OR s.birth_date = m.birth_date)
),
ef1 AS (
  SELECT * FROM ef
  WHERE source_key IN (SELECT source_key FROM ef GROUP BY source_key HAVING count(DISTINCT master_id) = 1)
),
res1 AS (SELECT * FROM src WHERE source_key NOT IN (SELECT source_key FROM ef1)),
-- Tier 2: exact match on suffix-stripped name (lower confidence).
es AS (
  SELECT s.source_key, s.name_strip, m.master_id
  FROM res1 s JOIN mst m
    ON s.name_strip = m.name_strip AND (s.birth_date IS NULL OR s.birth_date = m.birth_date)
),
es1 AS (
  SELECT * FROM es
  WHERE source_key IN (SELECT source_key FROM es GROUP BY source_key HAVING count(DISTINCT master_id) = 1)
),
res2 AS (SELECT * FROM res1 WHERE source_key NOT IN (SELECT source_key FROM es1)),
-- Tier 3: fuzzy on full name, gated by birth date + shared initial.
fr AS (
  SELECT r.source_key, m.master_id, m.name_full AS master_name,
         jaro_winkler_similarity(r.name_full, m.name_full) AS sim
  FROM res2 r JOIN mst m
    ON (r.birth_date IS NULL OR m.birth_date IS NULL OR r.birth_date = m.birth_date)
   AND substr(r.name_full, 1, 1) = substr(m.name_full, 1, 1)
),
fbest AS (SELECT source_key, max(sim) AS best FROM fr GROUP BY source_key),
fuzzy_top AS (  -- rows at the top similarity; n_tied flags ambiguity
  SELECT fr.source_key, fr.master_id, fr.master_name, fr.sim,
         count(*) OVER (PARTITION BY fr.source_key) AS n_tied
  FROM fr JOIN fbest ON fr.source_key = fbest.source_key AND fr.sim = fbest.best
)
`;

const matchedSel = `
${cte}
SELECT source_key, master_id, 'resolver_exact' AS method, 1.0 AS confidence, name_full AS evidence FROM ef1
UNION ALL
SELECT source_key, master_id, 'resolver_destripped', 0.95, name_strip FROM es1
UNION ALL
SELECT source_key, master_id, 'resolver_fuzzy', sim, 'fuzzy~' || master_name
FROM fuzzy_top WHERE sim >= ${threshold} AND n_tied = 1
`;

const stats = (await q(`
  WITH matched AS (${matchedSel})
  SELECT
    (SELECT count(*) FROM (${cte} SELECT source_key FROM src)) AS source_players,
    count(*) FILTER (WHERE method = 'resolver_exact') AS exact_matches,
    count(*) FILTER (WHERE method = 'resolver_destripped') AS destripped_matches,
    count(*) FILTER (WHERE method = 'resolver_fuzzy') AS fuzzy_matches,
    count(DISTINCT master_id) AS distinct_masters
  FROM matched
`)) as Array<Record<string, unknown>>;
const s = stats[0];
const total = Number(s.source_players);
const matched = Number(s.exact_matches) + Number(s.destripped_matches) + Number(s.fuzzy_matches);
console.log('=== RESOLUTION SUMMARY ===');
console.log(`  source players:        ${total}`);
console.log(`  exact (full name+dob): ${s.exact_matches}`);
console.log(`  exact (suffix-stripped): ${s.destripped_matches}`);
console.log(`  fuzzy (≥${threshold}, unambiguous): ${s.fuzzy_matches}`);
console.log(`  unresolved/ambiguous:  ${total - matched}`);
console.log(`  → ${total > 0 ? ((matched / total) * 100).toFixed(1) : '0.0'}% resolved`);

if (dryRun) {
  console.log('\nDry run complete. Use --apply to write xref + unresolved + candidates.');
  process.exit(0);
}

// Persist: append matches to xref.player_xref, misses to xref.player_unresolved,
// and near-misses to audit.match_candidates. Idempotent for this source.
await conn.run('CREATE SCHEMA IF NOT EXISTS xref');
await conn.run(`
  CREATE TABLE IF NOT EXISTS xref.player_unresolved (
    source_id VARCHAR, source_key VARCHAR, norm_name VARCHAR, birth_date DATE, resolved_at TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS audit.match_candidates (
    source_id VARCHAR, entity VARCHAR, source_key VARCHAR, candidate_master_id VARCHAR,
    similarity DOUBLE, note VARCHAR, profiled_at TIMESTAMP
  );
  DELETE FROM xref.player_xref WHERE source_id = '${sourceId}';
  DELETE FROM xref.player_unresolved WHERE source_id = '${sourceId}';
  DELETE FROM audit.match_candidates WHERE source_id = '${sourceId}' AND entity = 'player';
`);

await conn.run(`
  INSERT INTO xref.player_xref
    (master_id, source_id, source_natural_key, match_method, confidence,
     valid_from, valid_to, evidence, resolved_by, resolved_at)
  WITH matched AS (${matchedSel})
  SELECT master_id, '${sourceId}', source_key, method, confidence,
         NULL::DATE, NULL::DATE, evidence, 'resolve-entities', now()
  FROM matched
`);

await conn.run(`
  INSERT INTO xref.player_unresolved
  ${cte}
  SELECT '${sourceId}', source_key, name_full, birth_date, now()
  FROM src
  WHERE source_key NOT IN (SELECT source_natural_key FROM xref.player_xref WHERE source_id='${sourceId}')
`);

await conn.run(`
  INSERT INTO audit.match_candidates
  ${cte}
  SELECT '${sourceId}', 'player', ft.source_key, ft.master_id, ft.sim,
         CASE WHEN ft.n_tied > 1 THEN 'ambiguous: ' || ft.n_tied || ' masters at top similarity'
              ELSE 'best near-miss below threshold' END, now()
  FROM fuzzy_top ft
  WHERE (ft.sim < ${threshold} OR ft.n_tied > 1)
    AND ft.source_key NOT IN (SELECT source_natural_key FROM xref.player_xref WHERE source_id='${sourceId}')
`);

const finalCov = (await q(`
  SELECT count(*) AS mapped, count(DISTINCT master_id) AS masters
  FROM xref.player_xref WHERE source_id = '${sourceId}'
`)) as Array<Record<string, unknown>>;
const unres = (
  await q(`SELECT count(*) AS n FROM xref.player_unresolved WHERE source_id='${sourceId}'`)
)[0].n;
console.log(
  `\n✓ Wrote ${finalCov[0].mapped} xref rows (${finalCov[0].masters} masters), ${unres} unresolved.`,
);
await conn.run('CHECKPOINT'); // flush WAL → avoid cross-process replay bug
console.log('Resolution complete.');
