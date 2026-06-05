const BLOCKED_SQL_PATTERNS = [
  /\b(insert|update|delete|merge|create|drop|alter|truncate|attach|detach)\b/i,
  /\b(copy|load|install|set|call|pragma|vacuum|checkpoint|export|import)\b/i,
  /\b(read_csv|read_json|read_parquet|read_text|glob|httpfs)\s*\(/i,
];

// NOTE: Does not handle comments inside string literals (e.g. SELECT '-- not a comment').
// Acceptable for LLM-generated SQL which never embeds comments in string values.
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

export { BLOCKED_SQL_PATTERNS, stripSqlComments };
