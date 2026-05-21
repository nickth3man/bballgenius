import { existsSync } from 'node:fs';
import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import { DuckDBInstance } from '@duckdb/node-api';

export type DbRow = Record<string, unknown>;
export type SqlParam = DuckDBValue;

const DEFAULT_DB_PATH = 'data/nba.duckdb';
const CI_FIXTURE_PATH = 'data/fixtures/nba.ci.duckdb';

let instance: DuckDBInstance | null = null;
let connection: DuckDBConnection | null = null;

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

export async function initDb(): Promise<DuckDBConnection> {
  if (!connection) {
    const dbPath = resolveDbPath();
    instance = await DuckDBInstance.fromCache(dbPath);
    connection = await instance.connect();
  }
  return connection;
}

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
  table_schema: string;
  table_name: string;
  table_type: string;
}

interface ColumnMetaRow {
  column_name: string;
  data_type: string;
}

export interface TableRef {
  schema: string;
  name: string;
  type: string;
  qualifiedName: string;
}

const SYSTEM_SCHEMAS = new Set(['information_schema', 'pg_catalog']);

function qualifyTableName(schema: string, table: string): string {
  return schema === 'main' ? table : `${schema}.${table}`;
}

export async function getTables(): Promise<string[]> {
  const tables = await getTableRefs();
  return tables.map((table) => table.qualifiedName);
}

export async function getTableRefs(): Promise<TableRef[]> {
  const rows = await query<TableNameRow>(
    `SELECT table_schema, table_name, table_type
     FROM information_schema.tables
     WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
     ORDER BY table_schema, table_name`,
  );
  return rows
    .filter((r) => !SYSTEM_SCHEMAS.has(r.table_schema))
    .map((r) => ({
      schema: r.table_schema,
      name: r.table_name,
      type: r.table_type,
      qualifiedName: qualifyTableName(r.table_schema, r.table_name),
    }));
}

export async function getColumns(table: string): Promise<{ name: string; type: string }[]> {
  const [schemaName, tableName] = table.includes('.') ? table.split('.', 2) : ['main', table];
  const rows = await query<ColumnMetaRow>(
    'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
    [schemaName, tableName],
  );
  return rows.map((r) => ({
    name: r.column_name,
    type: r.data_type,
  }));
}

export async function closeDb() {
  if (connection) {
    connection.disconnectSync();
    connection = null;
  }
  instance = null;
}
