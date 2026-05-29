/**
 * Phase 5 of the cross-source reconciliation plan
 * (.claude/plans/i-would-like-to-serialized-lake.md).
 *
 * Generalizes the proven single-metric 3PM merge
 * (build-player-season-3p-unified-view.ts) into a rule-driven golden-record
 * generator over the full set of shared player-season counting stats.
 *
 * For each (master player, season) it emits, per canonical metric:
 *   - <metric>_golden : the value chosen by source precedence
 *     (meta.metric_source_authority — BBR wins for box stats)
 *   - <metric>_src    : which source supplied it ('bref' | 'nba' | NULL)
 * and writes a row to `audit.metric_discrepancy` whenever both sources cover the
 * fact but differ beyond tolerance (counting totals → tolerance 0 = exact).
 *
 * "Overlap → accuracy": disagreements surface as DQ instead of silent overwrite.
 * "Overlap → depth":     the merge keeps the UNION of coverage across sources.
 *
 * Built ALONGSIDE the existing api.v_canonical_* views (non-destructive); the
 * 3P canary api.v_player_season_3p_unified is left untouched and re-checked.
 *
 *   bun run scripts/db/build-canonical-merge.ts          # dry run
 *   bun run scripts/db/build-canonical-merge.ts --apply
 */
import { DuckDBInstance } from '@duckdb/node-api';

const dryRun = !process.argv.includes('--apply');
const GOLDEN_VIEW = 'api.v_golden_player_season_totals';

// Shared player-season counting stats: canonical, BBR column, NBA column.
// All are box-counting integers → exact agreement expected (tolerance 0).
const METRICS: Array<{ canon: string; bref: string; nba: string }> = [
  { canon: 'GP', bref: 'g', nba: 'gp' },
  { canon: 'GS', bref: 'gs', nba: 'gs' },
  { canon: 'FGM', bref: 'fg', nba: 'fgm' },
  { canon: 'FGA', bref: 'fga', nba: 'fga' },
  { canon: 'FG3M', bref: 'x3p', nba: 'fg3m' },
  { canon: 'FG3A', bref: 'x3pa', nba: 'fg3a' },
  { canon: 'FTM', bref: 'ft', nba: 'ftm' },
  { canon: 'FTA', bref: 'fta', nba: 'fta' },
  { canon: 'ORB', bref: 'orb', nba: 'oreb' },
  { canon: 'DRB', bref: 'drb', nba: 'dreb' },
  { canon: 'TRB', bref: 'trb', nba: 'reb' },
  { canon: 'AST', bref: 'ast', nba: 'ast' },
  { canon: 'STL', bref: 'stl', nba: 'stl' },
  { canon: 'BLK', bref: 'blk', nba: 'blk' },
  { canon: 'TOV', bref: 'tov', nba: 'tov' },
  { canon: 'PF', bref: 'pf', nba: 'pf' },
  { canon: 'PTS', bref: 'pts', nba: 'pts' },
];
const TOLERANCE = 0; // counting totals: exact

// Base join: one bref row + one nba row per (master player, season), de-duped to
// the combined multi-team row (same recipe as the 3P canary).
const BASE_SQL = `
WITH bref AS (
  SELECT person_id, season,
         ${METRICS.map((m) => `${m.bref} AS b_${m.canon}`).join(', ')}
  FROM (
    SELECT *, row_number() OVER (
      PARTITION BY person_id, season
      ORDER BY CASE WHEN team ~ '^[0-9]+TM$' THEN 0 ELSE 1 END, g DESC
    ) AS rn
    FROM main.fact_bref_player_season_totals
    WHERE person_id IS NOT NULL AND is_playoffs = false
  ) WHERE rn = 1
),
nba AS (
  SELECT player_id, CAST(season_id AS INTEGER) AS season,
         ${METRICS.map((m) => `${m.nba} AS n_${m.canon}`).join(', ')}
  FROM (
    SELECT *, row_number() OVER (
      PARTITION BY player_id, season_id
      ORDER BY CASE WHEN team_abbreviation ~ '^[0-9]+TM$' THEN 0 ELSE 1 END, gp DESC
    ) AS rn
    FROM nbadb.fact_player_career
    WHERE career_type = 'Regular Season' AND league_id = 'NBA'
  ) WHERE rn = 1
)
SELECT
  COALESCE(b.person_id, n.player_id) AS master_id,
  COALESCE(b.season, n.season) AS season,
  ${METRICS.map((m) => `b.b_${m.canon}, n.n_${m.canon}`).join(',\n  ')}
FROM bref b
FULL OUTER JOIN nba n ON n.player_id = b.person_id AND n.season = b.season
`;

