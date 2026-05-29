import type { DuckDBValue } from '@duckdb/node-api';

/** JSON-safe row object returned by DuckDB `getRowObjectsJson()`. */
export type DbRow = Record<string, unknown>;

/** Bound parameter for parameterized SQL queries. */
export type SqlParam = DuckDBValue;

/** Row accepted by `formatTable` (object keyed by column or array of cell values). */
export type TableDataRow = DbRow | unknown[];
