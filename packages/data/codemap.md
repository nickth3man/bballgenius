# packages/data/

## Responsibility

Framework-agnostic NBA data + chatbot agent layer. This is the **Bun workspace package** (`packages/data/package.json` name `"data"`) that owns all DuckDB connectivity, business queries per feature tab, and the LangGraph-based chatbot agent. It is the sole data intermediary between the DuckDB warehouse (`data/nba.duckdb` or CI fixture) and the TanStack Start web app in `packages/web`.

**Not a service** — imported directly as a workspace dependency (no HTTP, no RPC).

## Design

### Subpath exports architecture

`package.json` defines 14 granular subpath exports, each mapping to a single source file or barrel:

| Subpath | Source | Purpose |
|---|---|---|
| `"."` | `src/index.ts` | Barrel: `initDb`, `query`, `getTables`, `getColumns`, `closeDb`, `resolveDbPath`, `formatTable`, `Theme` |
| `"./db"` | `src/core/db.ts` | Primary DuckDB connection singleton |
| `"./dbPath"` | `src/shared/dbPath.ts` | CI-aware DB path resolver |
| `"./formatters"` | `src/shared/formatters.ts` | Table grid + ASCII shot chart |
| `"./theme"` | `src/shared/theme.ts` | TokyoNight ANSI palette |
| `"./errors"` | `src/shared/errors.ts` | Error message extraction |
| `"./tabs/game-center/queries"` | `src/tabs/gameCenter/queries.ts` | Game Center SQL |
| `"./tabs/time-machine/queries"` | `src/tabs/timeMachine/queries.ts` | Time Machine SQL |
| `"./tabs/sql-sandbox/*"` | `src/tabs/sqlSandbox/*.ts` | SQL Sandbox (query + autocomplete + schema browser) |
| `"./tabs/chatbot/*"` | `src/tabs/chatbot/*` | Agent, DB, OpenRouter, system prompt, utils, eval |

External consumers (`packages/web`) import via `import { ... } from 'data'` or `import { ... } from 'data/tabs/game-center/queries'`.

### Key internal patterns

- **Singleton DuckDB connections** — `src/core/db.ts` caches a read-only `DuckDBInstance` + `DuckDBConnection` with promise-dedup to prevent thundering-herd leaks. `src/tabs/chatbot/db.ts` is a separate second connection for the agent (lifetime managed independently).
- **`resolveDbPath()`** — env var `NBA_DUCKDB_PATH` → CI fixture (`data/fixtures/nba.ci.duckdb`) → default `data/nba.duckdb`. Single source of truth shared by core DB and chatbot DB.
- **LangGraph agent** — ReAct-style graph with intent classification, SQL error correction (3 retries), tool budget enforcement (max 10), and hallucination validation. Dual architecture: single-agent worker (`graph.ts`) + multi-agent orchestrator (`orchestrator.ts`), selected by `CHATBOT_ORCHESTRATION` env var.
- **No cross-tab imports** — Tab modules under `src/tabs/<tabId>/` import only from `src/core/`, `src/shared/`, and their own folder. Sibling tabs never import each other.
- **All `.js` extensions** in ESM import paths — Bun requires explicit extensions for local relative imports.
- **`tsconfig.json`** extends `../../tsconfig.base.json` (target `es2022`, module `esnext`, bundler resolution, strict mode, `bun` types). RootDir is `./src`.

### Build / test

- **Typecheck**: `tsc --noEmit -p tsconfig.json` (also `bun run typecheck` at repo root delegates here).
- **Test**: `bun test src --concurrency=1` — DuckDB enforces singleton connections, so parallelism is disabled. Tests cover DB querying, chatbot graph/intent/SQL/streaming, and shared formatters. CI uses `data/fixtures/nba.ci.duckdb`.

### Dependencies (runtime)

