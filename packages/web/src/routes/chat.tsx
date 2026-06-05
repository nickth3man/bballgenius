import { createFileRoute } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ApiChatMessage {
  role: ChatMessage['role'];
  content: string;
}

function createMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
  };
}

function toApiMessage({ role, content }: ChatMessage): ApiChatMessage {
  return { role, content };
}

export const Route = createFileRoute('/chat')({
  component: ChatPage,
});

function ChatPage(): ReactNode {
  const [messages, setMessages] = useState<ChatMessage[]>([
    createMessage(
      'assistant',
      'Welcome to BBallGenius Chat! Ask me anything about NBA — players, games, stats, awards, and more.',
    ),
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = createMessage('user', input);
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/copilotkit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages.map(toApiMessage) }),
      });

      const data = (await res.json()) as { messages?: ApiChatMessage[] };
      const assistantMessages = (
        data.messages ?? [{ role: 'assistant', content: 'No response.' }]
      ).map(({ role, content }) => createMessage(role, content));

      setMessages((prev) => [...prev, ...assistantMessages]);
    } catch (e: unknown) {
      setMessages((prev) => [
        ...prev,
        createMessage('assistant', `Error: ${e instanceof Error ? e.message : String(e)}`),
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`mb-3 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user' ? 'bg-primary/30 text-fg' : 'bg-surface text-fg'
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-surface px-3 py-2 text-sm text-fg-muted">Thinking...</div>
          </div>
        )}
      </div>
      <div className="border-t border-border bg-surface p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Ask an NBA question..."
            disabled={loading}
            className="flex-1 rounded border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-primary disabled:opacity-50"
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-bg hover:bg-primary/90 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