// Golden view: precedence is BBR-first for box stats → COALESCE(bref, nba).
const GOLDEN_SQL = `
CREATE OR REPLACE VIEW ${GOLDEN_VIEW} AS
SELECT master_id, season,
  ${METRICS.map(
    (m) =>
      `COALESCE(b_${m.canon}, n_${m.canon}) AS ${m.canon}_golden, ` +
      `CASE WHEN b_${m.canon} IS NOT NULL THEN 'bref' WHEN n_${m.canon} IS NOT NULL THEN 'nba' END AS ${m.canon}_src`,
  ).join(',\n  ')},
  (${METRICS.map(
    (m) =>
      `CASE WHEN b_${m.canon} IS NOT NULL AND n_${m.canon} IS NOT NULL AND abs(b_${m.canon} - n_${m.canon}) > ${TOLERANCE} THEN 1 ELSE 0 END`,
  ).join(' + ')}) AS n_disagreements
FROM (${BASE_SQL}) base
`;

// Tall disagreement records, one per (player, season, metric) beyond tolerance.
const DISCREPANCY_SQL = `
INSERT INTO audit.metric_discrepancy
${METRICS.map(
  (m) => `SELECT 'player' AS entity, 'season_totals' AS grain, master_id, season,
    '${m.canon}' AS canonical_stat, b_${m.canon}::DOUBLE AS bref_value, n_${m.canon}::DOUBLE AS nba_value,
    abs(b_${m.canon} - n_${m.canon}) AS abs_diff, ${TOLERANCE} AS tolerance, true AS beyond_tolerance, now() AS profiled_at
  FROM (${BASE_SQL}) base
  WHERE b_${m.canon} IS NOT NULL AND n_${m.canon} IS NOT NULL AND abs(b_${m.canon} - n_${m.canon}) > ${TOLERANCE}`,
).join('\nUNION ALL\n')}
`;

const db = await DuckDBInstance.fromCache('./data/nba.duckdb');
const conn = await db.connect();
const q = async (sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJson();

console.log(
  `${dryRun ? '[DRY RUN] ' : ''}Building golden-record merge for ${METRICS.length} metrics...\n`,
);

// Read-only validation: coverage + disagreement counts from the base.
const cov = (await q(`
  WITH base AS (${BASE_SQL})
  SELECT count(*) AS rows,
         count(*) FILTER (WHERE master_id IS NOT NULL) AS players_seasons,
         ${METRICS.map(
           (m) =>
             `count(*) FILTER (WHERE b_${m.canon} IS NOT NULL AND n_${m.canon} IS NOT NULL AND abs(b_${m.canon}-n_${m.canon}) > ${TOLERANCE}) AS d_${m.canon}`,
         ).join(',\n         ')}
  FROM base
`)) as Array<Record<string, unknown>>;
const c = cov[0];
console.log(`Base rows (player-seasons): ${c.rows}`);
const disag = METRICS.map((m) => ({ canon: m.canon, n: Number(c[`d_${m.canon}`]) })).filter(
  (x) => x.n > 0,
);
if (disag.length === 0) {
  console.log('Disagreements beyond tolerance: NONE across all metrics.');
} else {
  console.log('Disagreements beyond tolerance (overlap rows where sources differ):');
  for (const d of disag) console.log(`  ${d.canon}: ${d.n}`);
}

if (dryRun) {
  console.log(
    `\nWould CREATE OR REPLACE VIEW ${GOLDEN_VIEW} and populate audit.metric_discrepancy.`,
  );
  console.log('Dry run complete. Use --apply to execute.');
  process.exit(0);
}

await conn.run('CREATE SCHEMA IF NOT EXISTS audit');
await conn.run(`
  CREATE TABLE IF NOT EXISTS audit.metric_discrepancy (
    entity VARCHAR, grain VARCHAR, master_id VARCHAR, season INTEGER, canonical_stat VARCHAR,
    bref_value DOUBLE, nba_value DOUBLE, abs_diff DOUBLE, tolerance DOUBLE,
    beyond_tolerance BOOLEAN, profiled_at TIMESTAMP
  );
  DELETE FROM audit.metric_discrepancy WHERE entity='player' AND grain='season_totals';
`);
await conn.run(DISCREPANCY_SQL);
await conn.run(GOLDEN_SQL);

const golden = (await q(`SELECT count(*) AS n, sum(n_disagreements) AS d FROM ${GOLDEN_VIEW}`))[0];
const disc = (
  await q("SELECT count(*) AS n FROM audit.metric_discrepancy WHERE grain='season_totals'")
)[0];
console.log(`\n✓ ${GOLDEN_VIEW}: ${golden.n} player-seasons, ${golden.d} cell-level disagreements`);
console.log(`✓ audit.metric_discrepancy: ${disc.n} rows (entity=player, grain=season_totals)`);

// Canary: the existing 3P unified view must still report 0 disagreements.
const canary = (
  await q(`
  SELECT count(*) FILTER (WHERE reconciliation='disagree') AS disagree
  FROM api.v_player_season_3p_unified
`)
)[0];
console.log(`\nCanary api.v_player_season_3p_unified disagreements: ${canary.disagree}`);
console.log(Number(canary.disagree) === 0 ? '✓ Canary intact.' : '✗ Canary regressed!');
await conn.run('CHECKPOINT'); // flush WAL → avoid cross-process replay bug
console.log('\nGolden-record merge build complete.');
