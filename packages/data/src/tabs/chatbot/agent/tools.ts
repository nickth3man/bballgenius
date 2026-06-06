import { tool } from '@langchain/core/tools';
import { z } from 'zod/v4';
import { getColumns, getTableRefs, query } from '../db.js';
import { checkSql, executeSql } from '../utils/sql.js';
import {
  TOOL_CHECK_NBA_SQL,
  TOOL_FIND_STAT_COLUMNS,
  TOOL_GET_SCHEMA_INFO,
  TOOL_LIST_NBA_TABLES,
  TOOL_QUERY_NBA_DB,
} from './toolNames.js';

export const queryNbaDb = tool(
  async ({ sql }: { sql: string }) => {
    const result = await executeSql(sql);
    return result;
  },
  {
    name: TOOL_QUERY_NBA_DB,
    description:
      'Execute a read-only DuckDB SQL query on the NBA database. ' +
      'Use this for any NBA data lookup: player stats, game data, team info, awards, shot charts. ' +
      'Prefer fully-qualified schema.table names. ' +
      `For complex queries (3+ JOINs, unfamiliar tables), call ${TOOL_CHECK_NBA_SQL} first to validate. ` +
      'Only SELECT, WITH...SELECT, or DESCRIBE statements are allowed.',
    schema: z.object({
      sql: z.string().describe('The read-only DuckDB SQL query to execute'),
    }),
  },
);

export const checkNbaSql = tool(
  async ({ sql }: { sql: string }) => {
    return await checkSql(sql);
  },
  {
    name: TOOL_CHECK_NBA_SQL,
    description:
      'Validate a read-only NBA DuckDB SQL query WITHOUT executing it. ' +
      'Returns OK if the SQL passes safety and schema checks, otherwise returns a ' +
      'correction-oriented error message. ' +
      `ALWAYS call this BEFORE ${TOOL_QUERY_NBA_DB} when the SQL has: ` +
      '3+ JOIN clauses, unfamiliar table/column names, career-total aggregation patterns, ' +
      'or any query where a syntax/schema error would waste an LLM round-trip. ' +
      'Do NOT call this for simple single-table lookups you are confident about.',
    schema: z.object({
      sql: z.string().describe('The read-only DuckDB SQL query to validate without executing'),
    }),
  },
);

function formatTableList(tables: { schema: string; name: string; type: string }[]): string {
  const bySchema = tables.reduce<Record<string, string[]>>((acc, t) => {
    acc[t.schema] ??= [];
    acc[t.schema]!.push(`${t.name}${t.type === 'VIEW' ? ' (view)' : ''}`);
    return acc;
  }, {});

  const lines: string[] = [];
  for (const [schema, names] of Object.entries(bySchema)) {
    lines.push(`Schema: ${schema}`);
    lines.push(`  ${names.join(', ')}`);
  }
  return lines.join('\n');
}

function formatColumnList(columns: { name: string; type: string }[], limit = 30): string {
  const visible = columns.slice(0, limit);
  const lines = visible.map((c) => `| ${c.name} | ${c.type} |`);
  const header = '| Column | Type |\n|--------|------|';
  const more = columns.length > limit ? `\n... ${columns.length - limit} more columns` : '';
  return `${header}\n${lines.join('\n')}${more}`;
}

export const getSchemaInfo = tool(
  async ({ tableName }: { tableName: string }) => {
    const tables = await getTableRefs();
    const simpleMatch = tables.filter(
      (t) =>
        t.name.toLowerCase().includes(tableName.toLowerCase()) ||
        t.qualifiedName.toLowerCase().includes(tableName.toLowerCase()),
    );

    if (simpleMatch.length === 0) {
      return `No table matching "${tableName}" found. Available schemas:\n${formatTableList(tables.slice(0, 20))}`;
    }

    if (simpleMatch.length === 1) {
      const t = simpleMatch[0]!;
      const columns = await getColumns(t.qualifiedName);
      return `Table: ${t.qualifiedName} (${t.type})\n${formatColumnList(columns)}`;
    }

    if (simpleMatch.length <= 5) {
      const results = await Promise.all(
        simpleMatch.map(async (t) => {
          const columns = await getColumns(t.qualifiedName);
          return `\nTable: ${t.qualifiedName} (${t.type})\n${formatColumnList(columns, 10)}`;
        }),
      );
      return `Found ${simpleMatch.length} matching tables:${results.join('\n')}`;
    }

    return `Found ${simpleMatch.length} tables matching "${tableName}". Be more specific:\n${simpleMatch.map((t) => `  ${t.qualifiedName} (${t.type})`).join('\n')}`;
  },
  {
    name: TOOL_GET_SCHEMA_INFO,
    description:
      'Discover database schema: tables and column definitions. ' +
      'Use this before writing queries to find the right table and column names. ' +
      'Pass a table name (partial match supported) to get column details. ' +
      'Pass an empty string to list all schemas and tables.',
    schema: z.object({
      tableName: z
        .string()
        .describe(
          'Table name to look up (e.g. "dim_player", "fact_game"). Partial match supported.',
        ),
    }),
  },
);

