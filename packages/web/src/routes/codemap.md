# `packages/web/src/routes/`

## Responsibility

Defines all TanStack Start file-based routes for the BBallGenius web app. Maps URL paths to React page components and server-side API handlers. Each `.tsx` file in this folder (and `api/` subfolder) registers a route via `createFileRoute()`. The auto-generated `routeTree.gen` consumes this folder structure; `router.tsx` builds the final `TanStackRouter` from it.

Seven routes total:

| File | Path | Type | Purpose |
|------|------|------|---------|
| `__root.tsx` | — | Root shell + layout | HTML shell (`RootDocument`), nav-bar header + footer + `<Outlet>` (`RootLayout`), `RouterContext` with `QueryClient` |
| `index.tsx` | `/` | Redirect | `beforeLoad` throws `redirect({ to: '/game-center' })` |
| `game-center.tsx` | `/game-center` | Page | Recent games list + box score + shot chart |
| `time-machine.tsx` | `/time-machine` | Page | Player search + career dossier + awards |
| `time-machine/server-fns.ts` | — | Server functions | 5 `createServerFn` modules for player search/dossier |
| `sql-sandbox.tsx` | `/sql-sandbox` | Page | Freeform SQL editor + schema browser + results table |
| `chat.tsx` | `/chat` | Page | Chat UI posting to `/api/chat-stream` |
| `api/chat-stream.ts` | `/api/chat-stream` | Server API | SSE endpoint streaming LangGraph agent execution |
| `api/copilotkit.ts` | `/api/copilotkit` | Server API | POST handler bridging chat client to LangGraph agent |

## Design

- **File-based routing** — Each non-`__root` file maps to its path via `createFileRoute()`. TanStack Start's codegen (`routeTree.gen`) reads the file tree and builds the router tree. No manual `Route` registration beyond the file export.
- **`__root.tsx` as layout shell** — Uses `createRootRouteWithContext<RouterContext>()` to inject `QueryClient` into all child routes. The `shellComponent` renders the `<html>`/`<head>`/`<body>` wrapper with `<HeadContent />` and `<Scripts />`. The `component` renders the nav header (hardcoded `TABS` array with `Link` components), `<Outlet />`, and footer. No nested layouts at subdirectory level.
- **Server functions for DB access** — Each route that touches DuckDB defines `createServerFn({method:'GET'|'POST'})` with a `.handler()` that dynamically imports from the `data` workspace package. This keeps SQL and DuckDB bindings server-only. The handler returns plain JSON serializable data.
- **Client data fetching** — Routes use either `@tanstack/react-query` (`useQuery`) or plain `useState`/`useCallback` to call server fns. `game-center.tsx` uses `useQuery` with `queryKey` for caching/invalidation. `time-machine.tsx` and `sql-sandbox.tsx` use manual `useState`/`useCallback` patterns.
- **`api/` server routes** — Use TanStack Start's `server.handlers` map (server-only route patterns, not client components). `chat-stream.ts` returns an SSE stream; `copilotkit.ts` returns JSON. Both dynamically import LangChain message types and `data/tabs/chatbot/agent` to avoid CJS-ESM conflicts at build time.
- **Self-contained vs. shared components** — `game-center.tsx` and `time-machine.tsx` define most UI inline but delegate to shared components. `sql-sandbox.tsx` uses three shared components (`CodeEditor`, `ResultsTable`, `SchemaTree`). `chat.tsx` is fully self-contained with its own `MessageBubble`, `ThinkingPanel`, and `ToolPanel` sub-components.

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

### API routes (server-only)

```
Chat client POST /api/chat-stream { messages: [...] }
  │
  └─ SSE stream: ReadableStream + TextEncoder
      ├─ "token" events (stage-filtered to answer nodes)
      ├─ "reasoning" events
      ├─ "tool_start" / "tool_end" / "tool_error" events
      ├─ "done" event with canonical final content
      └─ "error" event on failure

Chat client POST /api/copilotkit { messages: [...] }
  │
  └─ Response.json({ messages: [{ role: "assistant", content }] })
```

## Integration

- **Data workspace package** — Route server fns dynamically import from `data` (e.g., `import('data').then(m => m.query(...))`). The `data` package resolves the DuckDB path via `resolveDbPath()`, which selects the CI fixture under `GITHUB_ACTIONS=true` or the local `data/nba.duckdb` otherwise.
- **Time-machine specific** — `time-machine/server-fns.ts` contains 5 `createServerFn` functions: `searchPlayersFn`, `loadPlayerDossierFn`, `loadDefaultPlayerFn`, `loadFeaturedPlayersFn`, `loadPlayerByIdFn`. Search uses raw SQL with ILIKE; dossier loader delegates to `data/tabs/time-machine/queries.loadPlayerDossier()`. All return `PlayerResult[]` or `PlayerDossier`.
- **Chatbot agent** — Both API routes import `streamQuery` from `data/tabs/chatbot/agent`. The agent uses DuckDB tools and the OpenRouter LLM bound in `graph.ts`. No persistence between requests.
- **QueryClient / TanStack Query** — Injected via `RouterContext` from `__root.tsx`. Shared across all page routes. Configured with 30s `staleTime`. Used explicitly only in `game-center.tsx`; other routes use manual state.
- **Router configuration** — `router.tsx` imports the auto-generated `routeTree`, creates the router with the `RouterContext`, and wraps children with `QueryClientProvider`. No lazy-loading or code-splitting is configured (all routes bundled eagerly).
- **No CopilotKit runtime** — The chat front-end (`chat.tsx`) uses a plain `fetch` POST to `/api/chat-stream` and renders messages/events manually. The `@copilotkit/react-core` and `@copilotkit/react-ui` packages are listed in `package.json` but are **not** wired.
