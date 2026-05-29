import { existsSync } from 'node:fs';
import type { DuckDBConnection } from '@duckdb/node-api';
import { DuckDBInstance } from '@duckdb/node-api';
import { closeHonorsDb } from './dbHonors.js';
import type { DbRow, SqlParam } from './types.js';

const DEFAULT_DB_PATH = 'data/nba.duckdb';
const CI_FIXTURE_PATH = 'data/fixtures/nba.ci.duckdb';

/**
 * Schema search path for unqualified table names.
 *
 * The full database keeps its canonical star schema under `unified_star` (every
 * dim_/fact_ table the hub queries, fully populated), while `main` holds only a
 * partial subset. Listing `unified_star` first lets the hub's unqualified queries
 * (e.g. `FROM dim_game`) resolve against the complete schema, with `main` retained
 * as a fallback. The CI fixture places its tables in `main`, which stays reachable.
 */
const SEARCH_PATH = 'unified_star,main';

/** Schema the SQL Sandbox browser introspects for table/column metadata. */
export const BROWSE_SCHEMAS = ['unified_star', 'main'] as const;

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
    // Resolve unqualified table names against the canonical star schema first,
    // falling back to main. Guarded so a fixture without unified_star still works.
    try {
      await connection.run(`SET search_path = '${SEARCH_PATH}'`);
    } catch {
      // Older fixtures expose only `main`; default search_path already covers it.
    }
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
 * Retrieves user table names across the browsable schemas (search-path order),
 * deduplicated so the same logical table appears once. This mirrors how the hub's
 * unqualified queries resolve, so the SQL Sandbox browser shows the real schema.
 */
export async function getTables(): Promise<string[]> {
  const placeholders = BROWSE_SCHEMAS.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await query<TableNameRow>(
    `SELECT DISTINCT table_name FROM information_schema.tables
     WHERE table_schema IN (${placeholders}) ORDER BY table_name`,
    [...BROWSE_SCHEMAS],
  );
  return rows.map((r) => r.table_name);
}

/**
 * Retrieves column metadata (name and type) for a table, resolving it against the
 * browsable schemas in search-path order (first match wins, matching query resolution).
 */
export async function getColumns(table: string): Promise<{ name: string; type: string }[]> {
  for (const schema of BROWSE_SCHEMAS) {
    const rows = await query<ColumnMetaRow>(
      'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 AND table_schema = $2 ORDER BY ordinal_position',
      [table, schema],
    );
    if (rows.length > 0) {
      return rows.map((r) => ({ name: r.column_name, type: r.data_type }));
    }
  }
  return [];
}

/**
 * Closes the connection and cleanly shuts down the DuckDB instance.
 */
export async function closeDb() {
  await closeHonorsDb();

  if (connection) {
    connection.disconnectSync();
    connection = null;
  }
  instance = null;
}