- **DuckDB**: `@duckdb/node-api` + `@duckdb/node-bindings` (read-only SQL execution)
- **LangChain/LangGraph**: `@langchain/core`, `@langchain/langgraph`, `@langchain/openai`, `langchain` (agent framework)
- **OpenAI SDK**: `openai` (direct API calls for OpenRouter)
- **Schema / validation**: `zod` v4 (tool schemas, state validation)
- **HTML parsing**: `cheerio`, `parse5` (BBR career totals extraction in eval)
- **UUID**: `uuid` (thread IDs, checkpoint keys)

## Flow

```
packages/web (TanStack Start routes)
    │
    │  import { ... } from 'data'
    │  import { ... } from 'data/tabs/game-center/queries'
    │  etc.
    ▼
packages/data/src/
    │
    ├── index.ts (barrel re-export)
    │
    ├── core/db.ts ────── initDb() ────── DuckDB (READ_ONLY)
    │   query()            getTables()
    │   getColumns()       closeDb()
    │
    ├── core/dbHonors.ts ── queryHonors() ── optional secondary DuckDB
    │
    ├── shared/dbPath.ts ── resolveDbPath() ── env → CI → default
    ├── shared/formatters.ts
    ├── shared/theme.ts
    ├── shared/errors.ts
    │
    └── tabs/
        │
        ├── gameCenter/queries.ts ── loadRecentGames, loadBoxScore, loadGameShots
        ├── timeMachine/queries.ts ── loadCareerStats, loadPlayerAwards, loadBBRData
        ├── sqlSandbox/queries.ts ── runSandboxQuery, loadSchemaCatalog
        ├── sqlSandbox/autocomplete.ts ── SqlAutocomplete (provisioned, not wired)
        ├── sqlSandbox/schemaBrowser.ts ── SchemaBrowser (provisioned, not wired)
        │
        └── chatbot/
            ├── db.ts ── separate DuckDB connection for agent
            ├── openrouter.ts ── model name resolution
            ├── systemPrompt.ts ── base system prompt
            ├── processQuestion.ts ── entry point
            │
            ├── agent/
            │   ├── graph.ts ── single-agent worker graph + graph factory
            │   ├── orchestrator.ts ── multi-agent planner/workers/synthesizer
            │   ├── streaming.ts ── streamQuery() async generator → StreamEvent[]
            │   ├── tools.ts ── 5 Zod-v4 tool definitions
            │   ├── state.ts ── ChatbotState schema
            │   ├── model.ts ── ChatOpenAI binding to OpenRouter
            │   ├── schemaFilter.ts / schemaConstants.ts ── intent-scoped schema injection
            │   ├── schemaCatalog.ts ── full catalog for orchestrator planner
            │   └── abort.ts ── shared AbortSignal holder
            │
            ├── utils/
            │   ├── sql.ts ── validateReadOnlySql, extractSql, executeSql, checkSql
            │   ├── retry.ts ── withRetry, error categorization, ERROR_PREFIX constants
            │   ├── metrics.ts ── MetricsSession singleton, NDJSON logging
            │   ├── correlation.ts ── AsyncLocalStorage request-scoped context
            │   ├── errorCapture.ts ── structured error capture to NDJSON
            │   ├── tableFormatter.ts ── ASCII box-drawing table
            │   ├── markdown.ts ── markdown → ANSI
            │   ├── streamFormatting.ts ── streaming UI helpers
            │   ├── spinner.ts ── braille spinner frames
            │   └── theme.ts ── chatbot-specific ANSI wrappers
            │
            └── eval/
                ├── nba-100-queries.ts ── 100 test questions (17 categories)
                ├── question-matrix.ts ── 30-question matrix (4 tiers)
                ├── matrixHarness.ts ── three-way comparison harness
                ├── bbrTruth.ts / bbrPlayerParser.ts ── BBR truth anchors
                └── dbTruth.ts ── canonical SQL truth resolvers
```

**Chatbot streaming flow (most complex):**

