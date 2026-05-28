/**
 * Builds a minimal DuckDB fixture for CI from the full local database.
 *
 * Usage:
 *   bun run scripts/build-ci-fixture.ts
 *   SOURCE_DB=data/nba.duckdb OUT_DB=data/fixtures/nba.ci.duckdb bun run scripts/build-ci-fixture.ts
 */

import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';

const SOURCE_DB = resolve(process.env.SOURCE_DB ?? 'data/nba.duckdb');
const OUT_DB = resolve(process.env.OUT_DB ?? 'data/fixtures/nba.ci.duckdb');

const FIXTURE_PLAYER_IDS = ['2544', '77']; // LeBron + Bob Cousy (null advanced metrics in tests)
/** Game where undeduped dim_team join inflates row count (mutation.test.ts). */
const DEDUP_GAME_ID = '0022000619';
/** Game with many field-goal shot events (shot chart / visual tests). */
const SHOTS_GAME_ID = '0032300001';
/** Game where xy events include non-field-goals (mutation is_field_goal test). */
const NON_FG_XY_GAME_ID = '0021900120';

const TABLES = [
  'dim_game',
  'dim_team',
  'dim_player',
  'fact_player_game_boxscore',
  'fact_pbp_events',
  'fact_player_awards',
  'fact_player_season_stats',
] as const;

type Conn = Awaited<ReturnType<DuckDBInstance['connect']>>;

async function run(conn: Conn, sql: string) {
  await conn.run(sql);
}

async function query(conn: Conn, sql: string) {
  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjectsJson() as Record<string, unknown>[];
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function main() {
  if (!existsSync(SOURCE_DB)) {
    console.error(`Source database not found: ${SOURCE_DB}`);
    console.error('Build or copy data/nba.duckdb, then re-run this script.');
    process.exit(1);
  }

  mkdirSync(dirname(OUT_DB), { recursive: true });
  if (existsSync(OUT_DB)) {
    unlinkSync(OUT_DB);
  }

  const outInst = await DuckDBInstance.create(OUT_DB);
  const conn = await outInst.connect();

  const sourcePath = SOURCE_DB.replace(/\\/g, '/').replace(/'/g, "''");
  await run(conn, `ATTACH '${sourcePath}' AS src (READ_ONLY)`);

  const recentGames = await query(
    conn,
    'SELECT game_id FROM src.dim_game ORDER BY game_date DESC LIMIT 25',
  );
  const gameIds = new Set<string>([
    DEDUP_GAME_ID,
    SHOTS_GAME_ID,
    NON_FG_XY_GAME_ID,
    ...recentGames.map((r) => String(r.game_id)),
  ]);

  const gameIdList = [...gameIds].map(sqlString).join(', ');

  const teamIds = await query(
    conn,
    `
    SELECT DISTINCT team_id FROM (
      SELECT home_team_id AS team_id FROM src.dim_game WHERE game_id IN (${gameIdList})
      UNION
      SELECT away_team_id FROM src.dim_game WHERE game_id IN (${gameIdList})
      UNION
      SELECT team_id FROM src.fact_player_game_boxscore WHERE game_id IN (${gameIdList})
    )
  `,
  );
  const teamIdList = teamIds.map((r) => sqlString(String(r.team_id))).join(', ');

  const playerIds = await query(
    conn,
    `
    SELECT DISTINCT player_id FROM (
      SELECT player_id FROM src.fact_player_game_boxscore WHERE game_id IN (${gameIdList})
      UNION SELECT player_id FROM src.fact_player_awards WHERE player_id IN (${FIXTURE_PLAYER_IDS.map(sqlString).join(', ')})
      UNION SELECT player_id FROM src.fact_player_season_stats WHERE player_id IN (${FIXTURE_PLAYER_IDS.map(sqlString).join(', ')})
    )
  `,
  );
  const playerIdList = playerIds.map((r) => sqlString(String(r.player_id))).join(', ');

  console.log(
    `Fixture scope: ${gameIds.size} games, ${teamIds.length} teams, ${playerIds.length} players`,
  );

  const filters: Record<(typeof TABLES)[number], string> = {
    dim_game: `game_id IN (${gameIdList})`,
    dim_team: teamIdList ? `team_id IN (${teamIdList})` : 'FALSE',
    dim_player: playerIdList ? `player_id IN (${playerIdList})` : 'FALSE',
    fact_player_game_boxscore: `game_id IN (${gameIdList})`,
    fact_pbp_events: `game_id IN (${gameIdList})`,
    fact_player_awards: `player_id IN (${playerIdList})`,
    fact_player_season_stats: `player_id IN (${playerIdList})`,
  };

  for (const table of TABLES) {
    await run(conn, `CREATE TABLE ${table} AS SELECT * FROM src.${table} WHERE ${filters[table]}`);
    const [{ n }] = await query(conn, `SELECT COUNT(*)::BIGINT AS n FROM ${table}`);
    console.log(`  ${table}: ${n} rows`);
  }

  await run(conn, 'DETACH src');
  await run(conn, 'CHECKPOINT');
  conn.disconnectSync();

  console.log(`Wrote ${OUT_DB}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
