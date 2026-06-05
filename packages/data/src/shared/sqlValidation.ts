// Read-only SQL validation shared by the chatbot agent and the SQL Sandbox.
//
// Lives in `shared/` (not `tabs/chatbot/utils/`) because the SQL Sandbox is a
// sibling tab and `AGENTS.md` forbids cross-tab imports. Both `chatbot/utils`
// and `sqlSandbox` can re-export these symbols to keep their public API.

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

/**
 * Returns `null` when SQL is read-only and safe to execute, or a user-facing
 * error string explaining why the statement is rejected.
 *
 * Rules:
 * - non-empty, single statement (no embedded `;` after the trailing one)
 * - must start with `SELECT`, `WITH`, or `DESCRIBE`
 * - must not contain write/structural keywords (`INSERT`, `DROP`, etc.)
 * - must not call external-access functions (`read_csv`, `httpfs`, …)
 */
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
