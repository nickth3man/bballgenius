import type { BaseMessage } from '@langchain/core/messages';
import { createFileRoute } from '@tanstack/react-router';

interface IncomingMessage {
  role: string;
  content: string;
}

async function toBaseMessages(messages: IncomingMessage[]): Promise<BaseMessage[]> {
  const { HumanMessage, AIMessage } = await import('@langchain/core/messages');
  const out: BaseMessage[] = [];
  for (const m of messages) {
    if (!m || typeof m.content !== 'string' || m.content.length === 0) continue;
    if (m.role === 'user') out.push(new HumanMessage(m.content));
    else if (m.role === 'assistant') out.push(new AIMessage(m.content));
  }
  return out;
}

function messageContentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '');
        }
        return '';
      })
      .join('');
  }
  return content == null ? '' : String(content);
}

function extractFinalAssistantContent(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || typeof message !== 'object') continue;
    const typedMessage = message as { _getType?: () => string; content?: unknown };
    if (typedMessage._getType?.() === 'ai') {
      const content = messageContentToString(typedMessage.content).trim();
      if (content) return content;
    }
  }
  return '';
}

/**
 * Server-Sent Events endpoint that streams the LangGraph agent's execution to
 * the chat UI: reasoning ("thinking") tokens, SQL tool calls + results, the
 * streamed answer tokens, and a final clean answer pulled from graph state.
 *
 * Each SSE `data:` line is one JSON-encoded event. The `done` event carries the
 * canonical final assistant content so the client can replace any noisy
 * accumulated tokens with the graph's authoritative answer.
 */
export const Route = createFileRoute('/api/chat-stream')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { messages?: IncomingMessage[] };
        const userMessages = body.messages ?? [];
        const lastMessage = userMessages[userMessages.length - 1];

        const encoder = new TextEncoder();
        const send = (
          controller: ReadableStreamDefaultController,
          event: Record<string, unknown>,
        ) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        if (!lastMessage?.content) {
          const stream = new ReadableStream({
            start(controller) {
              send(controller, {
                type: 'done',
                content: 'Hello! Ask me anything about NBA — players, games, stats, awards.',
              });
              controller.close();
            },
          });
          return new Response(stream, { headers: sseHeaders() });
        }

        if (!process.env['OPENROUTER_API_KEY']) {
          const stream = new ReadableStream({
            start(controller) {
              send(controller, {
                type: 'done',
                content:
                  'OpenRouter API key not configured. Set OPENROUTER_API_KEY to enable the chatbot.',
              });
              controller.close();
            },
          });
          return new Response(stream, { headers: sseHeaders() });
        }

        const { streamQuery } = await import('data/tabs/chatbot/agent');
        const { randomUUID } = await import('node:crypto');
        const threadId = randomUUID();
        const baseMessages = await toBaseMessages(userMessages);

        const stream = new ReadableStream({
          async start(controller) {
            let accumulated = '';
            let finalContent = '';
            // The orchestrator streams tokens from every node — planner JSON and
            // parallel worker findings are internal noise. Forward answer tokens
            // only from the synthesizer (single-agent path: the `llm` node), and
            // reasoning only from sequential stages (parallel workers interleave
            // token-by-token and would garble the thinking panel).
            let stage = '';
            try {
              for await (const event of streamQuery(baseMessages, threadId, request.signal)) {
                switch (event.type) {
                  case 'chain_stage':
                    stage = event.stage;
                    break;
                  case 'token':
                    if (isAnswerStage(stage)) {
                      accumulated += event.content;
                      send(controller, { type: 'token', content: event.content });
                    }
                    break;
                  case 'reasoning':
                    send(controller, { type: 'reasoning', content: event.content });
                    break;
                  case 'tool_start':
                    send(controller, {
                      type: 'tool_start',
                      name: event.name,
                      runId: event.runId,
                      sql:
                        typeof event.input?.['sql'] === 'string' ? event.input['sql'] : undefined,
                    });
                    break;
                  case 'tool_end':
                    send(controller, {
                      type: 'tool_end',
                      name: event.name,
                      runId: event.runId,
                      output: event.output,
                      durationMs: event.durationMs,
                    });
                    break;
                  case 'tool_error':
                    send(controller, {
                      type: 'tool_error',
                      name: event.name,
                      runId: event.runId,
                      error: event.error,
                    });
                    break;
                  case 'done':
                    finalContent = extractFinalAssistantContent(event.messages as unknown[]);
                    break;
                  case 'error':
                    send(controller, { type: 'error', message: event.message });
                    break;
                  default:
                    break;
                }
              }
              send(controller, { type: 'done', content: finalContent || accumulated });
            } catch (e: unknown) {
              send(controller, {
                type: 'error',
                message: `Error: ${e instanceof Error ? e.message : String(e)}`,
              });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, { headers: sseHeaders() });
      },
    },
  },
});

/**
 * Stages whose streamed content is the user-facing answer: the orchestrator's
 * synthesizer, or the `llm`/`finalize_turn` nodes on the single-agent path.
 */
function isAnswerStage(stage: string): boolean {
  return stage === 'orch_synthesize' || stage === 'llm' || stage === 'finalize_turn';
}

function sseHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  };
}
