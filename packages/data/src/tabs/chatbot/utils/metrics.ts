import { appendFileSync, createReadStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { currentRun } from './correlation.js';

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

export interface MetricsEntry {
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

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const EVENTS_FILE = 'chatbot-events.ndjson';

export function logMetric(rec: { level?: string; [k: string]: unknown }): void {
  const level = (rec.level ?? 'info') as LogLevel;
  const configuredStr = process.env['CHATBOT_LOG_LEVEL'] || 'info';
  const configuredLevel = (LEVEL_ORDER[configuredStr as LogLevel] ?? LEVEL_ORDER['info']) as number;
  const recLevel = LEVEL_ORDER[level] ?? LEVEL_ORDER['info'];

  if (recLevel < configuredLevel) return;

  const runCtx = currentRun();

  const record: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    runId: runCtx.runId,
    turn: runCtx.turn,
    ...rec,
  };

  mkdirSync(getMetricsDir(), { recursive: true });
  appendFileSync(join(getMetricsDir(), EVENTS_FILE), `${JSON.stringify(record)}\n`);

  if (process.env['CHATBOT_LOG_STDERR'] === '1' && level === 'error') {
    process.stderr.write(`${JSON.stringify(record)}\n`);
  }
}

function getMetricsDir(): string {
  return process.env['CHATBOT_METRICS_DIR'] || 'data';
}
const METRICS_FILE = 'chatbot-metrics.ndjson';

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

export class MetricsSession {
  private entry: Partial<MetricsEntry> = {};
  private model = '';
  private tokenCount = 0;
  private startTime = 0;
  private sqlQueries: string[] = [];
  private toolCallCount = 0;
  private inputTokenTotal = 0;
  private outputTokenTotal = 0;
  private activeToolCalls = new Map<string, ToolCallMetrics>();
  private completedToolCalls: ToolCallMetrics[] = [];
  private sqlComplexityEntries: SqlComplexity[] = [];
  private chainStagesList: string[] = [];

  start(threadId: string, question: string, model: string): void {
    this.entry = {
      timestamp: new Date().toISOString(),
      threadId,
      question: question.slice(0, 200),
    };
    this.model = model;
    this.tokenCount = 0;
    this.toolCallCount = 0;
    this.sqlQueries = [];
    this.inputTokenTotal = 0;
    this.outputTokenTotal = 0;
    this.activeToolCalls = new Map();
    this.completedToolCalls = [];
    this.sqlComplexityEntries = [];
    this.chainStagesList = [];
    this.startTime = Date.now();
  }

  recordToken(): void {
    this.tokenCount++;
  }

  recordToolCall(name: string, input: Record<string, unknown>, runId?: string): void {
    this.toolCallCount++;
    if (name === 'query_nba_db' && input?.['sql']) {
      const sql = String(input['sql']);
      this.sqlQueries.push(sql.slice(0, 500));
      this.sqlComplexityEntries.push(calculateSqlComplexity(sql));
    }
    if (runId) {
      this.activeToolCalls.set(runId, { name, startTime: Date.now() });
    }
  }

  recordToolEnd(runId: string): void {
    const toolCall = this.activeToolCalls.get(runId);
    if (toolCall) {
      toolCall.endTime = Date.now();
      toolCall.latencyMs = toolCall.endTime - toolCall.startTime;
      this.completedToolCalls.push(toolCall);
      this.activeToolCalls.delete(runId);
    }
  }

  recordError(error: string): void {
    this.entry.error = error;
  }

  recordUsage(usage: TokenUsage): void {
    this.inputTokenTotal += usage.inputTokens;
    this.outputTokenTotal += usage.outputTokens;
  }

  recordChainStage(stage: string): void {
    this.chainStagesList.push(stage);
  }

  flush(): void {
    if (!this.startTime) return;

    mkdirSync(getMetricsDir(), { recursive: true });

    const toolCallLatencies: Record<string, number> = {};
    for (const tc of this.completedToolCalls) {
      if (tc.latencyMs !== undefined) {
        const key = tc.name;
        const existing = toolCallLatencies[key];
        toolCallLatencies[key] = existing ? Math.max(existing, tc.latencyMs) : tc.latencyMs;
      }
    }

    const entry: MetricsEntry = {
      timestamp: this.entry.timestamp || new Date().toISOString(),
      threadId: this.entry.threadId || 'unknown',
      question: this.entry.question || '',
      model: this.model,
      durationMs: Date.now() - this.startTime,
      toolCalls: this.toolCallCount,
      toolCallLatencies,
      tokensGenerated: this.tokenCount,
      inputTokens: this.inputTokenTotal,
      outputTokens: this.outputTokenTotal,
      sqlExecuted: this.sqlQueries,
      sqlComplexity: this.sqlComplexityEntries,
      chainStages: this.chainStagesList,
      success: !this.entry.error,
    };
    if (this.entry.error) {
      entry.error = this.entry.error;
    }

    appendFileSync(join(getMetricsDir(), METRICS_FILE), `${JSON.stringify(entry)}\n`);

    this.reset();
  }

  private reset(): void {
    this.entry = {};
    this.model = '';
    this.tokenCount = 0;
    this.startTime = 0;
    this.sqlQueries = [];
    this.toolCallCount = 0;
    this.inputTokenTotal = 0;
    this.outputTokenTotal = 0;
    this.activeToolCalls = new Map();
    this.completedToolCalls = [];
    this.sqlComplexityEntries = [];
    this.chainStagesList = [];
  }
}

const defaultSession = new MetricsSession();

export function startMetrics(threadId: string, question: string, model: string): void {
  defaultSession.start(threadId, question, model);
}

export function recordToken(): void {
  defaultSession.recordToken();
}

export function recordToolCall(name: string, input: Record<string, unknown>, runId?: string): void {
  defaultSession.recordToolCall(name, input, runId);
}

export function recordToolEnd(runId: string): void {
  defaultSession.recordToolEnd(runId);
}

export function recordError(error: string): void {
  defaultSession.recordError(error);
}

export function recordUsage(usage: TokenUsage): void {
  defaultSession.recordUsage(usage);
}

export function recordChainStage(stage: string): void {
  defaultSession.recordChainStage(stage);
}

export function flushMetrics(): void {
  defaultSession.flush();
}

export function getMetricsSession(): MetricsSession {
  return defaultSession;
}

export async function getMetricsSummary(metricsFile?: string): Promise<MetricsSummary> {
  const filePath = metricsFile || join(getMetricsDir(), METRICS_FILE);
  const entries: MetricsEntry[] = [];
  const emptySummary: MetricsSummary = {
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

  try {
    const rl = createInterface({
      input: createReadStream(filePath),
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    for await (const line of rl) {
      if (line.trim()) {
        entries.push(JSON.parse(line) as MetricsEntry);
      }
    }
  } catch {
    return emptySummary;
  }

  if (entries.length === 0) {
    return emptySummary;
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
