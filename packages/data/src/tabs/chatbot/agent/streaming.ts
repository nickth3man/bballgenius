import { randomUUID } from 'node:crypto';
import type { BaseMessage } from '@langchain/core/messages';
import { getModel } from '../openrouter.js';
import { updateRunContext } from '../utils/correlation.js';
import { captureError } from '../utils/errorCapture.js';
import { logMetric } from '../utils/metrics.js';
import { formatErrorForUser } from '../utils/retry.js';
import { getChatbotGraph, setAbortSignal } from './graph.js';
import type { ChatbotStateType } from './state.js';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ChainStageName =
  | 'prepare_turn'
  | 'classify_intent'
  | 'inject_schema'
  | 'llm'
  | 'tools'
  | 'tool_budget_guard'
  | 'sql_error_guard'
  | 'validate_answer'
  | 'finalize_turn'
  // Multi-agent orchestrator stages.
  | 'orch_plan'
  | 'orch_worker'
  | 'orch_synthesize';

export type StreamEvent =
  | { type: 'token'; content: string }
  | { type: 'tool_start'; name: string; input: Record<string, unknown>; runId: string }
  | {
      type: 'tool_end';
      name: string;
      input?: Record<string, unknown>;
      output: string;
      runId: string;
      durationMs?: number;
    }
  | { type: 'tool_error'; name: string; error: string; runId?: string }
  | { type: 'chain_stage'; stage: ChainStageName }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done'; messages: BaseMessage[] }
  | {
      type: 'error';
      message: string;
      runId: string;
      toolName?: string;
      stage?: string;
    };

const GRAPH_NODE_NAMES = new Set<string>([
  'prepare_turn',
  'classify_intent',
  'inject_schema',
  'llm',
  'tools',
  'tool_budget_guard',
  'sql_error_guard',
  'validate_answer',
  'finalize_turn',
  'orch_plan',
  'orch_worker',
  'orch_synthesize',
]);

interface ActiveTool {
  name: string;
  input: Record<string, unknown>;
  startedAt: number;
}

interface SpanState {
  tokenCount: number;
  toolStarts: string[];
  toolErrors: Array<{ name: string; error: string }>;
  sqlErrors: number;
  chainStages: string[];
  usage?: { input: number; output: number };
}

/**
 * The SQL-related tool names used to classify tool errors for span tracking.
 */
const SQL_TOOL_NAMES = new Set<string>(['query_nba_db', 'check_nba_sql']);

/**
 * Streams LangGraph execution events from the chatbot graph.
 *
 * The 4th parameter `opts.runId` lets callers inject an explicit run
 * identifier for correlation; when omitted a random UUID is generated.
 */
export async function* streamQuery(
  input: BaseMessage[],
  threadId: string,
  signal?: AbortSignal,
  opts?: { runId?: string },
): AsyncGenerator<StreamEvent, void, undefined> {
  const runId = opts?.runId ?? randomUUID();
  updateRunContext({ runId, turn: 0 });

  const span: SpanState = {
    tokenCount: 0,
    toolStarts: [],
    toolErrors: [],
    sqlErrors: 0,
    chainStages: [],
  };

  try {
    const graph = getChatbotGraph();
    const config = {
      configurable: { thread_id: threadId },
      metadata: { app: 'bballgenius-chatbot', model: getModel() },
    };

    setAbortSignal(signal);
    const stream = await graph.streamEvents(
      { messages: input },
      {
        version: 'v2',
        configurable: { thread_id: threadId },
        metadata: config.metadata,
        recursionLimit: 40,
      },
    );

    const activeTools = new Map<string, ActiveTool>();

    for await (const event of stream) {
      if (event.event === 'on_chain_start' && GRAPH_NODE_NAMES.has(event.name)) {
        span.chainStages.push(event.name);
        yield { type: 'chain_stage', stage: event.name as ChainStageName };
      }

      if (event.event === 'on_chat_model_stream') {
        const chunk = event.data?.chunk;
        if (chunk?.content) {
          const content =
            typeof chunk.content === 'string'
              ? chunk.content
              : Array.isArray(chunk.content)
                ? chunk.content.map((c: { text?: string }) => c.text || '').join('')
                : '';
          if (content) {
            span.tokenCount++;
            yield { type: 'token', content };
          }
        }
      }

      if (event.event === 'on_tool_start') {
        const toolName = event.name || 'unknown';
        const input = (event.data?.input || {}) as Record<string, unknown>;
        span.toolStarts.push(toolName);
        activeTools.set(event.run_id, { name: toolName, input, startedAt: Date.now() });
        yield {
          type: 'tool_start',
          name: toolName,
          input,
          runId: event.run_id,
        };
      }

      if (event.event === 'on_tool_end') {
        const activeTool = activeTools.get(event.run_id);
        const toolName = activeTool?.name || event.name || 'unknown';
        activeTools.delete(event.run_id);
        const output =
          typeof event.data?.output === 'string'
            ? event.data.output
            : JSON.stringify(event.data?.output || '');
        yield {
          type: 'tool_end',
          name: toolName,
          input: activeTool?.input,
          output,
          runId: event.run_id,
          durationMs: activeTool ? Date.now() - activeTool.startedAt : undefined,
        };
      }

      if (event.event === 'on_tool_error') {
        const activeTool = activeTools.get(event.run_id);
        if (event.run_id) {
          activeTools.delete(event.run_id);
        }
        const toolName = activeTool?.name || event.name || 'unknown';
        const errorMsg = String(event.data?.error || 'Unknown tool error');
        span.toolErrors.push({ name: toolName, error: errorMsg });
        if (SQL_TOOL_NAMES.has(toolName)) {
          span.sqlErrors++;
        }
        yield {
          type: 'tool_error',
          name: toolName,
          error: errorMsg,
          runId: event.run_id,
        };
      }

      if (event.event === 'on_chat_model_end') {
        const output = event.data?.output;
        const usageMeta = (output as Record<string, unknown>)?.['usage_metadata'] as
          | { input_tokens: number; output_tokens: number }
          | undefined;
        if (usageMeta) {
          span.usage = {
            input: usageMeta.input_tokens,
            output: usageMeta.output_tokens,
          };
          yield {
            type: 'usage',
            usage: {
              inputTokens: usageMeta.input_tokens,
              outputTokens: usageMeta.output_tokens,
            },
          };
        }
      }
    }

    setAbortSignal(undefined);
    const state = await graph.getState(config);
    const messages = (state.values as ChatbotStateType)?.messages ?? [];

    logMetric({ level: 'info', event: 'span', status: 'ok', ...span, runId, turn: 0 });
    yield { type: 'done', messages };
  } catch (err) {
    setAbortSignal(undefined);
    captureError(err, { stage: 'stream', runId });
    logMetric({
      level: 'warn',
      event: 'span',
      status: 'err',
      ...span,
      runId,
      turn: 0,
      errMessage: err instanceof Error ? err.message : String(err),
    });

    yield {
      type: 'error',
      message: formatErrorForUser(err),
      runId,
      toolName:
        span.toolErrors.length > 0 ? span.toolErrors[span.toolErrors.length - 1].name : undefined,
      stage: 'stream',
    };
  }
}
