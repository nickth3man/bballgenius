import { afterEach, test as baseTest, beforeEach, describe, expect, mock } from 'bun:test';

const test = baseTest.serial;

describe.serial('captureError', () => {
  let logMetricCalls: unknown[];

  beforeEach(() => {
    logMetricCalls = [];
    mock.module('../utils/metrics.js', () => ({
      logMetric: (rec: unknown) => {
        logMetricCalls.push(rec);
      },
    }));
  });

  afterEach(() => {
    mock.restore();
  });

  test('calls logMetric with error details for Error input', async () => {
    const { captureError } = await import('../utils/errorCapture.js');
    const err = new Error('boom');
    const result = captureError(err, { intent: 'career_leaders', sql: 'SELECT 1' });

    expect(result).toBe(err);
    expect(logMetricCalls.length).toBe(1);
    const record = logMetricCalls[0] as Record<string, unknown>;
    expect(record.level).toBe('error');
    expect(record.event).toBe('error');
    expect(record.errName).toBe('Error');
    expect(record.errMessage).toBe('boom');
    expect(record.stack).toBeDefined();
    expect(record.intent).toBe('career_leaders');
    expect(record.sqlPreview).toBe('SELECT 1');
  });

  test('returns a new Error for non-Error input', async () => {
    const { captureError } = await import('../utils/errorCapture.js');
    const result = captureError('plain string', { stage: 'test' });

    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('plain string');
    expect(logMetricCalls.length).toBe(1);
    const record = logMetricCalls[0] as Record<string, unknown>;
    expect(record.errName).toBe('Unknown');
    expect(record.errMessage).toBe('plain string');
    expect(record.stack).toBeUndefined();
  });

  test('truncates long SQL to 500 chars in sqlPreview', async () => {
    const { captureError } = await import('../utils/errorCapture.js');
    const longSql = `SELECT ${'a'.repeat(1000)}`;
    captureError(new Error('long sql'), { sql: longSql });

    expect(logMetricCalls.length).toBe(1);
    const record = logMetricCalls[0] as Record<string, unknown>;
    expect(record.sqlPreview).toBe(longSql.slice(0, 500));
    expect((record.sqlPreview as string).length).toBe(500);
  });

  test('includes runId in context when provided', async () => {
    const { captureError } = await import('../utils/errorCapture.js');
    captureError(new Error('with run id'), { runId: 'test-run-123', stage: 'worker' });

    expect(logMetricCalls.length).toBe(1);
    const record = logMetricCalls[0] as Record<string, unknown>;
    expect(record.runId).toBe('test-run-123');
    expect(record.stage).toBe('worker');
  });

  test('captures all ErrorContext fields', async () => {
    const { captureError } = await import('../utils/errorCapture.js');

    captureError(new Error('full context'), {
      intent: 'awards',
      model: 'gpt-4',
      sql: 'SELECT COUNT(*) FROM awards',
      toolName: 'query_nba_db',
      retryCount: 2,
      stage: 'sql_error_guard',
      question: 'How many awards?',
      runId: 'full-run',
    });

    expect(logMetricCalls.length).toBe(1);
    const record = logMetricCalls[0] as Record<string, unknown>;
    expect(record.intent).toBe('awards');
    expect(record.model).toBe('gpt-4');
    expect(record.sqlPreview).toBe('SELECT COUNT(*) FROM awards');
    expect(record.toolName).toBe('query_nba_db');
    expect(record.retryCount).toBe(2);
    expect(record.stage).toBe('sql_error_guard');
    expect(record.question).toBe('How many awards?');
    expect(record.runId).toBe('full-run');
  });
});
