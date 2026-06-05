# packages/data/src/tabs/

## Responsibility

Orchestration layer that groups DuckDB query modules by **feature area** (tab). Each subdirectory is a self-contained module that exposes typed query functions, utility classes, and — in the case of the chatbot — an entire LangGraph agent and evaluation harness. These modules are the data backend for the four principal web UI tabs.

**Boundary rule:** Tab modules must not import sibling tabs. Imports are restricted to `../../core/` (db connection, types) and `../../shared/` (formatters, theme, path resolution). Each tab owns its own schema scope and must not reach into another tab's internals.

## Design

### Four feature areas

| Directory | Package alias prefix | Purpose |
|-----------|---------------------|---------|
| `gameCenter/` | `data/tabs/game-center/` | Recent games, box scores, shot-chart data |
| `timeMachine/` | `data/tabs/time-machine/` | Player career search, season-by-season stats, team lookup, awards (dual-DB: primary + optional honors DB) |
| `sqlSandbox/` | `data/tabs/sql-sandbox/` | Ad-hoc SQL execution, schema tree browsing, SQL autocomplete state machine |
| `chatbot/` | `data/tabs/chatbot/` | LangGraph ReAct agent + tools, DuckDB chatbot connection, system prompt builder, OpenRouter model config, eval suite |

### Shared patterns across tabs

- **Typed query functions** — each `queries.ts` exports `async` functions that call `query<T>()` from `../../core/db.ts` with raw SQL strings and optional DuckDB `$1`-style positional parameters. Return types are declared locally as interfaces mirroring SELECT column aliases.
- **No query builder / ORM** — all SQL is hand-written.
- **No runtime ORM caching** — DuckDB connections are stateless; schema introspection (`getColumns`, `getTables`) is cached in module-level `Map`s and invalidated via explicit `invalidateSchemaCache()`.
- **Read-only at all times** — DuckDB instances open with `access_mode: 'READ_ONLY'`.

### Subdirectory architectures

Each tab has a `codemap.md` describing its internal structure. Brief summaries:

- **gameCenter/** — single `queries.ts`. Three functions: `loadRecentGames`, `loadBoxScoreWithTeamDedup`, `loadGameShots`. Uses a `DISTINCT ON` CTE for team-dedup. [See child codemap](gameCenter/codemap.md).
- **timeMachine/** — `queries.ts` + `utils/` helpers. Nine export functions covering player search, career stats (with deduplication via `utils/careerStats.ts`), awards (dual-DB fallback via `../../core/dbHonors.ts`), team lookup, season stats, and roster. [See child codemap](timeMachine/codemap.md).
- **sqlSandbox/** — three modules: `queries.ts` (thin re-export of `runSandboxQuery` + `loadSchemaCatalog`), `autocomplete.ts` (pure `SqlAutocomplete` class, not yet wired in web UI), `schemaBrowser.ts` (pure `SchemaBrowser` tree model, not yet wired). All re-export `getTables`/`getColumns` from core. [See child codemap](sqlSandbox/codemap.md).
- **chatbot/** — the largest tab. Contains:
  - `db.ts` — standalone DuckDB connection for the chatbot (separate from `core/db.ts`; uses `search_path = 'unified_star,main'`).
  - `systemPrompt.ts` — dynamically builds the LLM system prompt by introspecting the live schema (discovered tables, core table columns, source priority rules, SQL cookbook).
  - `openrouter.ts` — model name state (`getModel`/`setModel`), model list fetcher with TTL cache.
  - `agent/` — LangGraph graph definition (`graph.ts`), state schema (`state.ts`), tools (`tools.ts`, `schemaConstants.ts`), streaming (`streaming.ts`), and index.
  - `utils/` — SQL validation/extraction/execution, retry, metrics, stream formatting.
  - `eval/` — 100 categorized NBA test queries, question matrix, iteration harness.
  - `__tests__/` — Bun tests with LangChain/DB mocking.
  [See child codemap](chatbot/codemap.md).

### Exports via package.json

The `packages/data/package.json` `"exports"` map exposes each tab module under a **kebab-case alias** matching the web import convention:

```json
"./tabs/game-center/queries":     "./src/tabs/gameCenter/queries.ts"
"./tabs/time-machine/queries":    "./src/tabs/timeMachine/queries.ts"
"./tabs/sql-sandbox/queries":     "./src/tabs/sqlSandbox/queries.ts"
"./tabs/sql-sandbox/autocomplete": "./src/tabs/sqlSandbox/autocomplete.ts"
"./tabs/sql-sandbox/schema-browser": "./src/tabs/sqlSandbox/schemaBrowser.ts"
"./tabs/chatbot/system-prompt":   "./src/tabs/chatbot/systemPrompt.ts"
"./tabs/chatbot/db":              "./src/tabs/chatbot/db.ts"
"./tabs/chatbot/openrouter":      "./src/tabs/chatbot/openrouter.ts"
"./tabs/chatbot/agent":           "./src/tabs/chatbot/agent/index.ts"
"./tabs/chatbot/utils":           "./src/tabs/chatbot/utils/index.ts"
"./tabs/chatbot/eval":            "./src/tabs/chatbot/eval/index.ts"
```

Consumers in `packages/web/` and scripts import via `import { ... } from 'data/tabs/<alias>'`.

## Flow

### General data flow

```
Web TanStack Start route (server function)
    │
    │ import from 'data/tabs/<tab-alias>'
    ▼
Tab query function (e.g. loadRecentGames, runSandboxQuery)
    │
    │ calls query<T>(sql, params?) from ../../core/db.ts
    ▼
initDb() → DuckDBInstance.fromCache(resolveDbPath(), READ_ONLY) → connection.runAndReadAll()
    │
    ▼
Typed row array (JSON-safe via getRowObjectsJson)
```

### Chatbot-specific flow (agent graph)

```
CopilotKit API handler
    │
    │ invokes getChatbotGraph() → LangGraph compiled graph
    ▼
START → classify_intent (keyword, no LLM) → llm (bound tools) → tools (ToolNode) → sql_critic
    │                                                                       │
    │                                                                  [error + retries<3] ──→ llm (retry)
    │                                                                       │
    │                                                                  [error + retries≥3]
    ▼                                                                       ▼
END                                                                        END
```

Streaming: `streamQuery()` yields typed `StreamEvent` tokens consumed by CopilotKit runtime in `packages/web/src/routes/api/copilotkit.ts`.

## Integration

### Web UI consumers

| Tab module | Web route |
|-----------|-----------|
| `gameCenter/queries` | `packages/web/src/routes/game-center.tsx` (partial — route uses inline SQL for box scores, not these canonical functions) |
| `timeMachine/queries` | `packages/web/src/routes/time-machine.tsx` |
| `sqlSandbox/queries` | `packages/web/src/routes/sql-sandbox.tsx` (the route bypasses `runSandboxQuery` and calls `db.query()` directly) |
| `chatbot/agent` + `chatbot/db` + `chatbot/systemPrompt` | `packages/web/src/routes/api/copilotkit.ts` (server-side CopilotKit LangGraph endpoint) |
| `chatbot/openrouter` | `packages/web/src/routes/chat.tsx` (model selector UI) |

### Eval & script consumers

- `chatbot/eval` — consumed by `scripts/eval/chatbot-smoke.ts` (real API smoke tests) and the iteration harness.
- `chatbot/utils` — consumed internally by the agent and by eval scripts.
- `timeMachine/utils` — consumed only by `timeMachine/queries.ts` (local to the tab).

### Core dependencies (imported across tabs)

| Module | Purpose |
|--------|---------|
| `../../core/db.ts` | `query<T>()`, `getTables()`, `getColumns()`, `initDb()` — shared DuckDB connection |
| `../../core/dbHonors.ts` | `isHonorsDbConfigured()`, `queryHonors()` — secondary DuckDB for accurate award data |
| `../../core/types.ts` | `DbRow`, `SqlParam` base types |
| `../../shared/dbPath.ts` | `resolveDbPath()` — CI-aware DuckDB file resolution |
| `../../shared/theme.ts` | `ansiDim()` — ANSI terminal formatting |
| `../../shared/formatters.ts` | Stat string formatting |

### Known divergence

The `gameCenter/queries.ts` functions and the web Game Center route use **different fact tables** for box scores (`fact_player_game_boxscore` in star schema vs `main.fact_player_game_stats` in NBA-API schema). The canonical `queries.ts` functions exist as the single-source-of-truth contract but are not yet adopted by the web route.
