# `packages/web/src/routes/api/`

## Responsibility

Two server-side API routes bridging chat client requests to the LangGraph ReAct agent in the `data` workspace package:

1. **`/api/chat-stream`** (`chat-stream.ts`) — Server-Sent Events (SSE) endpoint that streams the agent's execution to the chat UI: reasoning tokens, SQL tool calls + results, streamed answer tokens, and a final clean answer from graph state. Used by the custom chat page (`chat.tsx`).

2. **`/api/copilotkit`** (`copilotkit.ts`) — JSON-based POST endpoint that accepts a chat-message envelope and returns the final assistant reply. An earlier iteration; simpler but lacks the full streaming experience.

Both are TanStack Start `server.handlers.POST` routes that transform wire-format messages into LangChain `BaseMessage[]`, invoke the DuckDB-backed agent, and return results.

## Design

### `/api/copilotkit` (JSON response, legacy)

- **Single request-response** — Accepts `{ messages: [{role, content}] }`, returns `{ messages: [{role, content}] }`.
- **Content extraction** — Consumes `streamQuery()` async generator, collecting:
  - `done` event → final graph-state messages (highest priority).
  - `token` events → raw token accumulation (fallback).
  - `error` event → short-circuit with error string.
- **Error containment** — All exceptions caught and returned as 200 JSON with `"Error: ..."` message, preventing TanStack Start's error boundary from replacing the body.

### `/api/chat-stream` (SSE streaming, current)

- **Server-Sent Events** — Returns `text/event-stream` with `Cache-Control: no-cache, no-transform` and `Connection: keep-alive`. Each `data:` line is a JSON-encoded `StreamEvent`:
  - `{ type: "token", content }` — Answer token from synthesizer/LLM nodes (filtered by `isAnswerStage()`: only `orch_synthesize`, `llm`, `finalize_turn` stages).
  - `{ type: "reasoning", content }` — Reasoning/thinking tokens from sequential stages.
  - `{ type: "tool_start", name, runId, sql? }` — Tool invocation with optional SQL input.
  - `{ type: "tool_end", name, runId, output, durationMs? }` — Tool result.
  - `{ type: "tool_error", name, runId, error }` — Tool failure.
  - `{ type: "done", content }` — Final clean answer from graph state (canonical — replaces accumulated tokens).
  - `{ type: "error", message }` — Error signal.
- **Stage filtering** — `isAnswerStage(stage)` ensures only final answer tokens reach the client, hiding internal planner/worker protocol noise.
- **Dynamic imports** — Same pattern as copilotkit: `@langchain/core/messages`, `data/tabs/chatbot/agent` imported dynamically.

### Shared patterns (both files)

- **Dynamic CJS import isolation** — `@langchain/core/messages` and `data/tabs/chatbot/agent` imported inside handler bodies to keep module graph server-only and avoid Vite CJS resolution failures.
- **Message conversion** — Both use an identical `toBaseMessages()` helper mapping `{role, content}` wire format to `HumanMessage`/`AIMessage`. Unknown roles silently dropped.
- **Guards** — Both check for empty last message (static greeting) and missing `OPENROUTER_API_KEY` (configured error).
- **Thread scoping** — Both generate a fresh `randomUUID()` thread ID per request, so each POST is an independent graph invocation.

## Flow

```
Chat client (chat.tsx)
  │
  ├─ POST /api/chat-stream { messages: [...] }
  │     │
  │     └─ SSE stream ← event.type switch:
  │         ├─ "token"       → append to message content
  │         ├─ "reasoning"   → append to thinking panel
  │         ├─ "tool_start"  → add tool call to UI
  │         ├─ "tool_end"    → update tool with output
  │         ├─ "tool_error"  → mark tool as error
  │         ├─ "done"        → finalize message
  │         └─ "error"       → show error in message
  │
  └─ (alternative) POST /api/copilotkit { messages: [...] }
        │
        └─ Response.json({ messages: [{ role, content }] })
```

## Integration

- **Consumer** — `routes/chat.tsx` uses `fetch` to POST to `/api/chat-stream` (primary) or `/api/copilotkit`. The chat page renders `StreamEvent` types via local state transitions.
- **Upstream dependency** — Both routes import `streamQuery()` from `data/tabs/chatbot/agent` (the LangGraph ReAct graph bound to OpenRouter + DuckDB). The agent executes SQL queries (`query_nba_db`), schema discovery (`get_schema_info`, `list_nba_tables`), and SQL validation/critique (`check_nba_sql`) with up to 3 retry cycles.
- **State scoping** — Fresh `randomUUID()` thread ID per request — no continuity between turns. Multi-turn memory requires wiring `CHATBOT_PERSIST_DIR`.
- **Environment** — Requires `OPENROUTER_API_KEY`. Optional `MODEL`, `NBA_DUCKDB_PATH`, `CHATBOT_DEBUG`, `CHATBOT_PERSIST_DIR`, `CHATBOT_METRICS_DIR` affect the downstream agent.