export const listNbaTables = tool(
  async ({ search }: { search?: string }) => {
    const tables = await getTableRefs();
    const query = (search ?? '').trim().toLowerCase();
    const matchingTables = query
      ? tables.filter(
          (table) =>
            table.name.toLowerCase().includes(query) ||
            table.qualifiedName.toLowerCase().includes(query),
        )
      : tables;

    if (matchingTables.length === 0) {
      return `No tables matching "${search}" found. Available tables:\n${formatTableList(tables)}`;
    }

    return formatTableList(matchingTables);
  },
  {
    name: TOOL_LIST_NBA_TABLES,
    description:
      'List available NBA database tables and views, optionally filtered by a search term. ' +
      'Use this before get_schema_info when you are unsure which table contains the needed data.',
    schema: z.object({
      search: z
        .string()
        .optional()
        .describe('Optional table-name search term, e.g. "player", "game", "shot".'),
    }),
  },
);

export const findStatColumns = tool(
  async ({
    canonicalName,
    family,
    limit,
  }: {
    canonicalName: string;
    family?: string;
    limit?: number;
  }) => {
    const effectiveLimit = Math.min(limit ?? 10, 50);
    const upper = canonicalName.toUpperCase();

    const conditions = ["(x.canonical_stat = $1 OR UPPER(x.canonical_stat) LIKE '%' || $1 || '%')"];
    const params: string[] = [upper];

    if (family) {
      conditions.push('COALESCE(x.family, $2) = $2');
      params.push(family);
    }

    const whereClause = conditions.join(' AND ');

    const sql = `
      SELECT
        c.schema_name AS schema,
        c.table_name AS table,
        c.column_name AS column,
        c.data_type,
        x.canonical_stat,
        COALESCE(x.family, 'unclassified') AS family,
        x.definition
      FROM meta.v_column_semantic_catalog c
      JOIN meta.stat_crosswalk x
        ON x.schema = c.schema_name
        AND x."table" = c.table_name
        AND x.column = c.column_name
      WHERE ${whereClause}
      ORDER BY
        CASE c.schema_name
          WHEN 'main' THEN 0
          WHEN 'nbadb' THEN 1
          WHEN 'unified_star' THEN 2
          WHEN 'stg_nba_api_sqlite' THEN 3
          WHEN 'stg_bref' THEN 4
          ELSE 5
        END,
        c.table_name,
        c.column_index
      LIMIT ${effectiveLimit}
    `;

    const rows = await query<
      Record<
        string,
        | string
        | number
        | boolean
        | null
        | Record<string, string | number | boolean | null>
        | Array<Record<string, string | number | boolean | null>>
      >
    >(sql, params);

    if (rows.length === 0) {
      const fallbackSql = `
        SELECT
          c.schema_name AS schema,
          c.table_name AS table,
          c.column_name AS column,
          c.data_type
        FROM meta.v_column_semantic_catalog c
        WHERE UPPER(c.column_name) LIKE '%' || $1 || '%'
          AND c.is_mapped = false
        ORDER BY c.schema_name, c.table_name, c.column_index
        LIMIT 5
      `;
      const fallbackRows = await query<Record<string, string | null>>(fallbackSql, [upper]);
      if (fallbackRows.length > 0) {
        const lines = fallbackRows.map(
          (r) => `  ${r['schema']}.${r['table']}.${r['column']} (${r['data_type']})`,
        );
        return (
          `No canonical stat matching "${canonicalName}" found in the crosswalk.\n` +
          `Similar column names (not yet mapped):\n${lines.join('\n')}\n` +
          'Try using get_schema_info to explore these columns.'
        );
      }
      return (
        `No canonical stat matching "${canonicalName}" found. ` +
        'Try a different name or use get_schema_info to explore tables.'
      );
    }

    const lines = rows.map((r) => {
      const def = r['definition'] ? ` — ${r['definition']}` : '';
      return `  ${r['schema']}.${r['table']}.${r['column']} (${r['data_type']}) [${r['family']}]${def}`;
    });

    const header =
      `Found ${rows.length} column(s) for canonical stat "${canonicalName}"` +
      (family ? ` in family "${family}"` : '') +
      ':';
    const hint = `Use these fully-qualified column names in your SQL (e.g., ${rows[0]!['schema']}.${rows[0]!['table']}.${rows[0]!['column']}).`;

    return `${header}\n${lines.join('\n')}\n${hint}`;
  },
  {
    name: TOOL_FIND_STAT_COLUMNS,
    description:
      'Find all database columns mapped to a canonical stat name (e.g. "PTS", "REB", "AST"). ' +
      'Returns schema.table.column paths, data types, stat families, and definitions. ' +
      'Use this when you know which stat you need but are unsure which table/column has it. ' +
      'Prefer this over get_schema_info when you know the stat name but not the table.',
    schema: z.object({
      canonicalName: z
        .string()
        .describe(
          'Canonical stat name to search for (e.g. "PTS", "REB", "AST", "FG_PCT"). Case-insensitive.',
        ),
      family: z
        .string()
        .optional()
        .describe('Optional stat family filter (e.g. "box", "advanced", "per_game", "shooting").'),
      limit: z.number().optional().describe('Max results to return (default 10, max 50).'),
    }),
  },
);

export const nbaTools = [
  queryNbaDb,
  getSchemaInfo,
  listNbaTables,
  checkNbaSql,
  findStatColumns,
] as const;
