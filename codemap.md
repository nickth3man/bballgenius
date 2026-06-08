# bballgenius/

## Responsibility

**BBallGenius** is a desktop NBA analytics suite built as a Bun workspace monorepo. It provides four core features through a local TanStack Start web UI:

1. **Game Center** — Browse recent games, box scores, and shot charts
2. **Career Time-Machine** — Search any player's career stats, awards, and season-by-season progression
3. **SQL Sandbox** — Run ad-hoc SQL against a 509-table, ~414M-row DuckDB warehouse with schema browsing and autocomplete
4. **Chat** — Ask natural-language NBA questions answered by a LangGraph ReAct agent with SQL-critic error correction, multi-tool schema discovery, and streaming token output

The system operates entirely on a local DuckDB file (`data/nba.duckdb`, ~21.7 GB) with no external database dependencies. The chatbot calls OpenRouter for LLM inference. Basketball-Reference data is mirrored offline via Firecrawl for the Time Machine feature.

## System Entry Points

### Development commands

| Command | Purpose |
|---------|---------|
| `bun run web` | TanStack Start dev server (`packages/web`) |
| `bun run build:web` | Production build |
| `bun run data:build` | Data package typecheck |
| `bun run data:test` | All data package tests (DB + mocked LLM) |
| `bun run typecheck` | TypeScript check for data package |
| `bun run chatbot:smoke` | Real API smoke test with fact-checked NBA questions |
| `bun run chatbot:smoke:100` | Full 100-query smoke suite |
| `bun run ci` | Complete CI pipeline: guards → lint → format → typecheck → build → test → audit |

### Fast-feedback TDD loop

| Command | Purpose |
|---------|---------|
| `bun run test:changed` | Only tests affected by uncommitted changes |
| `bun run test:quick` | `--changed` + `--bail` (stops at first failure) |
| `bun run lint:fix` | Biome write on `packages/` + `scripts/` |

### Source entry points

| Path | Role |
|------|------|
| `packages/web/src/router.tsx` | TanStack Router creation — the browser UI entry point |
| `packages/data/src/index.ts` | Data package barrel — re-exports core DB + shared utilities |
| `packages/data/package.json` `"exports"` | 15 subpath export aliases consumed by web and scripts |
| `packages/data/src/tabs/chatbot/agent/graph.ts` | LangGraph chatbot graph — the agent entry point |

## High-Level Architecture

```
User Browser
     │
     ▼
┌──────────────────────────────────────────────────────────┐
│  packages/web/ (TanStack Start + React 19)               │
│                                                           │
│  Routes (file-based):                                     │
│    /game-center  ─┐                                       │
│    /time-machine ─┤─ server functions ──┐                 │
│    /sql-sandbox  ─┘   (createServerFn)  │                 │
│                                         ▼                 │
│    /chat ── POST /api/copilotkit ──────────────────┐      │
│                                       │             │      │
└───────────────────────────────────────│─────────────│──────┘
                                        │             │
                          import via     ▼             ▼
                          workspace:*    │             │
┌───────────────────────────────────────│─────────────│──────┐
│  packages/data/ (framework-agnostic)  │             │      │
│                                       │             │      │
│  ┌─────────────────┐                  │             │      │
│  │ core/db.ts      │◄─────────────────┘             │      │
│  │ (DuckDB single) │  Tab query functions            │      │
│  │  READ_ONLY      │  (gameCenter, timeMachine,      │      │
│  │  search_path:   │   sqlSandbox)                   │      │
│  │  unified_star   │                                  │      │
│  └────────┬────────┘                                  │      │
│           │                                           │      │
│           ▼                                           │      │
│  ┌─────────────────┐   ┌──────────────────────────┐  │      │
│  │  DuckDB          │   │  chatbot/agent/          │◄─┘      │
│  │  data/nba.duckdb │   │  LangGraph StateGraph    │         │
│  │  (~21.7 GB)      │   │  ┌─ classify_intent      │         │
│  │  509 tables      │   │  ├─ inject_schema        │         │
│  │  12 schemas      │   │  ├─ llm (ChatOpenRouter) │         │
│  │  ~414M rows      │   │  ├─ tools (ToolNode)     │─────────┘
│  └──────────────────┘   │  ├─ sql_error_guard      │  streamQuery()
│                          │  ├─ validate_answer      │  yields StreamEvent
│                          │  └─ finalize_turn        │
│                          └──────────┬───────────────┘
│                                     │
│                          ┌──────────▼───────────────┐
│                          │  OpenRouter API           │
│                          │  (LLM inference,          │
│                          │   configurable MODEL)     │
│                          └──────────────────────────┘
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  scripts/ (automation, not imported by packages)          │
│                                                           │
│  ci/   → CI guards, DuckDB fixture builder                │
│  db/   → Warehouse curation: DQ, canonical views, xref   │
│  eval/ → Chatbot smoke tests, multi-model matrix          │
│  bbr/  → Firecrawl mirror of Basketball-Reference         │
└──────────────────────────────────────────────────────────┘
```

