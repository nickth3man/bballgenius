import { validateReadOnlySql } from '../../../shared/sqlValidation.js';
import { getTables, query } from '../db.js';
import { ERROR_PREFIX, formatErrorForLLM, withRetry } from './retry.js';
import { formatResultsTable } from './tableFormatter.js';

// Re-exported so existing chatbot consumers (`tabs/chatbot/utils/index.ts`) keep
// working without changes. The canonical implementation now lives in
// `shared/sqlValidation.ts` and is shared with the SQL Sandbox.
export { validateReadOnlySql };

export function extractSql(text: string): string | null {
  const match = text.match(/```sql\n([\s\S]*?)```/);
  if (match) {
    return (match[1] ?? '').trim();
  }

  const cleaned = text
    .replace(/<\|(?:channel|message|start|end|call)\|>/g, '\n')
    .replace(/to=(?:container\.exec|repo_browser|duckdb|[^\s]+)/g, ' ');
  const fallback = cleaned.match(/\b(select|with|describe)\b[\s\S]*?(?:;|\n\s*\n|$)/i);
  if (!fallback) {
    return null;
  }

  return fallback[0].replace(/;\s*$/, '').trim();
}

export function extractSqlFromMarkdown(text: string): string[] {
  const regex = /```sql\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    blocks.push((match[1] ?? '').trim());
  }
  return blocks;
}

function extractTableRefs(sql: string): string[] {
  const refs = new Set<string>();
  const fromRegex = /\bFROM\s+([a-z_][a-z0-9_]*(?:\s*\.\s*[a-z_][a-z0-9_]*)?)/gi;
  const joinRegex = /\bJOIN\s+([a-z_][a-z0-9_]*(?:\s*\.\s*[a-z_][a-z0-9_]*)?)/gi;

  for (const regex of [fromRegex, joinRegex]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(sql)) !== null) {
      const ref = match[1];
      if (ref) {
        refs.add(ref.toLowerCase().replace(/\s+/g, ''));
      }
    }
  }
  return [...refs];
}

export interface SchemaValidationError {
  type: 'missing_table' | 'missing_column';
  message: string;
}

const SCHEMA_VALIDATION_TABLE_LIMIT = 5;

export async function validateSchemaReferences(sql: string): Promise<SchemaValidationError[]> {
  const errors: SchemaValidationError[] = [];
  const tableRefs = extractTableRefs(sql);

  if (tableRefs.length === 0) return errors;
  if (tableRefs.length > SCHEMA_VALIDATION_TABLE_LIMIT) return errors;

  const existingTables = new Set((await getTables()).map((t) => t.toLowerCase()));

  for (const ref of tableRefs) {
    // existingTables stores main-schema tables WITHOUT the "main." prefix
    // (qualifyTableName omits the schema for main). So "main.dim_player" must
    // also be checked as just "dim_player".
    const withoutMainPrefix = ref.startsWith('main.') ? ref.slice(5) : null;
    const found =
      existingTables.has(ref) ||
      existingTables.has(`main.${ref}`) ||
      (withoutMainPrefix != null && existingTables.has(withoutMainPrefix));

    if (!found) {
      errors.push({
        type: 'missing_table',
        message: `Table "${ref}" does not exist in the database.`,
      });
    }
  }

  return errors;
}

function formatSchemaErrors(errors: SchemaValidationError[]): string {
  const lines = errors.map((e) => `- ${e.message}`);
  return `${ERROR_PREFIX.SCHEMA_VALIDATION_FAILED}\n${lines.join('\n')}\nPlease check table names and try again.`;
}

export async function checkSql(sql: string): Promise<string> {
  const validationError = validateReadOnlySql(sql);
  if (validationError) {
    return `${ERROR_PREFIX.SQL_ERROR} ${validationError}`;
  }

  const schemaErrors = await validateSchemaReferences(sql);
  if (schemaErrors.length > 0) {
    return formatSchemaErrors(schemaErrors);
  }

  return 'OK: SQL passed read-only safety and schema checks.';
}

export async function executeSql(sql: string): Promise<string> {
  const checkResult = await checkSql(sql);
  if (containsErrorPrefix(checkResult)) {
    return checkResult;
  }

  try {
    const results = await withRetry(() => query(sql), {
      maxAttempts: 2,
      baseDelayMs: 500,
      maxDelayMs: 2000,
    });
    if (results.length === 0) {
      return 'Query returned no results.';
    }
    return formatResultsPretty(results);
  } catch (err) {
    return formatErrorForLLM(err);
  }
}

function containsErrorPrefix(content: string): boolean {
  return Object.values(ERROR_PREFIX).some((prefix) => content.startsWith(prefix));
}

export function formatResultsPretty(results: Record<string, unknown>[]): string {
  return formatResultsTable(results);
}
