/**
 * @bballgenius/data — Framework-agnostic NBA data + chatbot agent layer.
 *
 * Public surface re-exports the most-used entry points. For finer-grained
 * imports, use the subpath exports defined in this package's package.json.
 */
export { closeDb, getColumns, getTables, initDb, query } from './core/db.js';
export type { DbRow, SqlParam, TableDataRow } from './core/types.js';
export { resolveDbPath } from './shared/dbPath.js';
export { formatTable, stripAnsi } from './shared/formatters.js';
export { isNoColor, Theme } from './shared/theme.js';
