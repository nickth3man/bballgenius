import { createFileRoute } from '@tanstack/react-router';

interface IncomingMessage {
  role: string;
  content: string;
}

async function toBaseMessages(messages: IncomingMessage[]): Promise<unknown[]> {
  // Convert the chat client's {role, content}[] history into the LangChain
  // BaseMessage[] shape the chatbot graph consumes. The `@langchain/core`
  // import is dynamic because the package is CJS-only and Vite can't statically
  // resolve named exports from it for a server route file; loading it inside
  // the handler keeps the route's module graph server-only and side-effect
  // free. Unknown roles are dropped rather than guessed at — the client only
  // sends user/assistant today.
  const { HumanMessage, AIMessage } = await import('@langchain/core/messages');
  const out: unknown[] = [];
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

export const Route = createFileRoute('/api/copilotkit')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { messages?: IncomingMessage[] };
          const userMessages = body.messages ?? [];
          const lastMessage = userMessages[userMessages.length - 1];

          if (!lastMessage?.content) {
            return Response.json({
              messages: [
                {
                  role: 'assistant',
                  content: 'Hello! Ask me anything about NBA — players, games, stats, awards.',
                },
              ],
            });
          }

          if (!process.env['OPENROUTER_API_KEY']) {
            return Response.json({
              messages: [
                {
                  role: 'assistant',
                  content:
                    'OpenRouter API key not configured. Set OPENROUTER_API_KEY to enable the chatbot.',
                },
              ],
            });
          }

          // Hand the conversation history to the LangGraph ReAct agent. The
          // raw token stream may include planner/tool-call protocol text, so
          // the HTTP response uses the final graph state (`done.messages`) and
          // only falls back to accumulated tokens if the graph never emits it.
          const { streamQuery } = await import('data/tabs/chatbot/agent');
          const { randomUUID } = await import('node:crypto');
          const threadId = randomUUID();
          const baseMessages = await toBaseMessages(userMessages);
          let content = '';
          let finalAssistantContent = '';
          let errorMessage: string | null = null;

          for await (const event of streamQuery(baseMessages as never, threadId)) {
            if (event.type === 'token') {
              content += event.content;
            } else if (event.type === 'done') {
              finalAssistantContent = extractFinalAssistantContent(event.messages as unknown[]);
            } else if (event.type === 'error') {
              errorMessage = event.message;
              break;
            }
          }

          const finalContent = errorMessage ?? (finalAssistantContent || content);
          if (!finalContent) {
            return Response.json({
              messages: [
                {
                  role: 'assistant',
                  content: 'The chatbot returned no response. Check the server logs for details.',
                },
              ],
            });
          }

          return Response.json({
            messages: [{ role: 'assistant', content: finalContent }],
          });
        } catch (e: unknown) {
          // Return 200 with the error inside the chat message envelope so
          // TanStack Start's error boundary doesn't replace the body with its
          // own default error page. The client renders the message either way.
          return Response.json({
            messages: [
              {
                role: 'assistant',
                content: `Error: ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
          });
        }
      },
    },
  },
});
