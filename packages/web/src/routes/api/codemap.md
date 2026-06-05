# packages/web/src/routes/api/

## Responsibility

Single server-side API route (`/api/copilotkit`) bridging CopilotKit chat client requests to the LangGraph ReAct agent in the `data` workspace package. It is a TanStack Start `server.handlers.POST` route that accepts a chat-message JSON envelope, transforms it into LangChain `BaseMessage[]`, invokes the duckdb-backed agent, and returns the final assistant reply inside the same envelope. No other API routes exist in this folder.

## Design

- **Single file, single route** — `copilotkit.ts` exports a `Route` registered via `createFileRoute('/api/copilotkit')` with a `POST` handler. There is no router dispatch or middleware layer.
- **Dynamic CJS import isolation** — `@langchain/core/messages` and `data/tabs/chatbot/agent` are imported dynamically inside the handler body. This keeps the route's module graph server-only and avoids Vite CJS resolution failures for the LangChain dependency.
- **Message conversion** — `toBaseMessages()` maps the wire-format `{role, content}[]` to `HumanMessage`/`AIMessage` instances. Unknown roles are silently dropped. Empty/missing content entries are skipped.
- **Content extraction** — The handler consumes the `streamQuery()` async generator, collecting three possible outputs:
  - `done` event → final graph-state messages (highest priority).
  - `token` events → raw token accumulation (fallback when no `done` event emitted).
  - `error` event → short-circuit with error string.
- **Error containment** — All exceptions are caught and returned as a 200 JSON response with an `"Error: ..."` assistant message. This prevents TanStack Start's error boundary from replacing the body with a generic error page.

## Flow

```
Chat client POST /api/copilotkit { messages: [{role, content}, ...] }
  │
  ├─ Guard: empty last message → returns static greeting "Hello! Ask me..."
  ├─ Guard: missing OPENROUTER_API_KEY → returns "API key not configured"
  │
  ├─ toBaseMessages(messages)           → HumanMessage[] / AIMessage[]
  ├─ randomUUID() as threadId
  ├─ streamQuery(baseMessages, threadId) → async generator of StreamEvent
  │   ├─ type "token"  → content += event.content
  │   ├─ type "done"   → extractFinalAssistantContent(event.messages)
  │   └─ type "error"  → errorMessage = event.message, break
  │
  ├─ finalContent = errorMessage ?? (finalAssistantContent || content)
  │
  └─ Response.json({ messages: [{ role: "assistant", content: finalContent }] })
```

## Integration

- **Consumer** — The CopilotKit chat front-end (in `packages/web/src/routes/chat/` or a CopilotKit provider) POSTs to `/api/copilotkit` with the standard `{messages: [...]}` envelope and receives assistant replies in the same format.
- **Upstream dependency** — `data/tabs/chatbot/agent` exports `streamQuery()`, the LangGraph ReAct graph bound to OpenRouter and DuckDB. The graph executes SQL queries (`query_nba_db`), schema discovery (`get_schema_info`, `list_nba_tables`), and SQL validation/critique (`check_nba_sql`) with up to 3 retry cycles.
- **State scoping** — A fresh `randomUUID()` thread ID is generated per request, so each POST spawns an independent graph invocation with no continuity between turns. Multi-turn memory requires wiring `CHATBOT_PERSIST_DIR` + threading session IDs from the client.
- **Environment** — Requires `OPENROUTER_API_KEY`. Optional `MODEL`, `NBA_DUCKDB_PATH`, `CHATBOT_DEBUG`, `CHATBOT_PERSIST_DIR`, `CHATBOT_METRICS_DIR` affect the downstream agent.
