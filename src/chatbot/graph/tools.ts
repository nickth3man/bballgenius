import { tool } from 'langchain';
import { z } from 'zod';
import { executeSql, validateReadOnlySql } from '../features/nlToSql.js';

export const queryNbaDb = tool(
  async ({ sql }: { sql: string }) => {
    const validationError = validateReadOnlySql(sql);
    if (validationError) {
      return `SQL validation error: ${validationError}`;
    }
    const result = await executeSql(sql);
    return result;
  },
  {
    name: 'query_nba_db',
    description:
      'Execute a read-only DuckDB SQL query on the NBA database. ' +
      'Use this to look up player stats, game data, team information, awards, ' +
      'and any other NBA data. ' +
      'The database contains schemas: main, unified_star, stg_bref, raw_bref, nbadb, api, audit. ' +
      'Use SELECT, WITH...SELECT, or DESCRIBE only. ' +
      'Prefer fully-qualified schema.table names.',
    schema: z.object({
      sql: z.string().describe('The read-only DuckDB SQL query to execute'),
    }),
  },
);
