import { existsSync } from 'node:fs';
import { DuckDBInstance } from '@duckdb/node-api';

const DEFAULT_DB_PATH = 'data/nba.duckdb';
const CI_FIXTURE_PATH = 'data/fixtures/nba.ci.duckdb';

let instance: any = null;
let connection: any = null;

/** Resolves DuckDB path: explicit env, CI fixture when present, else local full database. */
export function resolveDbPath(): string {
  if (process.env.NBA_DUCKDB_PATH) {
    return process.env.NBA_DUCKDB_PATH;
  }
  if (
    (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') &&
    existsSync(CI_FIXTURE_PATH)
  ) {
    return CI_FIXTURE_PATH;
  }
  return DEFAULT_DB_PATH;
}

/**
 * Initializes and returns the cached DuckDB database connection.
 */
export async function initDb() {
  if (!connection) {
    const dbPath = resolveDbPath();
    instance = await DuckDBInstance.fromCache(dbPath);
    connection = await instance.connect();
  }
  return connection;
}

/**
 * Executes a SQL query against the DuckDB database and returns an array of row objects.
 * Values are converted to JSON-safe formats (e.g. bigints to strings).
 */
export async function query(sql: string, params?: any[]): Promise<any[]> {
  const conn = await initDb();
  if (params && params.length > 0) {
    const reader = await conn.runAndReadAll(sql, params);
    return reader.getRowObjectsJson();
  } else {
    const reader = await conn.runAndReadAll(sql);
    return reader.getRowObjectsJson();
  }
}

/**
 * Retrieves the names of all user tables in the main schema.
 */
export async function getTables(): Promise<string[]> {
  const rows = await query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name",
  );
  return rows.map((r: any) => r.table_name);
}

/**
 * Retrieves column metadata (name and type) for a specific table.
 */
export async function getColumns(table: string): Promise<{ name: string; type: string }[]> {
  const rows = await query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'main' ORDER BY ordinal_position",
    [table],
  );
  return rows.map((r: any) => ({
    name: r.column_name,
    type: r.data_type,
  }));
}

/**
 * Closes the connection and cleanly shuts down the DuckDB instance.
 */
export async function closeDb() {
  if (connection) {
    connection.disconnectSync();
    connection = null;
  }
  instance = null;
}
