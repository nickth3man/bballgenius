import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface ToolCallMetrics {
  name: string;
  startTime: number;
  endTime?: number;
  latencyMs?: number;
}

interface SqlComplexity {
  tableCount: number;
  joinCount: number;
}

interface MetricsEntry {
  timestamp: string;
  threadId: string;
  question: string;
  model: string;
  durationMs: number;
  toolCalls: number;
  toolCallLatencies: Record<string, number>;
  tokensGenerated: number;
  inputTokens: number;
  outputTokens: number;
  sqlExecuted: string[];
  sqlComplexity: SqlComplexity[];
  chainStages: string[];
  success: boolean;
  error?: string;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

const METRICS_DIR = process.env['CHATBOT_METRICS_DIR'] || 'data';
const METRICS_FILE = 'chatbot-metrics.ndjson';

let currentEntry: Partial<MetricsEntry> = {};
let currentModel = '';
let tokenCount = 0;
let startTime = 0;
let sqlQueries: string[] = [];
let toolCallCount = 0;
let inputTokenTotal = 0;
let outputTokenTotal = 0;
let activeToolCalls = new Map<string, ToolCallMetrics>();
let completedToolCalls: ToolCallMetrics[] = [];
let sqlComplexityEntries: SqlComplexity[] = [];
let chainStagesList: string[] = [];

function calculateSqlComplexity(sql: string): SqlComplexity {
  const stripped = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
  const fromMatches = stripped.match(/\bFROM\s+(\w+(?:\.\w+)?)/gi) || [];
  const joinMatches = stripped.match(/\bJOIN\s+(\w+(?:\.\w+)?)/gi) || [];
  const tables = new Set(
    [...fromMatches, ...joinMatches].map((m) => m.replace(/\b(FROM|JOIN)\s+/i, '').toLowerCase()),
  );
  return {
    tableCount: tables.size,
    joinCount: joinMatches.length,
  };
}

export function startMetrics(threadId: string, question: string, model: string) {
  currentEntry = {
    timestamp: new Date().toISOString(),
    threadId,
    question: question.slice(0, 200),
  };
  currentModel = model;
  tokenCount = 0;
  toolCallCount = 0;
  sqlQueries = [];
  inputTokenTotal = 0;
  outputTokenTotal = 0;
  activeToolCalls = new Map();
  completedToolCalls = [];
  sqlComplexityEntries = [];
  chainStagesList = [];
  startTime = Date.now();
}

export function recordToken() {
  tokenCount++;
}

export function recordToolCall(name: string, input: Record<string, unknown>, runId?: string) {
  toolCallCount++;
  if (name === 'query_nba_db' && input?.['sql']) {
    const sql = String(input['sql']);
    sqlQueries.push(sql.slice(0, 500));
    sqlComplexityEntries.push(calculateSqlComplexity(sql));
  }
  if (runId) {
    activeToolCalls.set(runId, { name, startTime: Date.now() });
  }
}

export function recordToolEnd(runId: string) {
  const toolCall = activeToolCalls.get(runId);
  if (toolCall) {
    toolCall.endTime = Date.now();
    toolCall.latencyMs = toolCall.endTime - toolCall.startTime;
    completedToolCalls.push(toolCall);
    activeToolCalls.delete(runId);
  }
}

export function recordError(error: string) {
  currentEntry.error = error;
}

export function recordUsage(usage: TokenUsage) {
  inputTokenTotal += usage.inputTokens;
  outputTokenTotal += usage.outputTokens;
}

export function recordChainStage(stage: string) {
  chainStagesList.push(stage);
}

export function flushMetrics() {
  if (!startTime) return;

  mkdirSync(METRICS_DIR, { recursive: true });

  const toolCallLatencies: Record<string, number> = {};
  for (const tc of completedToolCalls) {
    if (tc.latencyMs !== undefined) {
      const key = tc.name;
      const existing = toolCallLatencies[key];
      toolCallLatencies[key] = existing ? Math.max(existing, tc.latencyMs) : tc.latencyMs;
    }
  }

  const entry: MetricsEntry = {
    timestamp: currentEntry.timestamp || new Date().toISOString(),
    threadId: currentEntry.threadId || 'unknown',
    question: currentEntry.question || '',
    model: currentModel,
    durationMs: Date.now() - startTime,
    toolCalls: toolCallCount,
    toolCallLatencies,
    tokensGenerated: tokenCount,
    inputTokens: inputTokenTotal,
    outputTokens: outputTokenTotal,
    sqlExecuted: sqlQueries,
    sqlComplexity: sqlComplexityEntries,
    chainStages: chainStagesList,
    success: !currentEntry.error,
  };
  if (currentEntry.error) {
    entry.error = currentEntry.error;
  }

  try {
    appendFileSync(join(METRICS_DIR, METRICS_FILE), `${JSON.stringify(entry)}\n`);
  } catch {
    // Metrics logging is best-effort
  }

  currentEntry = {};
  currentModel = '';
  tokenCount = 0;
  startTime = 0;
  sqlQueries = [];
  toolCallCount = 0;
  inputTokenTotal = 0;
  outputTokenTotal = 0;
  activeToolCalls = new Map();
  completedToolCalls = [];
  sqlComplexityEntries = [];
  chainStagesList = [];
}

export interface MetricsSummary {
  totalQueries: number;
  totalToolCalls: number;
  averageDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  successRate: number;
  averageSqlTableCount: number;
  averageSqlJoinCount: number;
  modelBreakdown: Record<string, number>;
}

export function getMetricsSummary(metricsFile?: string): MetricsSummary {
  const filePath = metricsFile || join(METRICS_DIR, METRICS_FILE);
  let entries: MetricsEntry[] = [];

  try {
    const { readFileSync } = require('node:fs');
    const data = readFileSync(filePath, 'utf-8');
    entries = data
      .split('\n')
      .filter((line: string) => line.trim())
      .map((line: string) => JSON.parse(line));
  } catch {
    return {
      totalQueries: 0,
      totalToolCalls: 0,
      averageDurationMs: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      successRate: 0,
      averageSqlTableCount: 0,
      averageSqlJoinCount: 0,
      modelBreakdown: {},
    };
  }

  if (entries.length === 0) {
    return {
      totalQueries: 0,
      totalToolCalls: 0,
      averageDurationMs: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      successRate: 0,
      averageSqlTableCount: 0,
      averageSqlJoinCount: 0,
      modelBreakdown: {},
    };
  }

  const totalQueries = entries.length;
  const totalToolCalls = entries.reduce((sum, e) => sum + e.toolCalls, 0);
  const totalDuration = entries.reduce((sum, e) => sum + e.durationMs, 0);
  const totalInputTokens = entries.reduce((sum, e) => sum + e.inputTokens, 0);
  const totalOutputTokens = entries.reduce((sum, e) => sum + e.outputTokens, 0);
  const successfulQueries = entries.filter((e) => e.success).length;

  const allSqlComplexity = entries.flatMap((e) => e.sqlComplexity);
  const totalTableCount = allSqlComplexity.reduce((sum, c) => sum + c.tableCount, 0);
  const totalJoinCount = allSqlComplexity.reduce((sum, c) => sum + c.joinCount, 0);

  const modelBreakdown: Record<string, number> = {};
  for (const entry of entries) {
    modelBreakdown[entry.model] = (modelBreakdown[entry.model] || 0) + 1;
  }

  return {
    totalQueries,
    totalToolCalls,
    averageDurationMs: Math.round(totalDuration / totalQueries),
    totalInputTokens,
    totalOutputTokens,
    successRate: Math.round((successfulQueries / totalQueries) * 100),
    averageSqlTableCount:
      allSqlComplexity.length > 0
        ? Math.round((totalTableCount / allSqlComplexity.length) * 10) / 10
        : 0,
    averageSqlJoinCount:
      allSqlComplexity.length > 0
        ? Math.round((totalJoinCount / allSqlComplexity.length) * 10) / 10
        : 0,
    modelBreakdown,
  };
}
