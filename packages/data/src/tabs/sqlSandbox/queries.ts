import { getColumns, getTables, query } from '../../core/db.js';
import type { DbRow } from '../../core/types.js';

export { getColumns, getTables };

/** Runs an ad-hoc SQL statement in the sandbox (read-only in typical usage). */
export async function runSandboxQuery(sql: string): Promise<DbRow[]> {
  return query<DbRow>(sql);
}

/** Loads table names and column metadata for the schema browser. */
export async function loadSchemaCatalog(): Promise<{
  tables: string[];
  tableColumns: Map<string, { name: string; type: string }[]>;
}> {
  const tables = await getTables();
  const tableColumns = new Map<string, { name: string; type: string }[]>();

  for (const table of tables) {
    const cols = await getColumns(table);
    tableColumns.set(table, cols);
  }

  return { tables, tableColumns };
}
