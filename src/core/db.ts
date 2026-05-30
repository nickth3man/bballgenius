import type { DuckDBConnection } from '@duckdb/node-api';
import { DuckDBInstance } from '@duckdb/node-api';
import { resolveDbPath } from '../shared/dbPath.js';
import { closeHonorsDb } from './dbHonors.js';
import type { DbRow, SqlParam } from './types.js';

export { resolveDbPath };

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
let connecting: Promise<DuckDBConnection> | null = null;

/**
 * Initializes and returns the cached DuckDB database connection.
 */
export async function initDb(): Promise<DuckDBConnection> {
  if (connection) {
    return connection;
  }
  // Cache the in-flight promise so concurrent callers share a single connection
  // instead of each racing past the `if (!connection)` guard and leaking one.
  if (!connecting) {
    connecting = (async () => {
      const dbPath = resolveDbPath();
      // Open read-only: the hub is a pure analytics viewer that never writes to
      // the database at runtime (all ETL happens in offline scripts/ which open
      // their own write connections). This is defense-in-depth for the chatbot's
      // LLM-generated SQL path — even if the read-only-statement guard in
      // utils/sql.ts were bypassed, the connection itself cannot mutate data.
      instance = await DuckDBInstance.fromCache(dbPath, { access_mode: 'READ_ONLY' });
      const conn = await instance.connect();
      // Resolve unqualified table names against the canonical star schema first,
      // falling back to main. Guarded so a fixture without unified_star still works.
      try {
        await conn.run(`SET search_path = '${SEARCH_PATH}'`);
      } catch {
        // Older fixtures expose only `main`; default search_path already covers it.
      }
      connection = conn;
      return conn;
    })().catch((err) => {
      // Reset so a failed init can be retried rather than caching a rejection.
      connecting = null;
      instance = null;
      throw err;
    });
  }
  return connecting;
}

/**
 * Executes a SQL query against the DuckDB database and returns an array of row objects.
 * Values are converted to JSON-safe formats (e.g. bigints to strings).
 */
export async function query<T = DbRow>(sql: string, params?: SqlParam[]): Promise<T[]> {
  const conn = await initDb();
  const reader =
    params && params.length > 0
      ? await conn.runAndReadAll(sql, params)
      : await conn.runAndReadAll(sql);
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
  connecting = null;
  instance = null;
}
