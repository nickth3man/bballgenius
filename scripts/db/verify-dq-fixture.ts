/**
 * Lightweight DQ smoke for the committed CI fixture.
 *
 * The fixture intentionally exposes a compact `main` schema, not the full
 * `nbadb` warehouse schemas used by verify-dq.ts. This script keeps normal CI
 * useful by checking that representative fixture tables exist, are queryable,
 * and preserve basic grain/FK contracts.
 */
import { DuckDBInstance } from '@duckdb/node-api';

const DB_PATH = process.env['NBA_DUCKDB_PATH'] ?? './data/fixtures/nba.ci.duckdb';

type Check = {
  name: string;
  sql: string;
};

const CHECKS: Check[] = [
  {
    name: 'required_tables_exist',
    sql: `
      SELECT 7 - count(*) AS n
      FROM duckdb_tables()
      WHERE schema_name = 'main'
        AND table_name IN (
          'dim_game',
          'dim_player',
          'dim_team',
          'fact_pbp_events',
          'fact_player_awards',
          'fact_player_game_boxscore',
          'fact_player_season_stats'
        )
    `,
  },
  {
    name: 'dim_game_has_rows',
    sql: 'SELECT CASE WHEN count(*) > 0 THEN 0 ELSE 1 END AS n FROM main.dim_game',
  },
  {
    name: 'dim_player_has_rows',
    sql: 'SELECT CASE WHEN count(*) > 0 THEN 0 ELSE 1 END AS n FROM main.dim_player',
  },
  {
    name: 'dim_team_has_rows',
    sql: 'SELECT CASE WHEN count(*) > 0 THEN 0 ELSE 1 END AS n FROM main.dim_team',
  },
  {
    name: 'dim_game_unique',
    sql: `
      SELECT count(*) AS n
      FROM (SELECT game_id FROM main.dim_game GROUP BY game_id HAVING count(*) > 1)
    `,
  },
  {
    name: 'boxscore_orphan_game_regression',
    sql: `
      SELECT greatest(count(*) - 1, 0) AS n
      FROM (
        SELECT DISTINCT game_id
        FROM main.fact_player_game_boxscore
      ) b
      WHERE NOT EXISTS (SELECT 1 FROM main.dim_game g WHERE g.game_id = b.game_id)
    `,
  },
  {
    name: 'boxscore_orphan_player',
    sql: `
      SELECT count(*) AS n
      FROM (SELECT DISTINCT player_id FROM main.fact_player_game_boxscore) b
      WHERE NOT EXISTS (SELECT 1 FROM main.dim_player p WHERE p.player_id = b.player_id)
    `,
  },
];

const db = await DuckDBInstance.fromCache(DB_PATH);
const conn = await db.connect();

const failures: string[] = [];
console.log(`DQ fixture smoke — DB: ${DB_PATH}`);
for (const check of CHECKS) {
  const row = (await conn.runAndReadAll(check.sql)).getRowObjectsJson()[0] ?? {};
  const n = Number(row['n'] ?? 0);
  console.log(`${check.name.padEnd(30)} ${n === 0 ? 'ok' : n}`);
  if (n > 0) {
    failures.push(`${check.name}: ${n}`);
  }
}

conn.closeSync();

if (failures.length > 0) {
  console.error(`\nDQ fixture smoke failed:\n${failures.map((f) => `- ${f}`).join('\n')}`);
  process.exitCode = 1;
}
