import { query } from '../db.js';

const BLOCKED_SQL_PATTERNS = [
  /\b(insert|update|delete|merge|create|drop|alter|truncate|attach|detach)\b/i,
  /\b(copy|load|install|set|call|pragma|vacuum|checkpoint|export|import)\b/i,
  /\b(read_csv|read_json|read_parquet|read_text|glob|httpfs)\s*\(/i,
];

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
}

export function validateReadOnlySql(sql: string): string | null {
  const stripped = stripSqlComments(sql).replace(/;\s*$/, '').trim();
  if (!stripped) {
    return 'SQL is empty.';
  }
  if (stripped.includes(';')) {
    return 'Only one SQL statement is allowed.';
  }
  if (!/^(select|with|describe)\b/i.test(stripped)) {
    return 'Only read-only SELECT, WITH, or DESCRIBE statements are allowed.';
  }
  for (const pattern of BLOCKED_SQL_PATTERNS) {
    if (pattern.test(stripped)) {
      return 'SQL contains a blocked statement or external-access function.';
    }
  }
  return null;
}

export function extractSql(text: string): string | null {
  const match = text.match(/```sql\n([\s\S]*?)```/);
  if (match) {
    return match[1].trim();
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
    blocks.push(match[1].trim());
  }
  return blocks;
}

export async function executeSql(sql: string): Promise<string> {
  const validationError = validateReadOnlySql(sql);
  if (validationError) {
    return `SQL Error: ${validationError}`;
  }

  try {
    const results = await query(sql);
    if (results.length === 0) {
      return 'Query returned no results.';
    }
    return formatResultsPretty(results);
  } catch (err) {
    return `SQL Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function formatResultsPretty(results: Record<string, unknown>[]): string {
  if (results.length === 0) {
    return 'Query returned no results.';
  }
  const headers = Object.keys(results[0]);
  const maxRows = 20;
  const showing =
    results.length > maxRows ? `Rows: ${results.length} (showing first ${maxRows})\n` : '';
  const lines: string[] = [];
  lines.push(headers.join(' | '));
  lines.push(headers.map(() => '---').join(' | '));
  const rows = results.slice(0, maxRows);
  for (const row of rows) {
    const vals = headers.map((h) => {
      const v = row[h];
      return v === null || v === undefined ? '' : String(v);
    });
    lines.push(vals.join(' | '));
  }
  const body = lines.join('\n');
  return showing ? showing + body : body;
}