```
Web chat route (api/copilotkit.ts)
    │
    │  streamQuery(messages, threadId)
    ▼
agent/streaming.ts
    │
    │  getChatbotGraph().streamEvents()  ← worker or orchestrator
    │  maps LangGraph runtime events → StreamEvent union
    ▼
AsyncGenerator<StreamEvent>
    ├── chain_stage    (node boundary)
    ├── token          (LLM token)
    ├── tool_start     (tool name + input)
    ├── tool_end       (tool name + result + duration)
    ├── tool_error     (tool name + error + duration)
    ├── usage          (token counts)
    ├── done           (final messages)
    └── error          (fatal exception)
```

## Integration

### Consumed by

| Consumer | Import path | What it uses |
|---|---|---|
| `packages/web/src/routes/*.tsx` | `'data'` (barrel) | `query()`, `initDb()`, `resolveDbPath()` for server-side SQL |
| `packages/web/src/routes/game-center.tsx` | `'data'` | `query()` — *bypasses* canonical `queries.ts`, duplicates inline SQL against `main` schema |
| `packages/web/src/routes/time-machine.tsx` | `'data/tabs/time-machine/queries'` | `loadCareerStats()`, `loadPlayerAwards()`, `loadBBRData()` |
| `packages/web/src/routes/sql-sandbox.tsx` | `'data'` | `query()` — but uses hardcoded sample schema, not `SchemaBrowser` |
| `packages/web/src/routes/api/copilotkit.ts` | `'data/tabs/chatbot/agent'` | `streamQuery()`, `getChatbotGraph()`, `resetGraph()` |
| `scripts/eval/chatbot-smoke.ts` | `packages/data/src/tabs/chatbot/...` | Full agent + streaming + truth resolvers |

### Key boundaries

- **CI** — `resolveDbPath()` automatically selects `data/fixtures/nba.ci.duckdb` when `CI=true` or `GITHUB_ACTIONS=true`. The CI fixture is a pruned ~2.8 MB DB subset built by `scripts/ci/build-ci-fixture.ts`.
- **Eval scripts** — Import directly from `packages/data/src/tabs/chatbot/...` with relative paths (not the workspace alias), because they run from repo root and need internals not exposed via `package.json` exports.
- **No web dependencies** — `packages/data` never imports from `packages/web`. All dependencies are DB drivers, LLM SDKs, and utility libraries.
- **Chatbot persistence** — `MemorySaver` by default; `SqliteSaver` optional via `CHATBOT_PERSIST_DIR`. Orchestrator always uses `MemorySaver`.
- **Read-only by default** — Both `core/db.ts` and `chatbot/db.ts` open DuckDB with `access_mode: 'READ_ONLY'`. Defense-in-depth against SQL injection even if the sql-critic node is bypassed.

### Child codemaps

| Path | Covers |
|---|---|
| `src/codemap.md` | (placeholder — empty sections) |
| `src/core/codemap.md` | Singleton DuckDB connections, types, errors |
| `src/shared/codemap.md` | Cross-cutting: `resolveDbPath`, formatters, theme, errors |
| `src/tabs/codemap.md` | (placeholder — empty sections) |
| `src/tabs/gameCenter/codemap.md` | Game Center SQL queries, team dedup CTE, web route divergence |
| `src/tabs/timeMachine/codemap.md` | (placeholder — empty sections) |
| `src/tabs/timeMachine/utils/codemap.md` | Season-label normalization, career-stat dedup |
| `src/tabs/sqlSandbox/codemap.md` | SQL execution, autocomplete engine, schema browser tree |
| `src/tabs/chatbot/codemap.md` | (placeholder — empty sections) |
| `src/tabs/chatbot/agent/codemap.md` | LangGraph worker + orchestrator, graph state, tools, streaming |
| `src/tabs/chatbot/utils/codemap.md` | SQL safety, retry, metrics, correlation, error capture, formatting |
| `src/tabs/chatbot/eval/codemap.md` | Matrix eval harness, BBR truth, 100-query suite |