### Two data-flow paths

**Path 1 — Tab queries (Game Center, Time Machine, SQL Sandbox):**

```
Web route page component
  → createServerFn handler
    → dynamic import('data') or import('data/tabs/<tab>/queries')
      → query<T>(sql, params?) from core/db.ts
        → DuckDB (read-only singleton, search_path = unified_star,main)
          → typed JSON row objects
```

**Path 2 — Chat agent:**

```
Chat page POST /api/copilotkit { messages }
  → api/copilotkit.ts server handler
    → streamQuery(baseMessages, threadId)
      → LangGraph graph (orchestrator or single-agent)
        → classify_intent (regex, no LLM)
        → inject_schema (fetch relevant table schemas)
        → llm (ChatOpenRouter via OpenRouter API)
          → tool calls (query_nba_db, get_schema_info, list_nba_tables, check_nba_sql, find_stat_columns)
            → DuckDB (chatbot's own singleton in chatbot/db.ts)
            → sql_error_guard (retry ≤3 on error)
          → validate_answer (hallucination check)
        → yields StreamEvent (token, tool_start, tool_end, done, error)
      → final assistant message → JSON response
```

## Directory Map

| Directory | Responsibility | Codemap |
|-----------|---------------|---------|
| `packages/` | Workspace monorepo root — two private packages (`data`, `web`) with workspace protocol imports | [`packages/codemap.md`](packages/codemap.md) |
| `packages/data/` | Data workspace package root — DuckDB access, LangGraph agent, tab queries, shared formatters | [`packages/data/src/codemap.md`](packages/data/src/codemap.md) |
| `packages/data/src/` | Data package source root — barrel re-exports, core/, shared/, tabs/ | [`packages/data/src/codemap.md`](packages/data/src/codemap.md) |
| `packages/data/src/core/` | DuckDB singleton connections, type aliases, error utilities | [`packages/data/src/core/codemap.md`](packages/data/src/core/codemap.md) |
| `packages/data/src/shared/` | dbPath resolver, formatters, theme tokens, SQL validation, error helpers — no DuckDB imports | [`packages/data/src/shared/codemap.md`](packages/data/src/shared/codemap.md) |
| `packages/data/src/tabs/` | Tab orchestration layer — four self-contained feature modules with query functions | [`packages/data/src/tabs/codemap.md`](packages/data/src/tabs/codemap.md) |
| `packages/data/src/tabs/gameCenter/` | Game Center queries — recent games, box scores, shot-chart data | [`packages/data/src/tabs/gameCenter/codemap.md`](packages/data/src/tabs/gameCenter/codemap.md) |
| `packages/data/src/tabs/timeMachine/` | Time Machine queries — player search, career stats, awards, team lookup | [`packages/data/src/tabs/timeMachine/codemap.md`](packages/data/src/tabs/timeMachine/codemap.md) |
| `packages/data/src/tabs/timeMachine/utils/` | Time Machine utilities — career stats deduplication, season year helpers | [`packages/data/src/tabs/timeMachine/utils/codemap.md`](packages/data/src/tabs/timeMachine/utils/codemap.md) |
| `packages/data/src/tabs/sqlSandbox/` | SQL Sandbox — ad-hoc SQL execution, schema tree model, autocomplete state machine | [`packages/data/src/tabs/sqlSandbox/codemap.md`](packages/data/src/tabs/sqlSandbox/codemap.md) |
| `packages/data/src/tabs/chatbot/` | Chatbot tab root — DuckDB singleton, system prompt builder, OpenRouter model config | [`packages/data/src/tabs/chatbot/codemap.md`](packages/data/src/tabs/chatbot/codemap.md) |
| `packages/data/src/tabs/chatbot/agent/` | LangGraph agent — state graph, tools, streaming, multi-agent orchestrator, intent classification | [`packages/data/src/tabs/chatbot/agent/codemap.md`](packages/data/src/tabs/chatbot/agent/codemap.md) |
| `packages/data/src/tabs/chatbot/utils/` | SQL validation/extraction/execution, retry with backoff, metrics, correlation, formatting | [`packages/data/src/tabs/chatbot/utils/codemap.md`](packages/data/src/tabs/chatbot/utils/codemap.md) |
| `packages/data/src/tabs/chatbot/eval/` | Eval suite — 100 categorized NBA test queries, ground-truth data, matrix/iterate harnesses | [`packages/data/src/tabs/chatbot/eval/codemap.md`](packages/data/src/tabs/chatbot/eval/codemap.md) |
| `packages/web/` | Web workspace package root — TanStack Start config, Vite, Tailwind | — |
| `packages/web/src/` | TanStack Start app entry — router, root shell, route tree | [`packages/web/src/codemap.md`](packages/web/src/codemap.md) |
| `packages/web/src/components/` | Component library — CodeEditor, SchemaTree, ResultsTable, shot charts, Time Machine dossier | [`packages/web/src/components/codemap.md`](packages/web/src/components/codemap.md) |
| `packages/web/src/components/ui/` | Reusable UI primitives — Button, Badge, Card, Tabs, StatTile, TeamCrest, Skeleton | [`packages/web/src/components/ui/codemap.md`](packages/web/src/components/ui/codemap.md) |
| `packages/web/src/components/shotChart/` | Shot chart visualization — half-court SVG geometry, dual shot chart | [`packages/web/src/components/shotChart/codemap.md`](packages/web/src/components/shotChart/codemap.md) |
| `packages/web/src/components/timeMachine/` | Time Machine components — search panel, dossier skeleton, dossier detail | [`packages/web/src/components/timeMachine/codemap.md`](packages/web/src/components/timeMachine/codemap.md) |
| `packages/web/src/components/timeMachine/dossier/` | Player dossier detail — career sections, data tables, hooks, internal utilities | [`packages/web/src/components/timeMachine/dossier/codemap.md`](packages/web/src/components/timeMachine/dossier/codemap.md) |
| `packages/web/src/components/timeMachine/dossier/tables/` | Dossier data tables — per-game, totals, advanced, shooting, per-36, play-by-play, season tabs | [`packages/web/src/components/timeMachine/dossier/tables/codemap.md`](packages/web/src/components/timeMachine/dossier/tables/codemap.md) |
| `packages/web/src/components/timeMachine/dossier/sections/` | Dossier sections — header, career trajectory, awards, shot zones, game log, draft combine | [`packages/web/src/components/timeMachine/dossier/sections/codemap.md`](packages/web/src/components/timeMachine/dossier/sections/codemap.md) |
| `packages/web/src/components/timeMachine/dossier/internal/` | Dossier internal utilities — data-table, section-card, highlight, types | [`packages/web/src/components/timeMachine/dossier/internal/codemap.md`](packages/web/src/components/timeMachine/dossier/internal/codemap.md) |
| `packages/web/src/components/timeMachine/dossier/hooks/` | Dossier data hooks — career summary, season tabs, sortable table | [`packages/web/src/components/timeMachine/dossier/hooks/codemap.md`](packages/web/src/components/timeMachine/dossier/hooks/codemap.md) |
| `packages/web/src/routes/` | Route definitions — six file-based TanStack Router routes (pages + API) | [`packages/web/src/routes/codemap.md`](packages/web/src/routes/codemap.md) |
| `packages/web/src/routes/api/` | API endpoints — CopilotKit chat stream handler | [`packages/web/src/routes/api/codemap.md`](packages/web/src/routes/api/codemap.md) |
| `packages/web/src/routes/time-machine/` | Time Machine route pages — server functions for player data | [`packages/web/src/routes/time-machine/codemap.md`](packages/web/src/routes/time-machine/codemap.md) |
| `packages/web/src/lib/` | Library wrappers — team color mapping | [`packages/web/src/lib/codemap.md`](packages/web/src/lib/codemap.md) |
| `packages/web/src/utils/` | Pure utility functions — formatters, theme re-exports | [`packages/web/src/utils/codemap.md`](packages/web/src/utils/codemap.md) |
| `packages/web/src/styles/` | Global styles — Tailwind v4 + BBallGenius theme variables | [`packages/web/src/styles/codemap.md`](packages/web/src/styles/codemap.md) |
| `scripts/` | Automation root — CI, DuckDB warehouse ops, chatbot eval, BBR mirroring | [`scripts/codemap.md`](scripts/codemap.md) |
| `scripts/ci/` | CI guards (no `.only`/`.skip`, Biome zero-warning), DuckDB fixture builder | [`scripts/ci/codemap.md`](scripts/ci/codemap.md) |
| `scripts/db/` | DuckDB warehouse tooling — DQ verification, canonical views, entity xref, accuracy reconciliation | [`scripts/db/codemap.md`](scripts/db/codemap.md) |
| `scripts/db/sources/` | Source-specific DB scripts — BBR, ESPN, NBA API manifests | [`scripts/db/sources/codemap.md`](scripts/db/sources/codemap.md) |
| `scripts/eval/` | Chatbot eval — smoke tests, multi-model matrix, iteration loop | [`scripts/eval/codemap.md`](scripts/eval/codemap.md) |
| `scripts/eval/shared/` | Shared eval utilities — model definitions, types, helpers | [`scripts/eval/shared/codemap.md`](scripts/eval/shared/codemap.md) |
| `scripts/bbr/` | BBR Firecrawl mirroring — map, crawl, screenshot, verify Basketball-Reference | [`scripts/bbr/codemap.md`](scripts/bbr/codemap.md) |

