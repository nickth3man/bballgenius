export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export type ErrorCategory = 'transient' | 'schema' | 'syntax' | 'permanent';

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

export const ERROR_PREFIX = {
  SQL_ERROR: 'SQL Error:' as const,
  SCHEMA_ERROR: 'Schema error:' as const,
  SYNTAX_ERROR: 'SQL syntax error:' as const,
  TRANSIENT_ERROR: 'Transient error:' as const,
  SCHEMA_VALIDATION_FAILED: 'Schema validation failed:' as const,
};

const TRANSIENT_KEYWORDS = ['timeout', 'connection', 'lock', 'conflict', 'busy'];
const SCHEMA_KEYWORDS = [
  'does not exist',
  'no such table',
  'no such column',
  'not found in schema',
  'ambiguous column',
];
const SYNTAX_KEYWORDS = ['syntax error', 'parse error', 'parser error'];

export function categorizeDbError(err: unknown): ErrorCategory {
  if (!(err instanceof Error)) return 'permanent';
  const msg = err.message.toLowerCase();

  if (msg.includes('rate') && msg.includes('limit')) return 'transient';
  if (TRANSIENT_KEYWORDS.some((k) => msg.includes(k))) return 'transient';
  if (SCHEMA_KEYWORDS.some((k) => msg.includes(k))) return 'schema';
  if (SYNTAX_KEYWORDS.some((k) => msg.includes(k))) return 'syntax';

  return 'permanent';
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('rate') && msg.includes('limit')) return true;
    if (msg.includes('timeout')) return true;
    if (msg.includes('econnrefused')) return true;
    if (msg.includes('econnreset')) return true;
    if (msg.includes('network')) return true;
  }
  return false;
}

export function formatErrorForLLM(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const category = categorizeDbError(err);

  switch (category) {
    case 'schema':
      return `${ERROR_PREFIX.SCHEMA_ERROR} ${err.message}. Check table/column names and try a corrected query.`;
    case 'syntax':
      return `${ERROR_PREFIX.SYNTAX_ERROR} ${err.message}. Fix the SQL syntax and try again.`;
    case 'transient':
      return `${ERROR_PREFIX.TRANSIENT_ERROR} ${err.message}. The query may succeed on retry.`;
    default:
      return `${ERROR_PREFIX.SQL_ERROR} ${err.message}`;
  }
}

export async function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < opts.maxAttempts && isRetryableError(err)) {
        const delay = Math.min(opts.baseDelayMs * 2 ** (attempt - 1), opts.maxDelayMs);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }

  throw lastError;
}
