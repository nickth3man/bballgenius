import { afterEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  flushMetrics,
  getMetricsSession,
  getMetricsSummary,
  recordError,
  recordToken,
  recordToolCall,
  recordToolEnd,
  recordUsage,
  startMetrics,
} from '../utils/metrics.js';

const TEST_DIR = 'data/test-metrics';
const TEST_FILE = join(TEST_DIR, 'chatbot-metrics.ndjson');

afterEach(() => {
  flushMetrics();
  try {
    rmSync(TEST_FILE, { force: true });
  } catch {
    // ignore
  }
});

describe('MetricsSession', () => {
  test('startMetrics initializes session', () => {
    startMetrics('thread-1', 'test question', 'test-model');
    const session = getMetricsSession();
    expect(session).toBeDefined();
  });

  test('recordToken increments token count', () => {
    startMetrics('thread-1', 'test', 'model');
    recordToken();
    recordToken();
    recordToken();
  });

  test('recordToolCall tracks tool invocations', () => {
    startMetrics('thread-1', 'test', 'model');
    recordToolCall('query_nba_db', { sql: 'SELECT 1' }, 'run-1');
    recordToolCall('get_schema_info', { tableName: 'dim_player' }, 'run-2');
  });

  test('recordToolEnd calculates latency', () => {
    startMetrics('thread-1', 'test', 'model');
    recordToolCall('query_nba_db', { sql: 'SELECT 1' }, 'run-1');
    recordToolEnd('run-1');
  });

  test('recordUsage accumulates token counts', () => {
    startMetrics('thread-1', 'test', 'model');
    recordUsage({ inputTokens: 100, outputTokens: 50 });
    recordUsage({ inputTokens: 200, outputTokens: 75 });
  });

  test('recordError marks session as failed', () => {
    startMetrics('thread-1', 'test', 'model');
    recordError('something failed');
  });

  test('flushMetrics writes NDJSON entry', () => {
    process.env['CHATBOT_METRICS_DIR'] = TEST_DIR;
    startMetrics('thread-1', 'What is LeBron career PPG?', 'test-model');
    recordToken();
    recordToken();
    recordToolCall(
      'query_nba_db',
      { sql: 'SELECT pts FROM fact_player_game_stats LIMIT 10' },
      'run-1',
    );
    recordToolEnd('run-1');
    recordUsage({ inputTokens: 150, outputTokens: 80 });
    flushMetrics();

    const { readFileSync } = require('node:fs');
    const data = readFileSync(TEST_FILE, 'utf-8');
    const entry = JSON.parse(data.trim());
    expect(entry.threadId).toBe('thread-1');
    expect(entry.model).toBe('test-model');
    expect(entry.tokensGenerated).toBe(2);
    expect(entry.toolCalls).toBe(1);
    expect(entry.inputTokens).toBe(150);
    expect(entry.outputTokens).toBe(80);
    expect(entry.success).toBe(true);
    expect(entry.sqlExecuted).toHaveLength(1);
    delete process.env['CHATBOT_METRICS_DIR'];
  });

  test('flushMetrics records error state', () => {
    process.env['CHATBOT_METRICS_DIR'] = TEST_DIR;
    startMetrics('thread-2', 'test', 'model');
    recordError('timeout');
    flushMetrics();

    const { readFileSync } = require('node:fs');
    const data = readFileSync(TEST_FILE, 'utf-8');
    const entry = JSON.parse(data.trim());
    expect(entry.success).toBe(false);
    expect(entry.error).toBe('timeout');
    delete process.env['CHATBOT_METRICS_DIR'];
  });

  test('flushMetrics is idempotent when not started', () => {
    flushMetrics();
  });
});

describe('getMetricsSummary', () => {
  test('returns zeros for missing file', async () => {
    const summary = await getMetricsSummary('/nonexistent/path.ndjson');
    expect(summary.totalQueries).toBe(0);
    expect(summary.successRate).toBe(0);
  });

  test('returns zeros for empty file', async () => {
    process.env['CHATBOT_METRICS_DIR'] = TEST_DIR;
    const { mkdirSync, writeFileSync } = require('node:fs');
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(TEST_FILE, '');

    const summary = await getMetricsSummary(TEST_FILE);
    expect(summary.totalQueries).toBe(0);
    delete process.env['CHATBOT_METRICS_DIR'];
  });

  test('calculates summary from entries', async () => {
    process.env['CHATBOT_METRICS_DIR'] = TEST_DIR;
    const { mkdirSync, appendFileSync } = require('node:fs');
    mkdirSync(TEST_DIR, { recursive: true });
    appendFileSync(
      TEST_FILE,
      `${JSON.stringify({
        timestamp: '2024-01-01T00:00:00.000Z',
        threadId: 't1',
        question: 'q1',
        model: 'model-a',
        durationMs: 1000,
        toolCalls: 2,
        toolCallLatencies: {},
        tokensGenerated: 50,
        inputTokens: 100,
        outputTokens: 50,
        sqlExecuted: ['SELECT 1'],
        sqlComplexity: [{ tableCount: 1, joinCount: 0 }],
        chainStages: ['llm', 'tools'],
        success: true,
      })}\n`,
    );
    appendFileSync(
      TEST_FILE,
      `${JSON.stringify({
        timestamp: '2024-01-01T00:00:01.000Z',
        threadId: 't2',
        question: 'q2',
        model: 'model-a',
        durationMs: 2000,
        toolCalls: 1,
        toolCallLatencies: {},
        tokensGenerated: 30,
        inputTokens: 80,
        outputTokens: 30,
        sqlExecuted: [],
        sqlComplexity: [],
        chainStages: ['llm'],
        success: false,
        error: 'timeout',
      })}\n`,
    );

    const summary = await getMetricsSummary(TEST_FILE);
    expect(summary.totalQueries).toBe(2);
    expect(summary.totalToolCalls).toBe(3);
    expect(summary.averageDurationMs).toBe(1500);
    expect(summary.totalInputTokens).toBe(180);
    expect(summary.totalOutputTokens).toBe(80);
    expect(summary.successRate).toBe(50);
    expect(summary.modelBreakdown['model-a']).toBe(2);
    delete process.env['CHATBOT_METRICS_DIR'];
  });
});
