/**
 * Game-level golden-record view (NBA-only).
 *
 * No BBR game-level box-score table exists in the warehouse (only season-level
 * aggregates like `main.fact_bref_player_season_totals`), so this script creates
 * `api.v_golden_player_game` directly from `nbadb.fact_player_game_traditional`
 * with source tracking ('nba') and zero disagreement counts.
 *
 * When BBR game-level data becomes available, this script can be extended to
 * the full two-source merge pattern (see build-canonical-merge.ts for the
 * season-level template).
 *
 *   bun run scripts/db/build-canonical-merge-game.ts          # dry run
 *   bun run scripts/db/build-canonical-merge-game.ts --apply
 */
import { DuckDBInstance } from '@duckdb/node-api';

const dryRun = !process.argv.includes('--apply');
const GOLDEN_VIEW = 'api.v_golden_player_game';

const METRICS: Array<{ canon: string; nba: string }> = [
  { canon: 'FGM', nba: 'fgm' },
  { canon: 'FGA', nba: 'fga' },
  { canon: 'FG3M', nba: 'fg3m' },
  { canon: 'FG3A', nba: 'fg3a' },
  { canon: 'FTM', nba: 'ftm' },
  { canon: 'FTA', nba: 'fta' },
  { canon: 'ORB', nba: 'oreb' },
  { canon: 'DRB', nba: 'dreb' },
  { canon: 'TRB', nba: 'reb' },
  { canon: 'AST', nba: 'ast' },
  { canon: 'STL', nba: 'stl' },
  { canon: 'BLK', nba: 'blk' },
  { canon: 'TOV', nba: 'tov' },
  { canon: 'PF', nba: 'pf' },
  { canon: 'PTS', nba: 'pts' },
];

const GOLDEN_SQL = `
CREATE OR REPLACE VIEW ${GOLDEN_VIEW} AS
SELECT game_id, CAST(player_id AS VARCHAR) AS player_id,
  ${METRICS.map(
    (m) =>
      `${m.nba} AS ${m.canon}_golden, ` +
      `CASE WHEN ${m.nba} IS NOT NULL THEN 'nba' END AS ${m.canon}_src`,
  ).join(',\n  ')},
  0 AS n_disagreements
FROM nbadb.fact_player_game_traditional
`;

const db = await DuckDBInstance.fromCache('./data/nba.duckdb');
const conn = await db.connect();
const q = async (sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJson();

console.log(
  `${dryRun ? '[DRY RUN] ' : ''}Building game-level golden-record view (NBA-only, ${METRICS.length} metrics)...\n`,
);

const cov = (await q(`
  SELECT count(*) AS rows,
         count(DISTINCT game_id) AS games,
         count(DISTINCT player_id) AS players
  FROM nbadb.fact_player_game_traditional
`)) as Array<Record<string, unknown>>;
const c = cov[0];
console.log(`Source rows (game-players): ${c.rows}`);
console.log(`Distinct games: ${c.games}, distinct players: ${c.players}`);
console.log('BBR game-level source: not available (NBA-only golden record)');

if (dryRun) {
  console.log(`\nWould CREATE OR REPLACE VIEW ${GOLDEN_VIEW}.`);
  console.log('Dry run complete. Use --apply to execute.');
  process.exit(0);
}

await conn.run('CREATE SCHEMA IF NOT EXISTS api');
await conn.run(GOLDEN_SQL);

const golden = (await q(`SELECT count(*) AS n, sum(n_disagreements) AS d FROM ${GOLDEN_VIEW}`))[0];
console.log(`\n✓ ${GOLDEN_VIEW}: ${golden.n} game-players, ${golden.d} cell-level disagreements`);

const canary = (
  await q(`
  SELECT count(*) AS n FROM api.v_golden_player_season_totals
`)
)[0];
console.log(`\nCanary api.v_golden_player_season_totals rows: ${canary.n}`);
console.log(Number(canary.n) > 0 ? '✓ Canary intact.' : '✗ Canary regressed!');
await conn.run('CHECKPOINT');
console.log('\nGame-level golden-record view build complete.');
