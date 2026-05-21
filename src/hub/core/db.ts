import { existsSync } from 'node:fs';
import type { DuckDBConnection } from '@duckdb/node-api';
import { DuckDBInstance } from '@duckdb/node-api';
import type { DbRow, SqlParam } from './types.js';

const DEFAULT_DB_PATH = 'data/nba.duckdb';
const CI_FIXTURE_PATH = 'data/fixtures/nba.ci.duckdb';

let instance: DuckDBInstance | null = null;
let connection: DuckDBConnection | null = null;

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
export async function initDb(): Promise<DuckDBConnection> {
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
export async function query<T = DbRow>(sql: string, params?: SqlParam[]): Promise<T[]> {
  const conn = await initDb();
  if (params && params.length > 0) {
    const reader = await conn.runAndReadAll(sql, params);
    return reader.getRowObjectsJson() as T[];
  }
  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjectsJson() as T[];
}

interface TableNameRow {
  table_name: string;
}

interface ColumnMetaRow {
  column_name: string;
  data_type: string;
}

/**
 * Retrieves the names of all user tables in the main schema.
 */
export async function getTables(): Promise<string[]> {
  const rows = await query<TableNameRow>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name",
  );
  return rows.map((r) => r.table_name);
}

/**
 * Retrieves column metadata (name and type) for a specific table.
 */
export async function getColumns(table: string): Promise<{ name: string; type: string }[]> {
  const rows = await query<ColumnMetaRow>(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'main' ORDER BY ordinal_position",
    [table],
  );
  return rows.map((r) => ({
    name: r.column_name,
    type: r.data_type,
  }));
}

/**
 * Closes the connection and cleanly shuts down the DuckDB instance.
 */
export async function closeDb() {
  const { closeHonorsDb } = await import('./dbHonors.js');
  await closeHonorsDb();

  if (connection) {
    connection.disconnectSync();
    connection = null;
  }
  instance = null;
}
