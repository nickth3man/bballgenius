import type { BaseMessage } from '@langchain/core/messages';
import { getModel } from '../openrouter.js';
import { getChatbotGraph } from './graph.js';
import type { ChatbotStateType } from './state.js';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ChainStageName = 'classify_intent' | 'llm' | 'tools' | 'sql_critic';

export type StreamEvent =
  | { type: 'token'; content: string }
  | { type: 'tool_start'; name: string; input: Record<string, unknown>; runId: string }
  | { type: 'tool_end'; name: string; output: string; runId: string }
  | { type: 'tool_error'; name: string; error: string }
  | { type: 'chain_stage'; stage: ChainStageName }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done'; messages: BaseMessage[] }
  | { type: 'error'; message: string };

export async function* streamQuery(
  input: BaseMessage[],
  threadId: string,
): AsyncGenerator<StreamEvent, void, undefined> {
  const graph = getChatbotGraph();
  const config = {
    configurable: { thread_id: threadId },
    metadata: { app: 'bballgenius-chatbot', model: getModel() },
  };

  try {
    const stream = await graph.streamEvents(
      { messages: input },
      { version: 'v2', configurable: { thread_id: threadId }, metadata: config.metadata },
    );

    const activeTools = new Map<string, string>();

    const GRAPH_NODE_NAMES = new Set<string>(['classify_intent', 'llm', 'tools', 'sql_critic']);

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
        activeTools.set(event.run_id, toolName);
        yield {
          type: 'tool_start',
          name: toolName,
          input: (event.data?.input || {}) as Record<string, unknown>,
          runId: event.run_id,
        };
      }

      if (event.event === 'on_tool_end') {
        const toolName = activeTools.get(event.run_id) || event.name || 'unknown';
        activeTools.delete(event.run_id);
        const output =
          typeof event.data?.output === 'string'
            ? event.data.output
            : JSON.stringify(event.data?.output || '');
        yield { type: 'tool_end', name: toolName, output, runId: event.run_id };
      }

      if (event.event === 'on_tool_error') {
        yield {
          type: 'tool_error',
          name: event.name || 'unknown',
          error: String(event.data?.error || 'Unknown tool error'),
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

    const state = await graph.getState(config);
    const messages = (state.values as ChatbotStateType)?.messages ?? [];
    yield { type: 'done', messages };
  } catch (err) {
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
