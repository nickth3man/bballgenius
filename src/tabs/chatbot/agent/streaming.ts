import type { BaseMessage } from '@langchain/core/messages';
import { getModel } from '../openrouter.js';
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
  | { type: 'error'; message: string };

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

export async function* streamQuery(
  input: BaseMessage[],
  threadId: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, undefined> {
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
            yield { type: 'token', content };
          }
        }
      }

      if (event.event === 'on_tool_start') {
        const toolName = event.name || 'unknown';
        const input = (event.data?.input || {}) as Record<string, unknown>;
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
        yield {
          type: 'tool_error',
          name: activeTool?.name || event.name || 'unknown',
          error: String(event.data?.error || 'Unknown tool error'),
          runId: event.run_id,
        };
      }

      if (event.event === 'on_chat_model_end') {
        const output = event.data?.output;
        const usageMeta = (output as Record<string, unknown>)?.['usage_metadata'] as
          | { input_tokens: number; output_tokens: number }
          | undefined;
        if (usageMeta) {
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
    yield { type: 'done', messages };
  } catch (err) {
    setAbortSignal(undefined);
    yield {
      type: 'error',
      message: formatErrorForUser(err),
    };
  }
}
