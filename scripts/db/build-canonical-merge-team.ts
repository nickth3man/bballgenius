/**
 * Team-season extension of the canonical golden-record merge
 * (build-canonical-merge.ts handles player-season grain).
 *
 * For each (master team, season) it emits, per canonical metric:
 *   - <metric>_golden : the value chosen by source precedence
 *     (BBR wins for box stats → COALESCE(bref, nba))
 *   - <metric>_src    : which source supplied it ('bref' | 'nba' | NULL)
 * and writes a row to `audit.metric_discrepancy` whenever both sources cover the
 * fact but differ beyond tolerance (counting totals → tolerance 0 = exact).
 *
 * BBR source:  main.fact_bref_team_season_totals (box-score) +
 *              main.fact_bref_team_season_summary (W/L), joined via
 *              xref.team_xref (source_id='bref', abbreviation → master_id).
 * NBA source:  nbadb.fact_team_game aggregated to team-season, filtered to
 *              regular season via nbadb.fact_game_result.season_type='Regular'.
 *              W/L derived from fact_game_result.wl_home.
 *
 *   bun run scripts/db/build-canonical-merge-team.ts          # dry run
 *   bun run scripts/db/build-canonical-merge-team.ts --apply
 */
import { DuckDBInstance } from '@duckdb/node-api';

const dryRun = !process.argv.includes('--apply');
const GOLDEN_VIEW = 'api.v_golden_team_season';

const METRICS: Array<{ canon: string; bref: string; nba: string }> = [
  { canon: 'G', bref: 'g', nba: 'gp' },
  { canon: 'W', bref: 'w', nba: 'w' },
  { canon: 'L', bref: 'l', nba: 'l' },
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
const TOLERANCE = 0;

const BASE_SQL = `
WITH bref_totals AS (
  SELECT season, abbreviation,
         ${METRICS.filter((m) => !['W', 'L'].includes(m.canon))
           .map((m) => `${m.bref} AS b_${m.canon}`)
           .join(', ')}
  FROM main.fact_bref_team_season_totals
  WHERE is_playoffs = false
),
bref_summary AS (
  SELECT season, abbreviation,
         ${METRICS.filter((m) => ['W', 'L'].includes(m.canon))
           .map((m) => `${m.bref} AS b_${m.canon}`)
           .join(', ')}
  FROM main.fact_bref_team_season_summary
  WHERE is_playoffs = false
),
bref AS (
  SELECT bt.season, x.master_id AS team_id,
         ${METRICS.map((m) => (['W', 'L'].includes(m.canon) ? `bs.b_${m.canon}` : `bt.b_${m.canon}`)).join(', ')}
  FROM bref_totals bt
  JOIN bref_summary bs ON bs.season = bt.season AND bs.abbreviation = bt.abbreviation
  JOIN xref.team_xref x ON x.source_id = 'bref' AND x.source_natural_key = bt.abbreviation
),
nba AS (
  SELECT
    CAST(SPLIT_PART(tg.season_year, '-', 1) AS INTEGER) + 1 AS season,
    CAST(tg.team_id AS VARCHAR) AS team_id,
    COUNT(*) AS n_G,
    SUM(CASE WHEN tg.team_id = gr.home_team_id AND gr.wl_home = 'W' THEN 1
             WHEN tg.team_id = gr.visitor_team_id AND gr.wl_home = 'L' THEN 1
             ELSE 0 END) AS n_W,
    SUM(CASE WHEN tg.team_id = gr.home_team_id AND gr.wl_home = 'L' THEN 1
             WHEN tg.team_id = gr.visitor_team_id AND gr.wl_home = 'W' THEN 1
             ELSE 0 END) AS n_L,
    ${METRICS.filter((m) => !['G', 'W', 'L'].includes(m.canon))
      .map((m) => `SUM(tg.${m.nba}) AS n_${m.canon}`)
      .join(',\n    ')}
  FROM nbadb.fact_team_game tg
  JOIN nbadb.fact_game_result gr ON gr.game_id = tg.game_id
  WHERE gr.season_type = 'Regular'
  GROUP BY tg.season_year, tg.team_id
)
SELECT
  COALESCE(b.season, n.season) AS season,
  COALESCE(b.team_id, n.team_id) AS team_id,
  ${METRICS.map((m) => `b.b_${m.canon}, n.n_${m.canon}`).join(',\n  ')}
FROM bref b
FULL OUTER JOIN nba n ON n.season = b.season AND n.team_id = b.team_id
`;

const GOLDEN_SQL = `
CREATE OR REPLACE VIEW ${GOLDEN_VIEW} AS
SELECT season, team_id,
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

const DISCREPANCY_SQL = `
INSERT INTO audit.metric_discrepancy
${METRICS.map(
  (m) => `SELECT 'team' AS entity, 'season' AS grain, team_id AS master_id, season,
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
  `${dryRun ? '[DRY RUN] ' : ''}Building team-season golden-record merge for ${METRICS.length} metrics...\n`,
);

const cov = (await q(`
  WITH base AS (${BASE_SQL})
  SELECT count(*) AS rows,
         count(*) FILTER (WHERE team_id IS NOT NULL) AS teams_seasons,
         ${METRICS.map(
           (m) =>
             `count(*) FILTER (WHERE b_${m.canon} IS NOT NULL AND n_${m.canon} IS NOT NULL AND abs(b_${m.canon}-n_${m.canon}) > ${TOLERANCE}) AS d_${m.canon}`,
         ).join(',\n         ')}
  FROM base
`)) as Array<Record<string, unknown>>;
const c = cov[0];
console.log(`Base rows (team-seasons): ${c.rows}`);
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
  DELETE FROM audit.metric_discrepancy WHERE entity='team' AND grain='season';
`);
await conn.run(DISCREPANCY_SQL);
await conn.run(GOLDEN_SQL);

const golden = (await q(`SELECT count(*) AS n, sum(n_disagreements) AS d FROM ${GOLDEN_VIEW}`))[0];
const disc = (
  await q(
    "SELECT count(*) AS n FROM audit.metric_discrepancy WHERE entity='team' AND grain='season'",
  )
)[0];
console.log(`\n✓ ${GOLDEN_VIEW}: ${golden.n} team-seasons, ${golden.d} cell-level disagreements`);
console.log(`✓ audit.metric_discrepancy: ${disc.n} rows (entity=team, grain=season)`);
await conn.run('CHECKPOINT');
console.log('\nTeam-season golden-record merge build complete.');
