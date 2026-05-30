/**
 * backfill-bref-person-id.ts — close BBR -> NBA identity bridge gaps.
 *
 * `main.fact_bref_player_season_totals.person_id` is the NBA master id used by the
 * cross-source accuracy engine (build-canonical-merge.ts). Newer BBR rows can land
 * with person_id NULL even though their `bref_player_id` slug is already mapped to a
 * master in `xref.player_xref` (source_id='bref'). Those rows are then silently
 * excluded from reconciliation (surfaced by the verify-dq check
 * `bref_nba_unbridged_player_seasons`).
 *
 * This is DETERMINISTIC propagation of an already-resolved bridge — NOT fuzzy entity
 * resolution. It only fills rows where person_id IS NULL and the slug maps to exactly
 * one master, so it can never overwrite or guess an identity. Idempotent and reversible.
 *
 *   bun run scripts/db/backfill-bref-person-id.ts            # dry run
 *   bun run scripts/db/backfill-bref-person-id.ts --apply
 */
import { DuckDBInstance } from '@duckdb/node-api';

const DB_PATH = process.env['NBA_DUCKDB_PATH'] ?? './data/nba.duckdb';
const dryRun = !process.argv.includes('--apply');

const db = await DuckDBInstance.fromCache(DB_PATH);
const conn = await db.connect();
const q = async (sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJson();

// Rows that are bridgeable now: person_id NULL but the bref slug resolves to exactly
// one master in xref.player_xref. (Slug -> master is 1:1 for source_id='bref'.)
const RESOLVABLE = `
  main.fact_bref_player_season_totals t
  WHERE t.person_id IS NULL
    AND t.bref_player_id IS NOT NULL
    AND (SELECT count(DISTINCT x.master_id) FROM xref.player_xref x
         WHERE x.source_id = 'bref' AND x.source_natural_key = t.bref_player_id) = 1`;

const before = (await q(`
  SELECT
    count(*) FILTER (WHERE person_id IS NULL) AS unbridged,
    count(*) FILTER (WHERE person_id IS NULL AND bref_player_id IN (
      SELECT source_natural_key FROM xref.player_xref WHERE source_id='bref')) AS resolvable
  FROM main.fact_bref_player_season_totals
  WHERE is_playoffs = false AND lg = 'NBA'
`)) as Array<Record<string, unknown>>;

console.log(
  `${dryRun ? '[DRY RUN] ' : ''}Backfilling main.fact_bref_player_season_totals.person_id`,
);
console.log(`  unbridged NBA rows: ${before[0]['unbridged']}`);
console.log(`  resolvable via xref bref slug: ${before[0]['resolvable']}\n`);

if (dryRun) {
  const sample = (await q(`
    SELECT t.player, t.bref_player_id, t.season,
           (SELECT x.master_id FROM xref.player_xref x
            WHERE x.source_id='bref' AND x.source_natural_key=t.bref_player_id) AS would_set_person_id
    FROM ${RESOLVABLE} ORDER BY t.season DESC LIMIT 8
  `)) as Array<Record<string, unknown>>;
  console.log('Sample of rows that would be filled:');
  for (const row of sample) {
    console.log(
      `  ${row['season']}  ${row['bref_player_id']}  ${row['player']} -> ${row['would_set_person_id']}`,
    );
  }
  console.log('\nDry run complete. Use --apply to write person_id.');
  process.exit(0);
}

await conn.run(`
  UPDATE main.fact_bref_player_season_totals AS t
  SET person_id = CAST((
    SELECT x.master_id FROM xref.player_xref x
    WHERE x.source_id = 'bref' AND x.source_natural_key = t.bref_player_id
  ) AS BIGINT)
  WHERE t.person_id IS NULL
    AND t.bref_player_id IS NOT NULL
    AND (SELECT count(DISTINCT x.master_id) FROM xref.player_xref x
         WHERE x.source_id = 'bref' AND x.source_natural_key = t.bref_player_id) = 1
`);
await conn.run('CHECKPOINT'); // flush WAL → avoid cross-process replay bug

const after = (await q(`
  SELECT count(*) FILTER (WHERE person_id IS NULL) AS unbridged
  FROM main.fact_bref_player_season_totals WHERE is_playoffs = false AND lg = 'NBA'
`)) as Array<Record<string, unknown>>;
const filled = Number(before[0]['unbridged']) - Number(after[0]['unbridged']);
console.log(
  `✓ Filled ${filled} person_id values. Remaining unbridged NBA rows: ${after[0]['unbridged']}`,
);
console.log('Backfill complete.');

conn.closeSync();
