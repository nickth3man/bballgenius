import { describe, expect, test } from 'bun:test';
import {
  categorizeDbError,
  ERROR_PREFIX,
  formatErrorForLLM,
  formatErrorForUser,
  isRetryableError,
  withRetry,
} from '../utils/retry.js';

describe('categorizeDbError', () => {
  test('classifies rate limit errors as transient', () => {
    const err = new Error('rate limit exceeded');
    expect(categorizeDbError(err)).toBe('transient');
  });

  test('classifies timeout errors as transient', () => {
    const err = new Error('connection timeout occurred');
    expect(categorizeDbError(err)).toBe('transient');
  });

  test('classifies connection errors as transient', () => {
    const err = new Error('connection refused');
    expect(categorizeDbError(err)).toBe('transient');
  });

  test('classifies lock errors as transient', () => {
    const err = new Error('database is locked');
    expect(categorizeDbError(err)).toBe('transient');
  });

  test('classifies conflict errors as transient', () => {
    const err = new Error('catalog conflict');
    expect(categorizeDbError(err)).toBe('transient');
  });

  test('classifies busy errors as transient', () => {
    const err = new Error('database is busy');
    expect(categorizeDbError(err)).toBe('transient');
  });

  test('classifies missing table errors as schema', () => {
    const err = new Error('table "players" does not exist');
    expect(categorizeDbError(err)).toBe('schema');
  });

  test('classifies no such table errors as schema', () => {
    const err = new Error('no such table: players');
    expect(categorizeDbError(err)).toBe('schema');
  });

  test('classifies no such column errors as schema', () => {
    const err = new Error('no such column: pts');
    expect(categorizeDbError(err)).toBe('schema');
  });

  test('classifies not found in schema errors as schema', () => {
    const err = new Error('column "pts" not found in schema');
    expect(categorizeDbError(err)).toBe('schema');
  });

  test('classifies ambiguous column errors as schema', () => {
    const err = new Error('ambiguous column name "id"');
    expect(categorizeDbError(err)).toBe('schema');
  });

  test('classifies syntax errors', () => {
    const err = new Error('syntax error at or near "SELECT"');
    expect(categorizeDbError(err)).toBe('syntax');
  });

  test('classifies parse errors', () => {
    const err = new Error('parse error: unexpected token');
    expect(categorizeDbError(err)).toBe('syntax');
  });

  test('classifies parser errors', () => {
    const err = new Error('parser error: could not parse query');
    expect(categorizeDbError(err)).toBe('syntax');
  });

  test('classifies unknown errors as permanent', () => {
    const err = new Error('something went horribly wrong');
    expect(categorizeDbError(err)).toBe('permanent');
  });

  test('classifies non-Error values as permanent', () => {
    expect(categorizeDbError('string error')).toBe('permanent');
    expect(categorizeDbError(42)).toBe('permanent');
    expect(categorizeDbError(null)).toBe('permanent');
  });
});

describe('isRetryableError', () => {
  test('returns true for rate limit errors', () => {
    expect(isRetryableError(new Error('rate limit exceeded'))).toBe(true);
  });

  test('returns true for timeout errors', () => {
    expect(isRetryableError(new Error('request timeout'))).toBe(true);
  });

  test('returns true for ECONNREFUSED', () => {
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
  });

  test('returns true for ECONNRESET', () => {
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
  });

  test('returns true for network errors', () => {
    expect(isRetryableError(new Error('network error'))).toBe(true);
  });

  test('returns false for schema errors', () => {
    expect(isRetryableError(new Error('table does not exist'))).toBe(false);
  });

  test('returns false for syntax errors', () => {
    expect(isRetryableError(new Error('syntax error'))).toBe(false);
  });

  test('returns false for non-Error values', () => {
    expect(isRetryableError('error string')).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });
});

describe('formatErrorForLLM', () => {
  test('formats schema errors with schema prefix', () => {
    const err = new Error('table "players" does not exist');
    const result = formatErrorForLLM(err);
    expect(result).toStartWith(`${ERROR_PREFIX.SCHEMA_ERROR} `);
    expect(result).toContain('Check table/column names');
  });

  test('formats syntax errors with syntax prefix', () => {
    const err = new Error('syntax error at SELECT');
    const result = formatErrorForLLM(err);
    expect(result).toStartWith(`${ERROR_PREFIX.SYNTAX_ERROR} `);
    expect(result).toContain('Fix the SQL syntax');
  });

  test('formats transient errors with transient prefix', () => {
    const err = new Error('connection timeout');
    const result = formatErrorForLLM(err);
    expect(result).toStartWith(`${ERROR_PREFIX.TRANSIENT_ERROR} `);
    expect(result).toContain('succeed on retry');
  });

  test('formats permanent errors with SQL Error prefix', () => {
    const err = new Error('unknown failure');
    const result = formatErrorForLLM(err);
    expect(result).toStartWith(`${ERROR_PREFIX.SQL_ERROR} `);
  });

  test('formats non-Error values as plain strings', () => {
    expect(formatErrorForLLM('oops')).toBe('oops');
    expect(formatErrorForLLM(42)).toBe('42');
  });
});

describe('withRetry', () => {
  test('returns result on first success', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      return 42;
    };
    const result = await withRetry(fn);
    expect(result).toBe(42);
    expect(calls).toBe(1);
  });

  test('retries on transient error and succeeds', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) throw new Error('connection timeout');
      return 'ok';
    };
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  test('throws after exhausting max attempts', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error('connection timeout');
    };
    await expect(withRetry(fn, { maxAttempts: 2 })).rejects.toThrow('connection timeout');
    expect(calls).toBe(2);
  });

  test('does not retry non-retryable errors', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error('syntax error');
    };
    await expect(withRetry(fn)).rejects.toThrow('syntax error');
    expect(calls).toBe(1);
  });

  test('respects custom retry options', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error('connection timeout');
    };
    await expect(
      withRetry(fn, { maxAttempts: 4, baseDelayMs: 10, maxDelayMs: 50 }),
    ).rejects.toThrow('connection timeout');
    expect(calls).toBe(4);
  });
});

describe('ERROR_PREFIX', () => {
  test('all prefixes are non-empty strings', () => {
    for (const value of Object.values(ERROR_PREFIX)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  test('prefixes end with colon for consistent message formatting', () => {
    for (const value of Object.values(ERROR_PREFIX)) {
      expect(value.endsWith(':')).toBe(true);
    }
  });
});

describe('formatErrorForUser', () => {
  test('returns user-friendly message for rate limit errors', () => {
    const err = new Error('rate limit exceeded');
    expect(formatErrorForUser(err)).toBe('Rate limited. Please wait and try again.');
  });

  test('returns user-friendly message for timeout errors', () => {
    const err = new Error('request timeout');
    expect(formatErrorForUser(err)).toBe('Request timed out. Try a simpler question.');
  });

  test('returns user-friendly message for network errors', () => {
    expect(formatErrorForUser(new Error('ECONNREFUSED'))).toBe(
      'Network error. Check your connection.',
    );
    expect(formatErrorForUser(new Error('network failure'))).toBe(
      'Network error. Check your connection.',
    );
    expect(formatErrorForUser(new Error('fetch failed'))).toBe(
      'Network error. Check your connection.',
    );
  });

  test('returns original message for unrecognized errors', () => {
    const err = new Error('something went wrong');
    expect(formatErrorForUser(err)).toBe('something went wrong');
  });

  test('returns string for non-Error values', () => {
    expect(formatErrorForUser('oops')).toBe('oops');
    expect(formatErrorForUser(42)).toBe('42');
  });
});
