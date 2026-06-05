# packages/web/src/routes/

## Responsibility

Defines all TanStack Start file-based routes for the BBallGenius web app. Maps URL paths to React page components and server-side API handlers. Each `.tsx` file in this folder (and `api/` subfolder) registers a route via `createFileRoute()`. The auto-generated `routeTree.gen` consumes this folder structure; `router.tsx` builds the final `TanStackRouter` from it.

Six routes total:

| File | Path | Type | Purpose |
|------|------|------|---------|
| `__root.tsx` | — | Root shell + layout | HTML shell (`RootDocument`), nav-bar header + footer + `<Outlet>` (`RootLayout`), `RouterContext` with `QueryClient` |
| `index.tsx` | `/` | Redirect | `beforeLoad` throws `redirect({ to: '/game-center' })` |
| `game-center.tsx` | `/game-center` | Page | Recent games list + box score + shot chart |
| `time-machine.tsx` | `/time-machine` | Page | Player search + career stats + awards |
| `sql-sandbox.tsx` | `/sql-sandbox` | Page | Freeform SQL editor + schema browser + results table |
| `chat.tsx` | `/chat` | Page | Chat UI posting to `/api/copilotkit` |
| `api/copilotkit.ts` | `/api/copilotkit` | Server API | POST handler bridging chat client to LangGraph agent |

## Design

- **File-based routing** — Each non-`__root` file maps to its path via `createFileRoute()`. TanStack Start's codegen (`routeTree.gen`) reads the file tree and builds the router tree. No manual `Route` registration beyond the file export.
- **`__root.tsx` as layout shell** — Uses `createRootRouteWithContext<RouterContext>()` to inject `QueryClient` into all child routes. The `shellComponent` renders the `<html>`/`<head>`/`<body>` wrapper with `<HeadContent />` and `<Scripts />`. The `component` renders the nav header (hardcoded `TABS` array with `Link` components), `<Outlet />`, and footer. No nested layouts at subdirectory level.
- **Server functions for DB access** — Each route that touches DuckDB defines `createServerFn({method:'GET'|'POST'})` with a `.handler()` that dynamically imports from the `data` workspace package. This keeps SQL and DuckDB bindings server-only. The handler returns plain JSON serializable data.
- **Client data fetching** — Routes use either `@tanstack/react-query` (`useQuery`) or plain `useState`/`useCallback` to call server fns. `game-center.tsx` uses `useQuery` with `queryKey` for caching/invalidation. `time-machine.tsx` and `sql-sandbox.tsx` use manual `useState`/`useCallback` patterns.
- **`api/` server routes** — `api/copilotkit.ts` uses TanStack Start's `server.handlers` map (a server-only route pattern, not a client component). It dynamically imports LangChain message types and the `data/tabs/chatbot/agent` streamQuery to avoid CJS-ESM conflicts at build time.
- **Self-contained vs. shared components** — `game-center.tsx` and `time-machine.tsx` define all UI inline. `sql-sandbox.tsx` delegates to three shared components (`CodeEditor`, `ResultsTable`, `SchemaTree` from `../components/`). `chat.tsx` is self-contained.

## Flow

### Page routes (client-rendered)

```
Browser navigation
  │
  ▼
TanStack Router matches file route
  │
  ├─ Root shell (__root.tsx)
  │   ├─ shellComponent → <html><head><HeadContent /></head><body>
  │   └─ component (RootLayout)
  │       ├─ Header with nav tabs (Link components, data-[status=active] styling)
  │       ├─ <Outlet /> placeholder
  │       └─ Footer
  │
  └─ Route page component renders inside <Outlet />
      │
      ├─ On mount: calls createServerFn (GET or POST) via useQuery / manual fetch
      │     │
      │     ├─ Dynamic import from 'data' package → initDb() + query(sql)
      │     ├─ Query runs against DuckDB (read-only)
      │     └─ Returns JSON → component renders
      │
      └─ Subsequent user interactions → additional server fn calls
```

### API route (server-only)

```
Chat client POST /api/copilotkit { messages: [{role, content}, ...] }
  │
  ├─ Guard: empty last message → static greeting
  ├─ Guard: missing OPENROUTER_API_KEY → "not configured" error
  │
  ├─ toBaseMessages() → HumanMessage[] / AIMessage[]
  ├─ streamQuery(baseMessages, threadId) → async generator
  │   ├─ type "token"  → accumulate content
  │   ├─ type "done"   → extract final assistant reply from graph state
  │   └─ type "error"  → short-circuit
  │
  └─ Response.json({ messages: [{ role: "assistant", content }] })
```

## Integration

- **Data workspace package** — Route server fns dynamically import from `data` (e.g., `import('data').then(m => m.query(...))`). The `data` package resolves the DuckDB path via `resolveDbPath()`, which selects the CI fixture under `GITHUB_ACTIONS=true` or the local `data/nba.duckdb` otherwise.
- **Time-machine specific** — `loadPlayerDataFn` imports `loadCareerStats`/`loadPlayerAwards` from `data/tabs/time-machine/queries` and `formatTable` from `data/formatters`. Routes are the only place these schema-aware query modules are consumed; they are not exposed as public `data` package exports.
- **Chatbot agent** — `api/copilotkit.ts` imports `streamQuery` from `data/tabs/chatbot/agent`. The agent uses DuckDB tools (`query_nba_db`, `get_schema_info`, `list_nba_tables`, `check_nba_sql`) and the OpenRouter LLM bound in `graph.ts`. No persistence between requests (fresh `randomUUID()` thread ID per POST).
- **QueryClient / TanStack Query** — Injected via `RouterContext` from `__root.tsx`. Shared across all page routes. Configured with 30s `staleTime`. Used explicitly only in `game-center.tsx`; other routes use manual state.
- **Router configuration** — `router.tsx` imports the auto-generated `routeTree`, creates the router with the `RouterContext`, and wraps children with `QueryClientProvider`. No lazy-loading or code-splitting is configured (all routes bundled eagerly).
- **No CopilotKit runtime** — Despite the file name `api/copilotkit.ts`, the front-end (`chat.tsx`) uses a plain `fetch` POST to `/api/copilotkit` and renders messages manually. The CopilotKit React provider/hooks (`@copilotkit/react-core`, `@copilotkit/react-ui`) are **not** wired in this codebase.
