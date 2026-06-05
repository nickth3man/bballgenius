# packages/

Bun workspace monorepo root (`workspaces: ["packages/*"]`). Owns two private packages — `data` and `web` — that together form the BBallGenius application. Biome formatting/linting targets `packages/*/src/**/*.{ts,tsx}` via the root `biome.json`.

## Packages

| Package | Role | Key Tech |
|---------|------|----------|
| `data/` | Data & agent layer | DuckDB, LangGraph, LangChain, Zod v4 |
| `web/`  | Frontend UI | TanStack Start, React 19, CopilotKit, Tailwind v4, Vite |

See child codemaps: [`data/codemap.md`](./data/codemap.md), [`web/codemap.md`](./web/codemap.md).

## Responsibility

Orchestrate the two-package split: **`data` owns all database access, business logic, and the chatbot agent**; **`web` owns the browser-facing UI and server-side API routes**. Neither package imports across into the other's domain — `web` consumes `data` exclusively through its declared workspace exports.

## Design

- **Workspace protocol**: `web/package.json` declares `"data": "workspace:*"`, importing only the specific export subpaths `data` chooses to expose (e.g. `data/tabs/game-center/queries`, `data/tabs/chatbot/agent`).
- **No circular deps**: `data` has zero awareness of `web` — no React, no router, no CopilotKit imports. `web` is the sole consumer.
- **Export gating**: `data/package.json` `"exports"` map enumerates exactly 15 entry points (DB core, formatters, theme, errors, tab queries, chatbot internals). Anything not in this map is private to `data`.
- **Typecheck isolation**: Each package runs its own `tsc --noEmit`. The root `typecheck` script only checks `data`; `web` is checked via `bun --filter web typecheck`.
- **Biome scope**: Root `biome.json` `includes` pattern `packages/*/src/**/*.{ts,tsx}` applies the same lint/format rules to both packages (single quotes, semicolons, 100-char width, 2-space indent, `noExplicitAny` error, `organizeImports` on save).

## Flow

```
User browser  -->  TanStack Start SSR/server routes (web)
                       │
                       │  imports via "data": "workspace:*"
                       ▼
               data package exports
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
    Tab queries   Chatbot agent   Shared utils
   (DuckDB SQL)   (LangGraph)    (formatters, etc.)
         │             │
         ▼             ▼
    Local DuckDB   OpenRouter API
    (nba.duckdb)   (LLM inference)
```

For the chatbot path specifically:

```
CopilotKit chat UI (web)  →  api/copilotkit route (web server)
                                   │
                            CopilotKit runtime
                                   │
                            data's LangGraph agent
                                   │
                     ┌─────────────┼─────────────┐
                     ▼             ▼             ▼
               DuckDB query   Schema info    SQL critic
               tools          tools          (error loop)
```

## Integration

- **Database path**: Both packages resolve the active DuckDB file through `data/src/shared/dbPath.ts` (`resolveDbPath()`), which respects `NBA_DUCKDB_PATH` env, CI fixture fallback, and local default.
- **CI fixture**: `data/fixtures/nba.ci.duckdb` (~2.8 MB) is used in CI by both packages — `web` runs inside TanStack Start which calls data's queries against this fixture.
- **Tooling chain**: Root scripts (`bun run web`, `bun run build:web`, `bun --filter data test`) dispatch into each package. `bun run ci` cascades through lint → format:check → typecheck → unit test → audit, covering both packages.
- **No shared build step**: No barrel re-export or shared `dist/` — each package is consumed directly from source via workspace protocol, relying on Bun's native TS resolution.
