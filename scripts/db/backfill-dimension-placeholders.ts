/**
 * Backfill placeholder dimension rows to eliminate orphan violations.
 *
 * Finds team_ids and player_ids referenced in nbadb fact tables but missing
 * from their respective dimension tables, captures the violating keys to
 * audit.placeholder_backfill_log, then inserts placeholder rows.
 *
 * Usage:
 *   bun run scripts/db/backfill-dimension-placeholders.ts --dry-run
 *   bun run scripts/db/backfill-dimension-placeholders.ts --apply
 */
import { DuckDBInstance } from '@duckdb/node-api';

const DB_PATH = process.env['NBA_DUCKDB_PATH'] ?? './data/nba.duckdb';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const dryRun = args.has('--dry-run') || !apply;
const runId = new Date().toISOString().replace('T', ' ').replace('Z', '');

const db = await DuckDBInstance.fromCache(DB_PATH);
const conn = await db.connect();

async function rows(sql: string): Promise<Array<Record<string, unknown>>> {
  return (await conn.runAndReadAll(sql)).getRowObjectsJson() as Array<Record<string, unknown>>;
}

async function scalar(sql: string): Promise<number> {
  const [row] = await rows(sql);
  return Number(row?.['n'] ?? 0);
}

async function run(sql: string): Promise<void> {
  if (dryRun) {
    console.log(`\n-- DRY RUN SQL --\n${sql.trim()}\n`);
    return;
  }
  await conn.run(sql);
}

async function reportCount(label: string, sql: string): Promise<void> {
  const n = await scalar(sql);
  console.log(`${label.padEnd(48)} ${n}`);
}

const orphanTeamSql = `
  SELECT DISTINCT team_id FROM (
    SELECT team_id FROM nbadb.fact_player_game_traditional
     WHERE team_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM nbadb.dim_team dt WHERE dt.team_id = fact_player_game_traditional.team_id)
    UNION ALL
    SELECT home_team_id AS team_id FROM nbadb.fact_game_result
     WHERE home_team_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM nbadb.dim_team dt WHERE dt.team_id = fact_game_result.home_team_id)
    UNION ALL
    SELECT visitor_team_id AS team_id FROM nbadb.fact_game_result
     WHERE visitor_team_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM nbadb.dim_team dt WHERE dt.team_id = fact_game_result.visitor_team_id)
    UNION ALL
    SELECT team_id FROM nbadb.fact_team_game
     WHERE team_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM nbadb.dim_team dt WHERE dt.team_id = fact_team_game.team_id)
  )
`;

const orphanPlayerSql = `
  SELECT DISTINCT player_id FROM nbadb.fact_player_game_traditional p
   WHERE player_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM nbadb.dim_player dp WHERE dp.player_id = p.player_id)
`;

console.log(`${dryRun ? '[DRY RUN]' : '[APPLY]'} Dimension placeholder backfill`);
console.log(`DB: ${DB_PATH}`);
console.log(`run_id: ${runId}\n`);

console.log('Before:');
await reportCount('orphan team_ids (fact tables)', `SELECT count(*) AS n FROM (${orphanTeamSql})`);
await reportCount(
  'orphan player_ids (fact_player_game_traditional)',
  `SELECT count(*) AS n FROM (${orphanPlayerSql})`,
);

await run(`
  CREATE SCHEMA IF NOT EXISTS audit;

  CREATE TABLE IF NOT EXISTS audit.placeholder_backfill_log (
    run_id TIMESTAMP,
    dimension VARCHAR,
    entity_id BIGINT,
    source_tables VARCHAR,
    captured_at TIMESTAMP
  );

  DELETE FROM audit.placeholder_backfill_log WHERE run_id = TIMESTAMP '${runId}';

  INSERT INTO audit.placeholder_backfill_log
  SELECT TIMESTAMP '${runId}', 'dim_team', team_id,
         'fact_player_game_traditional,fact_game_result,fact_team_game',
         now()
  FROM (${orphanTeamSql});

  INSERT INTO audit.placeholder_backfill_log
  SELECT TIMESTAMP '${runId}', 'dim_player', player_id,
         'fact_player_game_traditional',
         now()
  FROM (${orphanPlayerSql});
`);

await run(`
  INSERT INTO nbadb.dim_team
    (team_id, abbreviation, full_name, city, state, arena, year_founded, conference, division)
  SELECT team_id,
         'UNK' AS abbreviation,
         'Unknown Team ' || team_id AS full_name,
         'Unknown' AS city,
         'International' AS state,
         'Unknown' AS arena,
         NULL AS year_founded,
         'Unknown' AS conference,
         'Unknown' AS division
  FROM (${orphanTeamSql})
  WHERE NOT EXISTS (SELECT 1 FROM nbadb.dim_team dt WHERE dt.team_id = team_id);
`);

await run(`
  INSERT INTO nbadb.dim_player
    (player_sk, player_id, full_name, first_name, last_name, is_active, team_id, position,
     jersey_number, height, weight, birth_date, country, college_id, draft_year, draft_round,
     draft_number, from_year, to_year, valid_from, valid_to, is_current)
  WITH missing AS (
    SELECT player_id FROM (${orphanPlayerSql})
  ),
  numbered AS (
    SELECT player_id, row_number() OVER (ORDER BY player_id) AS rn FROM missing
  ),
  base AS (
    SELECT coalesce(max(player_sk), 0) AS max_sk FROM nbadb.dim_player
  )
  SELECT base.max_sk + numbered.rn AS player_sk,
         player_id,
         'Unknown Player ' || player_id AS full_name,
         'Unknown' AS first_name,
         CAST(player_id AS VARCHAR) AS last_name,
         false AS is_active,
         NULL AS team_id,
         NULL AS position,
         NULL AS jersey_number,
         NULL AS height,
         NULL AS weight,
         NULL AS birth_date,
         NULL AS country,
         NULL AS college_id,
         NULL AS draft_year,
         NULL AS draft_round,
         NULL AS draft_number,
         NULL AS from_year,
         NULL AS to_year,
         '1900-01-01' AS valid_from,
         NULL AS valid_to,
         true AS is_current
  FROM numbered
  CROSS JOIN base
  WHERE NOT EXISTS (SELECT 1 FROM nbadb.dim_player dp WHERE dp.player_id = numbered.player_id);
`);

if (!dryRun) {
  await conn.run('CHECKPOINT');
}

console.log('\nAfter:');
await reportCount('orphan team_ids (fact tables)', `SELECT count(*) AS n FROM (${orphanTeamSql})`);
await reportCount(
  'orphan player_ids (fact_player_game_traditional)',
  `SELECT count(*) AS n FROM (${orphanPlayerSql})`,
);

console.log(dryRun ? '\nDry run complete. Use --apply to write changes.' : '\nBackfill complete.');
conn.closeSync();
