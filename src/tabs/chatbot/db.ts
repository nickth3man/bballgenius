import type { DuckDBConnection } from '@duckdb/node-api';
import { DuckDBInstance } from '@duckdb/node-api';
import type { DbRow, SqlParam } from '../../core/types.js';
import { resolveDbPath } from '../../shared/dbPath.js';

export type { DbRow, SqlParam };
export { resolveDbPath };

let instance: DuckDBInstance | null = null;
let connection: DuckDBConnection | null = null;

export async function initDb(): Promise<DuckDBConnection> {
  if (connection) {
    try {
      await connection.runAndReadAll('SELECT 1');
      return connection;
    } catch {
      connection = null;
      instance = null;
    }
  }
  const dbPath = resolveDbPath();
  instance = await DuckDBInstance.fromCache(dbPath);
  connection = await instance.connect();
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

let tableRefsCache: TableRef[] | null = null;
const columnsCache = new Map<string, { name: string; type: string }[]>();

export function invalidateSchemaCache(): void {
  tableRefsCache = null;
  columnsCache.clear();
}

function qualifyTableName(schema: string, table: string): string {
  return schema === 'main' ? table : `${schema}.${table}`;
}

export async function getTables(): Promise<string[]> {
  const tables = await getTableRefs();
  return tables.map((table) => table.qualifiedName);
}

export async function getTableRefs(): Promise<TableRef[]> {
  if (tableRefsCache) return tableRefsCache;
  const rows = await query<TableNameRow>(
    `SELECT table_schema, table_name, table_type
     FROM information_schema.tables
     WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
     ORDER BY table_schema, table_name`,
  );
  tableRefsCache = rows
    .filter((r) => !SYSTEM_SCHEMAS.has(r.table_schema))
    .map((r) => ({
      schema: r.table_schema,
      name: r.table_name,
      type: r.table_type,
      qualifiedName: qualifyTableName(r.table_schema, r.table_name),
    }));
  return tableRefsCache;
}

export async function getColumns(table: string): Promise<{ name: string; type: string }[]> {
  const cached = columnsCache.get(table);
  if (cached) return cached;
  const parts = table.includes('.') ? table.split('.', 2) : ['main', table];
  const schemaName = parts[0] ?? 'main';
  const tableName = parts[1] ?? table;
  const rows = await query<ColumnMetaRow>(
    'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
    [schemaName, tableName],
  );
  const result = rows.map((r) => ({
    name: r.column_name,
    type: r.data_type,
  }));
  columnsCache.set(table, result);
  return result;
}

export async function closeDb() {
  if (connection) {
    connection.disconnectSync();
    connection = null;
  }
  instance = null;
}