## Cross-Cutting Concerns

### Package boundaries

- **`packages/web`** imports from `data` workspace exports (`import { ... } from 'data'` or `import { ... } from 'data/tabs/...'`). It must never reach into `packages/data/src/` with relative paths.
- **`packages/data`** tab modules under `tabs/<tabId>/` must not import sibling tabs — only `core/`, `shared/`, and their own folder.
- **Eval scripts** at repo root import chatbot internals via deep relative paths (`packages/data/src/tabs/chatbot/...`), bypassing the workspace alias — a deliberate boundary exception for tooling.
- **DuckDB connections are read-only at runtime** — both `core/db.ts` and `chatbot/db.ts` open with `access_mode: 'READ_ONLY'`. Only `scripts/db/` writes to the warehouse.

### Database path resolution

All DuckDB access resolves through `packages/data/src/shared/dbPath.ts` → `resolveDbPath()`:

1. `NBA_DUCKDB_PATH` env var (highest priority)
2. `data/fixtures/nba.ci.duckdb` when `CI=true` or `GITHUB_ACTIONS=true`
3. `data/nba.duckdb` (default)

### Testing strategy

| Layer | Location | Notes |
|-------|----------|-------|
| Shared unit | `packages/data/src/shared/__tests__/` | No database required |
| Chatbot graph | `packages/data/src/tabs/chatbot/__tests__/` | Mocked LLM + DB |
| Chatbot intent | `packages/data/src/tabs/chatbot/__tests__/` | Keyword classification |
| Chatbot SQL | `packages/data/src/tabs/chatbot/__tests__/` | Real DuckDB |
| Chatbot streaming | `packages/data/src/tabs/chatbot/__tests__/` | `streamQuery()` events |
| Full data suite | `bun --filter data test` | CI fixture in Actions |
| Smoke tests | `scripts/eval/chatbot-smoke.ts` | Real API, fact-checked |

