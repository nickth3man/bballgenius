# packages/web/

## Responsibility

TanStack Start (SSR) web application — the user-facing UI for BBallGenius. Serves four feature pages (Game Center, Career Time-Machine, SQL Sandbox, Chat) plus a single server API route that bridges the chat UI to the LangGraph agent in the `data` workspace package. Owns the Vite dev server, production build, and all client-side rendering.

## Design

- **Framework**: TanStack Start (`@tanstack/react-start` v1.168) on Vite 8, React 19, with SSR enabled (`ssr: true` in routeTree.gen). Dev server on port 3000.
- **Routing**: File-based routing via `@tanstack/react-router` v1.170. The generated `routeTree.gen.ts` maps 6 flat routes under a single root shell (`__root.tsx`). No nested layouts.
  | Path | Route file | Purpose |
  |------|-----------|---------|
  | `/` | `index.tsx` | Redirects to `/game-center` |
  | `/game-center` | `game-center.tsx` | Recent games list + box score viewer |
  | `/time-machine` | `time-machine.tsx` | Player search, career stats, awards, BBR views |
  | `/sql-sandbox` | `sql-sandbox.tsx` | Interactive SQL editor, schema tree, results table |
  | `/chat` | `chat.tsx` | NBA chatbot with message history input |
  | `/api/copilotkit` | `api/copilotkit.ts` | Server-side POST handler for LangGraph agent |
- **Data fetching**: Routes use `createServerFn` (TanStack Start server functions) for GET/POST DB queries. The root shell provides a `QueryClient` (30s stale time) via `QueryClientProvider`. `useQuery` is used in `game-center.tsx` for client-side caching.
- **Styling**: Tailwind CSS v4 with TokyoNight semantic color tokens defined in `styles/app.css` via `@theme`. Tokens (`bg`, `surface`, `fg`, `primary`, etc.) align with `packages/data/src/shared/theme.ts`.
- **Chat client**: Simple fetch-based POST to `/api/copilotkit` (no CopilotKit React provider). The CopilotKit npm packages (`@copilotkit/react-core`, `@copilotkit/react-ui`, `@copilotkit/runtime`) are listed in `package.json` but the active chat route uses a custom minimal implementation.
- **Vite/SSR configuration** (`vite.config.ts`):
  - LangChain/LangGraph stack (`@langchain/core`, `@langchain/openai`, `@langchain/langgraph`, `langchain`, `langsmith`) is bundled via `ssr.noExternal` so Vite resolves their subpath imports.
  - DuckDB native bindings (`@duckdb/node-api`, `@duckdb/node-bindings`) are externalized and excluded from Vite dep optimization.
  - Plugins: `tanstackStart()`, `react()`, `tailwindcss()`.

## Flow

```
User browser
  │
  ├─ GET / → 302 redirect → /game-center
  ├─ /game-center → createServerFn('GET') → data package → DuckDB → recent games + box scores
  ├─ /time-machine → createServerFn('POST') → data package → DuckDB → player search/stats/awards
  ├─ /sql-sandbox → createServerFn('POST') → data package → DuckDB → ad-hoc SQL
  │   └─ Components: CodeEditor (CodeMirror 6), SchemaTree, ResultsTable (TanStack Table)
  │
  └─ /chat → POST /api/copilotkit
       └─ Dynamic import: data/tabs/chatbot/agent → streamQuery() → LangGraph → OpenRouter + DuckDB
```

### SQL Sandbox data flow (component detail)

```
SqlSandboxPage (route)
  │  sqlText state (useState)
  │
  ├─ SchemaTree ──onSelectTable──▶ appends "SELECT * FROM tbl" to sqlText
  │                onSelectColumn─▶ appends ", col_name" to sqlText
  │
  ├─ CodeEditor ──onChange──▶ updates sqlText
  │               onRun──────▶ triggers runQuery()
  │
  └─ ResultsTable ◀── data/loading/error/elapsedMs props ◀── runQuery state
```

### Chat data flow

```
ChatPage (route)
  │
  ├─ User types → { role: "user", content } added to local messages[]
  │
  └─ POST /api/copilotkit { messages: [{role, content}, ...] }
       └─ api/copilotkit.ts (server handler)
            ├─ toBaseMessages() → HumanMessage[] / AIMessage[]  (dynamic import @langchain/core/messages)
            ├─ randomUUID() as threadId
            ├─ streamQuery(messages, threadId)   (dynamic import data/tabs/chatbot/agent)
            │   ├─ "token" events → accumulate content
            │   ├─ "done"  event → extract final assistant message from graph state (preferred)
            │   └─ "error" event → capture error string, break
            ├─ finalContent = errorMessage ?? (finalAssistantContent || accumulatedTokens)
            └─ Response 200 { messages: [{ role: "assistant", content: finalContent }] }
```

## Integration

### Child codemaps

| Path | Coverage |
|------|----------|
| `src/codemap.md` | Top-level source layout: router, styles, route tree |
| `src/routes/codemap.md` | Route modules, server functions, page components |
| `src/routes/api/codemap.md` | `/api/copilotkit` — LangGraph agent bridge |
| `src/components/codemap.md` | CodeEditor, SchemaTree, ResultsTable (SQL Sandbox) |

### Workspace dependency: `data` (`"data": "workspace:*"`)

The web package imports from the `data` workspace package via its export map:

| Web usage | Data export | Purpose |
|-----------|-------------|---------|
| `game-center.tsx` | `data` → `initDb()`, `query()` | Recent games + box scores from DuckDB |
| `time-machine.tsx` | `data`, `data/formatters`, `data/tabs/time-machine/queries` | Player search, stats, awards |
| `sql-sandbox.tsx` | `data` → `query()` | Ad-hoc SQL execution |
| `api/copilotkit.ts` | `data/tabs/chatbot/agent` → `streamQuery()` | LangGraph ReAct agent invocation |

All DuckDB access flows through the `data` package — the web layer never opens a database connection directly. Server functions (`createServerFn`) are the exclusive bridge between UI components and the data layer.

### Environment variables consumed

| Variable | Affects |
|----------|---------|
| `OPENROUTER_API_KEY` | Chat endpoint — required for agent invocation |
| `NBA_DUCKDB_PATH` | All `createServerFn` handlers (via `resolveDbPath()` in `data` package) |
| `MODEL` | Chat endpoint — model selection forwarded to agent |
| `CHATBOT_*` | Chat endpoint — agent behavior (debug, persist dir, metrics) |

### Key scripts (from `package.json`)

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `vite dev` | Development server (port 3000, HMR, SSR) |
| `build` | `vite build` | Production build (SSR bundle + client assets) |
| `start` | `vite preview` | Preview production build locally |
| `typecheck` | `tsc --noEmit -p tsconfig.json` | Type-check src/ + vite.config.ts |
