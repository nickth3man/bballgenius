import { createFileRoute } from '@tanstack/react-router';
import { type ReactNode, useRef, useState } from 'react';
import { Button } from '../components/ui';

interface ToolCall {
  runId: string;
  name: string;
  sql?: string;
  output?: string;
  error?: string;
  durationMs?: number;
  status: 'running' | 'done' | 'error';
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  tools?: ToolCall[];
  pending?: boolean;
}

interface ApiChatMessage {
  role: ChatMessage['role'];
  content: string;
}

type StreamEvent =
  | { type: 'token'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_start'; name: string; runId: string; sql?: string }
  | { type: 'tool_end'; name: string; runId: string; output: string; durationMs?: number }
  | { type: 'tool_error'; name: string; runId: string; error: string }
  | { type: 'error'; message: string }
  | { type: 'done'; content: string };

function createMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return { id: crypto.randomUUID(), role, content };
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
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = createMessage('user', input);
    const apiHistory = [...messages, userMessage].map(toApiMessage);
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: assistantId, role: 'assistant', content: '', tools: [], pending: true },
    ]);
    setInput('');
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const update = (fn: (msg: ChatMessage) => ChatMessage) => {
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));
    };

    try {
      const res = await fetch('/api/chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiHistory }),
        signal: controller.signal,
      });

      if (!res.body) throw new Error('No response stream.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          const line = block.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as StreamEvent;
          applyEvent(event, update);
        }
      }
    } catch (e: unknown) {
      if (controller.signal.aborted) {
        update((m) => ({ ...m, pending: false }));
      } else {
        update((m) => ({
          ...m,
          pending: false,
          content: `Error: ${e instanceof Error ? e.message : String(e)}`,
        }));
      }
    } finally {
      update((m) => ({ ...m, pending: false }));
      setLoading(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
      </div>
      <div className="border-t border-border bg-surface p-3">
        <div className="flex gap-2">
          <input
            id="chat-input"
            name="chat-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Ask an NBA question..."
            disabled={loading}
            className="flex-1 rounded border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-primary disabled:opacity-50"
          />
          {loading ? (
            <Button variant="ghost" size="md" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" size="md" onClick={sendMessage} disabled={!input.trim()}>
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function applyEvent(event: StreamEvent, update: (fn: (m: ChatMessage) => ChatMessage) => void) {
  switch (event.type) {
    case 'token':
      update((m) => ({ ...m, content: m.content + event.content }));
      break;
    case 'reasoning':
      update((m) => ({ ...m, reasoning: (m.reasoning ?? '') + event.content }));
      break;
    case 'tool_start':
      update((m) => ({
        ...m,
        tools: [
          ...(m.tools ?? []),
          {
            runId: event.runId,
            name: event.name,
            status: 'running',
            ...(event.sql !== undefined ? { sql: event.sql } : {}),
          },
        ],
      }));
      break;
    case 'tool_end':
      update((m) => ({
        ...m,
        tools: (m.tools ?? []).map((t) =>
          t.runId === event.runId
            ? {
                ...t,
                output: event.output,
                status: 'done',
                ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
              }
            : t,
        ),
      }));
      break;
    case 'tool_error':
      update((m) => ({
        ...m,
        tools: (m.tools ?? []).map((t) =>
          t.runId === event.runId ? { ...t, error: event.error, status: 'error' } : t,
        ),
      }));
      break;
    case 'error':
      update((m) => ({ ...m, content: event.message, pending: false }));
      break;
    case 'done':
      update((m) => ({ ...m, content: event.content || m.content, pending: false }));
      break;
    default:
      break;
  }
}

// ─── Tool helpers ────────────────────────────────────────────────────────────

type ToolKind = 'sql' | 'schema' | 'tables' | 'tool';

function getToolKind(name: string): ToolKind {
  const n = name.toLowerCase();
  if (n.includes('query') || n.includes('sql') || n.includes('check')) return 'sql';
  if (n.includes('schema')) return 'schema';
  if (n.includes('table') || n.includes('list')) return 'tables';
  return 'tool';
}

function getToolBadge(kind: ToolKind): string {
  switch (kind) {
    case 'sql':
      return 'SQL';
    case 'schema':
      return 'SCHEMA';
    case 'tables':
      return 'TABLES';
    case 'tool':
      return 'TOOL';
  }
}

function getStatusColor(status: ToolCall['status']): string {
  switch (status) {
    case 'running':
      return 'text-info';
    case 'error':
      return 'text-danger';
    case 'done':
      return 'text-success';
  }
}

function formatToolName(name: string): string {
  const known: Record<string, string> = {
    query_nba_db: 'Query NBA Database',
    get_schema_info: 'Schema Lookup',
    list_nba_tables: 'List Tables',
    check_nba_sql: 'Validate SQL',
  };
  return known[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Components ──────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }): ReactNode {
  const isUser = msg.role === 'user';
  const hasTools = (msg.tools?.length ?? 0) > 0;
  const showThinking = !isUser && (msg.reasoning?.trim().length ?? 0) > 0;
  const showPlaceholder = !isUser && msg.pending && !msg.content && !showThinking && !hasTools;

  return (
    <div className={`mb-3 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          isUser ? 'bg-primary/30 text-fg' : 'bg-surface text-fg'
        }`}
      >
        {showThinking && <ThinkingPanel text={msg.reasoning ?? ''} active={!!msg.pending} />}
        {hasTools && msg.tools?.map((t) => <ToolPanel key={t.runId} tool={t} />)}
        {showPlaceholder ? (
          <div className="text-fg-muted">Thinking…</div>
        ) : (
          <div className="whitespace-pre-wrap">{msg.content}</div>
        )}
      </div>
    </div>
  );
}

function ThinkingPanel({ text, active }: { text: string; active: boolean }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="mb-2 rounded border border-border/60 bg-bg/40"
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 px-2 py-1 text-xs text-fg-muted">
        {active && <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />}
        <span>{active ? 'Thinking…' : 'Reasoning'}</span>
        <span className="ml-auto font-mono text-2xs tabular-nums text-fg-dim">{text.length}c</span>
      </summary>
      <div className="max-h-60 overflow-auto whitespace-pre-wrap border-t border-border/60 px-2 py-1 text-xs text-fg-muted">
        {text}
      </div>
    </details>
  );
}

function ToolPanel({ tool }: { tool: ToolCall }): ReactNode {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const kind = getToolKind(tool.name);
  const badge = getToolBadge(kind);

  const doCopy = async () => {
    if (!tool.sql) return;
    try {
      await navigator.clipboard.writeText(tool.sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silently fail
    }
  };

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="mb-2 rounded border border-border/60 bg-bg/40"
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 px-2 py-1 text-xs text-fg-muted">
        <span
          className={`font-mono text-2xs font-bold uppercase tracking-wide ${getStatusColor(tool.status)}`}
        >
          {badge}
        </span>
        <span className="text-fg-dim">{formatToolName(tool.name)}</span>
        {tool.status === 'running' && (
          <>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-info animate-pulse" />
            <span className="text-info">running…</span>
          </>
        )}
        {tool.durationMs != null && (
          <span className="ml-auto font-mono text-2xs tabular-nums text-fg-dim">
            {tool.durationMs}ms
          </span>
        )}
      </summary>
      <div className="border-t border-border/60 space-y-2 px-2 py-1">
        {tool.sql && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-2xs font-semibold uppercase tracking-wide text-fg-dim">
                SQL Query
              </span>
              <button
                type="button"
                onClick={doCopy}
                className="text-2xs text-fg-dim transition-colors hover:text-fg"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="max-h-60 overflow-auto rounded border-l-2 border-primary/40 bg-bg/80 p-2 text-xs text-fg">
              <code>{tool.sql}</code>
            </pre>
          </div>
        )}
        {tool.error ? (
          <div className="flex items-start gap-2">
            <span className="mt-0.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-danger" />
            <div className="whitespace-pre-wrap text-xs text-danger">{tool.error}</div>
          </div>
        ) : (
          tool.output && (
            <div>
              <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-fg-dim">
                Result
              </div>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-bg/40 p-2 text-xs text-fg-muted">
                {tool.output}
              </pre>
            </div>
          )
        )}
      </div>
    </details>
  );
}
