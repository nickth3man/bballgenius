import { tool } from '@langchain/core/tools';
import { z } from 'zod/v4';
import { getColumns, getTableRefs } from '../db.js';
import { checkSql, executeSql } from '../utils/sql.js';

export const queryNbaDb = tool(
  async ({ sql }: { sql: string }) => {
    const result = await executeSql(sql);
    return result;
  },
  {
    name: 'query_nba_db',
    description:
      'Execute a read-only DuckDB SQL query on the NBA database. ' +
      'Use this for any NBA data lookup: player stats, game data, team info, awards, shot charts. ' +
      'Prefer fully-qualified schema.table names. ' +
      'For complex queries (3+ JOINs, unfamiliar tables), call check_nba_sql first to validate. ' +
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
    name: 'check_nba_sql',
    description:
      'Validate a read-only NBA DuckDB SQL query WITHOUT executing it. ' +
      'Returns OK if the SQL passes safety and schema checks, otherwise returns a ' +
      'correction-oriented error message. ' +
      'ALWAYS call this BEFORE query_nba_db when the SQL has: ' +
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
    name: 'get_schema_info',
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
    name: 'list_nba_tables',
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

export const nbaTools = [queryNbaDb, getSchemaInfo, listNbaTables, checkNbaSql] as const;