All data package tests require `--concurrency=1` due to the DuckDB singleton. Use `bun run test:changed` for fast TDD feedback during development.

### CI pipeline

`bun run ci` runs: guards → lint → format:check → typecheck (data + scripts + web) → build → unit tests → data tests → web tests → script tests → DQ fixture check → docs lint → audit. The committed CI fixture (`data/fixtures/nba.ci.duckdb`, ~2.8 MB) provides a pruned representative dataset for deterministic CI.

### Data quality

The warehouse uses a medallion architecture across 12 schemas (`raw_*`, `stg_*`, `nbadb`, `unified_star`, `api`, `meta`, `audit`). Data quality is verified via `scripts/db/verify-dq.ts` with suites for cross-table consistency, advanced recomputation, historical checks, and cross-source accuracy reconciliation. Canonical views and entity cross-references are built and maintained by `scripts/db/`.

### BBR mirroring

Basketball-Reference data is mirrored offline via Firecrawl into `bbr-screenshots/` (PNG + JSON) and `.firecrawl/` (markdown). The map/crawl lifecycle is managed by `scripts/bbr/` with per-directory quotas (max 2 PNG, 2 JSON per folder). This data feeds the Time Machine feature's BBR views.

### Lint and format

Biome runs with `--error-on-warnings` on `packages/` and `scripts/`. Single quotes, semicolons, 100-char line width, 2-space indent. `organizeImports` is enabled. Pre-commit hooks (Lefthook) run `bunx biome check --write` on staged files.

### Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key (required for live chat) | — |
| `MODEL` | LLM model name | `openai/gpt-oss-120b` |
| `NBA_DUCKDB_PATH` | Override DuckDB file path | `data/nba.duckdb` |
| `NBA_HONORS_DUCKDB_PATH` | Optional secondary honors DB | — |
| `CHATBOT_DEBUG` | Debug logging to stderr | `false` |
| `CHATBOT_PERSIST_DIR` | Persistent checkpoints (SqliteSaver) | — (MemorySaver) |
| `CHATBOT_METRICS_DIR` | Metrics output directory | `data/` |
| `CHATBOT_ORCHESTRATION` | Disable multi-agent orchestrator | `1` (enabled) |
| `FIRECRAWL_API_KEY` | Required for BBR crawl | — |
| `LANGSMITH_TRACING` | Enable LangSmith tracing | — |
| `LANGSMITH_API_KEY` | LangSmith API key | — |
