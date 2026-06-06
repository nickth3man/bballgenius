# AGENTS.md

This file provides guidance to coding agents working with code in this repository. It is the canonical, tool-agnostic source; `CLAUDE.md` imports it.

## Project Overview

BBallGenius is a **Bun workspace monorepo** with two packages:

- **`packages/web`** — TanStack Start + React web app (Game Center, Career Time-Machine, SQL Sandbox, Chat)
- **`packages/data`** — DuckDB access, tab queries, LangGraph chatbot agent, shared formatters

The web app queries a local DuckDB file (`data/nba.duckdb`) through the `data` workspace package. The chatbot uses a LangGraph ReAct agent with SQL critic node (error-correction loop), multi-tool support (schema discovery + query execution), streaming token output, checkpointing for multi-turn conversation, and an eval suite with 100 categorized NBA test queries.

**Entry points:**

```bash
bun run web          # Dev server (packages/web)
bun run build:web    # Production build
```

## Repository Structure

```text
bballgenius/
├── .github/workflows/     # CI (ci.yml)
├── packages/
│   ├── web/               # TanStack Start + React UI
│   │   └── src/
│   │       ├── routes/    # game-center, time-machine, sql-sandbox, chat, api/copilotkit
│   │       └── components/
│   └── data/              # DuckDB + LangGraph agent + tab queries
│       └── src/
│           ├── core/      # db.ts, dbHonors.ts, errors, types
│           ├── shared/    # dbPath, formatters, theme, errors
│           └── tabs/      # gameCenter/, timeMachine/, sqlSandbox/, chatbot/
│               └── chatbot/
│                   ├── agent/     # LangGraph graph, tools, streaming
│                   ├── db.ts      # DuckDB access + schema introspection
│                   ├── openrouter.ts
│                   ├── systemPrompt.ts
│                   ├── utils/     # sql, retry, metrics, streamFormatting
│                   ├── eval/      # nba-100-queries.ts, question-matrix, iterate harness
│                   └── __tests__/ # Bun tests with LangChain mocking
├── data/
│   ├── fixtures/          # Committed nba.ci.duckdb (~2.8 MB) for CI
│   └── nba.duckdb         # Local full DB (gitignored, ~21.7 GB)
├── scripts/               # Topical subdirs: ci/, db/, eval/, bbr/
├── NBA_DB_SCHEMA_REFERENCE.md
├── .firecrawl/            # BBR markdown cache (gitignored)
└── bbr-screenshots/       # BBR PNG + JSON mirrors (gitignored)
```

- **`packages/data/src/shared/dbPath.ts`** — Single shared DB path resolver (used by web server routes and chatbot).
- **`packages/data/src/tabs/*/queries.ts`** — Production SQL per feature area; imported by web routes via `data` package exports.
- **`packages/data/src/tabs/chatbot/agent/`** — LangGraph agent: graph definition, state schema, tools, model binding, streaming.
- **`packages/data/src/tabs/chatbot/utils/`** — SQL validation/extraction/execution, retry with backoff, metrics logger.
- **`packages/data/src/tabs/chatbot/eval/`** — 100 categorized NBA test questions across 17 categories.
- **`scripts/`** — Automation:
  - **`scripts/ci/`** — `ci-guards.sh`, `build-ci-fixture.ts`.
  - **`scripts/db/`** — DuckDB warehouse tooling: `verify-dq.ts`, canonical views/merge, entity xref.
  - **`scripts/eval/`** — `chatbot-smoke.ts`, multi-model eval, iterate loop.
  - **`scripts/bbr/`** — BBR Firecrawl map/crawl/observe.

### Package boundaries

- **`packages/web`** imports from `data` workspace exports (`import { ... } from 'data/tabs/...'`). It must not reach into `packages/data/src/` with relative paths.
- **`packages/data`** tab modules under `tabs/<tabId>/` should not import sibling tabs — only `core/*`, `shared/*`, and their own folder.
- **Eval scripts** at repo root import chatbot internals via `packages/data/src/tabs/chatbot/...` (not via workspace alias).
- **Repo-root assets** (`.firecrawl/`, `bbr-screenshots/`, `data/`) are resolved from code via relative paths up to the repository root.

## Tech Stack

- **Language:** TypeScript 5.x / 6.x (Bun runtime)
- **Web UI:** TanStack Start, TanStack Router, React 19, Tailwind CSS v4, CopilotKit (chat)
- **Agent framework:** LangGraph (`@langchain/langgraph` v1.3+), LangChain (`@langchain/core`, `@langchain/openai`)
- **Database:** DuckDB (`@duckdb/node-api`, `@duckdb/node-bindings`)
- **Model provider:** OpenRouter API (multi-model, configurable via `MODEL` env var)
- **Lint / format:** Biome (`biome.json`) on `packages/` and `scripts/`
- **Typecheck:** `tsc --noEmit -p packages/data/tsconfig.json` (root `bun run typecheck`)

## Build & Development Commands

### Web & data entrypoints

```bash
bun run web              # TanStack Start dev server (packages/web)
bun run build:web        # Production build
bun run data:test        # All data package tests (alias: bun --filter data test)
bun run data:build       # Data package typecheck
```

### Chatbot-specific commands

```bash
bun --filter data test --concurrency=1                 # Full data package tests (DB + mocked LLM)
bun test packages/data/src/tabs/chatbot/__tests__ --concurrency=1
bun run chatbot:smoke                                  # Smoke test with fact-checked NBA questions
bun run chatbot:smoke:free                             # Free-tier model matrix (10 cases)
bun run chatbot:smoke:baseline                         # Paid baseline model matrix (10 cases)
bun run chatbot:smoke:100                              # Full 100-query smoke suite
```

### Fast-Feedback TDD Loop (Preferred for Daily Work)

```bash
bun run test:changed       # Only tests affected by uncommitted changes (Bun 1.3.13+)
bun run test:changed:watch
bun run test:quick         # --changed + --bail
bun run typecheck && bun run test:quick
```

### File-Scoped Commands (Preferred for Fast Feedback)

```bash
bunx tsc --noEmit packages/data/src/tabs/chatbot/agent/graph.ts
bunx biome check --write packages/data/src/tabs/chatbot/agent/graph.ts
bun test packages/data/src/tabs/chatbot/__tests__/processQuestion.test.ts --concurrency=1
```

### Project-Wide Commands (Use Sparingly)

```bash
bun install --frozen-lockfile
bun run ci                 # guards, lint, format:check, typecheck, unit, audit
bun run test:unit          # formatters only (no DB)
bun run fixture:build      # rebuild data/fixtures/nba.ci.duckdb from local DB
```

### BBR screenshot crawl (Firecrawl)

Mirrors [Basketball-Reference](https://www.basketball-reference.com) into repo-root `bbr-screenshots/` (PNG + JSON) and `.firecrawl/` (markdown). Used by Time Machine BBR views (`packages/data/src/tabs/timeMachine/utils/bbr/`). Requires `FIRECRAWL_API_KEY` and the [Firecrawl CLI](https://firecrawl.dev).

**Per-directory quota:** each mirrored folder gets up to **2 PNG** and **2 JSON** files.

**Map/crawl scope (default):** `players`, `teams`, `leagues`, `leaders`, `awards`, and player **gamelog** discovery only.

**Always run map before crawl:**

```bash
bun run bbr:map
bun run bbr:crawl
bun run bbr:verify
bun run bbr:verify:map
bun run bbr:status
bun run bbr:watch
bun run bbr:map:cancel
bun run bbr:observe
```

## CI/CD Infrastructure & API

### Overview

CI uses the **CI DuckDB fixture** (`data/fixtures/nba.ci.duckdb`) plus static guards.

Key terms:

- **CI Fixture:** Pruned committed DB (~2.8 MB) with representative games, players, shots, awards.
- **Pre-commit Guards:** `scripts/ci/ci-guards.sh` — no `.only`/`.skip` under `packages/`, no `UPDATE_SNAPSHOTS` in Actions, zero Biome warnings.
- **Lint policy:** Biome runs with `--error-on-warnings` on `packages/` and `scripts/`.
- **Pre-commit hooks:** Lefthook runs `bunx biome check --write` on staged TypeScript/JSON files.

### API Reference

#### `resolveDbPath(): string` (defined in `packages/data/src/shared/dbPath.ts`)

- **Parameters:** None.
- **Returns:** `string` (resolved database path).
- **Behavior:**
  1. `process.env.NBA_DUCKDB_PATH` if set (highest priority).
  2. If `CI=true` or `GITHUB_ACTIONS=true` and `data/fixtures/nba.ci.duckdb` exists → CI fixture.
  3. Else `data/nba.duckdb`.

```ts
import { resolveDbPath } from 'data/dbPath';

const activePath = resolveDbPath(); // e.g. 'data/fixtures/nba.ci.duckdb'
```

### Automation & Script Details

- **`scripts/ci/build-ci-fixture.ts`** (`bun run fixture:build`): Subset from local `data/nba.duckdb`; `CHECKPOINT` to avoid WAL commits.
- **`scripts/ci/ci-guards.sh`**: Focused-test guard under `packages/`, Biome zero-warning policy.
- **`scripts/eval/chatbot-smoke.ts`**: Real API smoke test; imports from `packages/data/src/tabs/chatbot/`.
- **`format:check`**: Biome write on `packages/` + `scripts/`, then `git diff --exit-code`.
- **`audit`**: Fails on moderate+ advisories.

## Data Warehouse, Schema & Data Quality

`data/nba.duckdb` is a medallion-architecture DuckDB warehouse: **509 tables/views across 12 schemas, ~414M rows, ~21.7 GB**. Ingesting/building it is out of repo scope; curated tiers, canonical views, entity reconciliation, and data-quality checks are operated from `scripts/db/`. The generated full column reference is `NBA_DB_SCHEMA_REFERENCE.md`.

### Warehouse boundary (nbadb vs BBallGenius)

The curated **`nbadb`** star tier matches the public contract at [nbadb.w4w.dev](https://nbadb.w4w.dev/docs/schema) (built by [wyattowalsh/nbadb](https://github.com/wyattowalsh/nbadb)). BBallGenius **operates** on an existing `nba.duckdb` and adds cross-source layers this repo maintains:

| Layer | Primary source | In nbadb.w4w.dev? | In BBallGenius |
|-------|----------------|-------------------|----------------|
| `nbadb` star tier | wyattowalsh/nbadb / NBA API | Yes | Yes — 1:1 public contract |
| `raw_bref` / `stg_bref` | Basketball-Reference | No | BBallGenius extension |
| `unified_star`, `api`, `xref` | Cross-source merge | No | `scripts/db/` |
| `audit` | DQ + reconciliation | No | `scripts/db/verify-dq.ts` |
| BBR mirror (Time Machine) | Firecrawl offline cache | No | `scripts/bbr/`, `bbr-screenshots/` |

### Schemas (medallion tiers)

- **`raw_*`** — source ingestion (BBR + NBA-API).
- **`stg_*`** — staging transforms.
- **`nbadb`** — curated **star tier** (251 tables).
- **`unified_star`**, **`api`** — cross-source unified star + convenience views.
- **`meta`** — `stat_crosswalk` + semantic catalog.
- **`audit`** — data-quality + cross-source reconciliation results.

### `scripts/db/verify-dq.ts` — internal-consistency DQ suite

```bash
bun run dq
bun run dq:gate
bun run scripts/db/verify-dq.ts --dry-run
bun run scripts/db/verify-dq.ts --filter=orphan
bun run dq:fixture
```

**Cross-table & recompute suites:**

```bash
bun run dq:crosstable
bun run dq:recompute
bun run dq:historical
```

Cross-source **accuracy** reconciliation: `bun run dq:accuracy`, `bun run dq:oracle`, `bun run dq:full`.

### Firecrawl-Backed Fact-Check Verification

```bash
bun run accuracy:refresh
bun run accuracy:verify
bun run accuracy:full
```

### DuckDB scripting conventions (`scripts/db/*`)

- `const db = await DuckDBInstance.fromCache(DB_PATH); const conn = await db.connect();`
- **Always `await conn.run('CHECKPOINT')` after writes.**
- DB path from `process.env['NBA_DUCKDB_PATH'] ?? './data/nba.duckdb'`.
- **Verify real column names/types from `information_schema` before writing SQL.**

## Code Style & Conventions

### Formatting

- **Indentation:** 2 spaces (`biome.json`)
- **Formatter:** Biome, single quotes, semicolons
- **Line length:** 100 characters
- **Imports:** Biome `organizeImports` enabled.

### Naming Conventions

- **Variables & functions:** `camelCase`
- **Types & classes:** `PascalCase`
- **Constants:** `SCREAMING_SNAKE_CASE`
- **DB tables/columns:** `snake_case`

### Import Organization

- **Local imports:** Relative paths with `.js` extension in TypeScript.
- **Order:** Node built-ins → third-party → relative local / workspace.
- **Scope:** Web code under `packages/web/`; data/agent code under `packages/data/`.

## Architecture Notes

### High-Level Overview

```text
packages/web/src/routes/*  -->  data package exports  -->  DuckDB
packages/web/src/routes/api/copilotkit  -->  LangGraph agent  -->  DuckDB + OpenRouter
```

### Chatbot Agent Graph

```
START → classify_intent → llm → [toolsCondition] → tools → sql_critic → llm → END
                              ↓                          ↓
                             END              [error + retries<3]
                                       ↓
                                    llm (retry)
                                       ↓
                              [error + retries≥3]
                                       ↓
                                      END
```

- **`classify_intent` node**: Deterministic keyword-based classification (no LLM call).
- **`llm` node**: Calls the model with bound tools (`query_nba_db`, `get_schema_info`, `list_nba_tables`, `check_nba_sql`).
- **`tools` node** (`ToolNode`): Executes tool calls; supports parallel execution.
- **`sql_critic` node**: Examines tool output for SQL errors; routes back to LLM up to `MAX_SQL_RETRIES=3`.
- **State** (`ChatbotState`): `messages`, `sqlRetryCount`, `intentCategory`. Do not add state fields unless a graph node reads/writes them.

### Key Components

- **Web routes:** `packages/web/src/routes/` — Game Center, Time Machine, SQL Sandbox, Chat.
- **CopilotKit API:** `packages/web/src/routes/api/copilotkit.ts` — server-side chat endpoint.
- **Graph:** `packages/data/src/tabs/chatbot/agent/graph.ts` — `getChatbotGraph()`, `resetGraph()`.
- **Streaming:** `packages/data/src/tabs/chatbot/agent/streaming.ts` — `streamQuery()` yields `StreamEvent`.
- **Tools:** `packages/data/src/tabs/chatbot/agent/tools.ts` — `query_nba_db`, `get_schema_info`.
- **SQL utilities:** `packages/data/src/tabs/chatbot/utils/sql.ts` — validation, extraction, execution.

### Adding Web Features

1. Add or extend queries in `packages/data/src/tabs/<area>/queries.ts`.
2. Export from `packages/data/package.json` if needed.
3. Wire a TanStack Start route under `packages/web/src/routes/`.

### Adding Chatbot Features

1. **New tool**: Add to `packages/data/src/tabs/chatbot/agent/tools.ts` → bind in `graph.ts`.
2. **Graph node**: Add to `buildGraph()` → wire edges.
3. **State field**: Add to `ChatbotState` in `state.ts` only if a graph node reads/writes it.
4. **Stream event**: Add to `StreamEvent` union in `streaming.ts` → handle in web chat route.
5. **Tests**: Add to `packages/data/src/tabs/chatbot/__tests__/`; use `mock.module()` for `@langchain/openai` and `../db.js`.

## Dos and Don'ts

### Do

- Use `resolveDbPath()` for CI-safe DB paths.
- Use `bun run test:changed` for fast TDD feedback.
- Pass `--concurrency=1` to `bun test` for full data package runs (DuckDB singleton).
- Use `mock.module()` in chatbot tests to mock `@langchain/openai` and `../db.js`.
- Use `zod/v4` for tool schemas and state validation.
- Gate internal data quality with `bun run scripts/db/verify-dq.ts`.
- Call `CHECKPOINT` after writes in `scripts/db/*`.

### Don't

- Commit `data/nba.duckdb` (~21.7 GB).
- Use `.only(` / `.skip(` in test files (CI blocked).
- Commit `any` or untyped `let` (Biome errors).
- Merge with Biome warnings or unformatted `packages/` / `scripts/`.
- Commit `bbr-screenshots/` or generated `.firecrawl/bbr-map-full.txt`.
- Import sibling tab modules from `packages/data/src/tabs/` across tab boundaries.
- Wrap `interrupt()` calls in try/catch blocks (interrupts throw to signal the runtime).

## Testing Strategy

| Layer | Location | Notes |
|-------|----------|-------|
| Shared unit | `packages/data/src/shared/__tests__/formatters.test.ts` | No database |
| Chatbot graph | `packages/data/src/tabs/chatbot/__tests__/processQuestion.test.ts` | Mocked LLM + DB |
| Chatbot intent | `packages/data/src/tabs/chatbot/__tests__/intentClassification.test.ts` | Keyword classification |
| Chatbot SQL | `packages/data/src/tabs/chatbot/__tests__/executeSql.test.ts` | Real DuckDB |
| Chatbot streaming | `packages/data/src/tabs/chatbot/__tests__/streaming.test.ts` | `streamQuery()` events |
| Full data suite | `bun --filter data test` | CI fixture in Actions |
| Smoke | `scripts/eval/chatbot-smoke.ts` | Real API, fact-checked |

### Fast-Feedback Workflows

| Goal | Command | Notes |
|------|---------|-------|
| Changed-only tests | `bun run test:changed` | Uncommitted diff only |
| Watch mode | `bun run test:changed:watch` | Re-runs on save |
| Quick pre-commit | `bun run test:quick` | Stops at first failure |
| Pre-push sanity | `bun run typecheck && bun run test:quick` | ~30-60s typical |
| Full data suite | `NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb bun --filter data test` | CI fixture |
| Chatbot smoke | `OPENROUTER_API_KEY=... bun run chatbot:smoke` | Real API |

### Caveats

- `--changed` requires Bun 1.3.13+.
- `--concurrency=1` is needed for full data package runs due to DuckDB singleton.
- DuckDB connections are **read-only** at runtime (`packages/data/src/core/db.ts`, `packages/data/src/tabs/chatbot/db.ts`).

## Chatbot Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key (required for live chat) | — |
| `MODEL` | Model name | `openai/gpt-oss-120b` |
| `NBA_DUCKDB_PATH` | DuckDB path | `data/nba.duckdb` |
| `NBA_HONORS_DUCKDB_PATH` | Optional honors DB | — |
| `CHATBOT_DEBUG` | Enable debug logging to stderr | `false` |
| `CHATBOT_PERSIST_DIR` | Persistent checkpoints (`SqliteSaver`) | — (uses `MemorySaver`) |
| `CHATBOT_METRICS_DIR` | Metrics output directory | `data/` |
| `LANGSMITH_TRACING` | Enable LangSmith tracing | — |
| `LANGSMITH_API_KEY` | LangSmith API key | — |

## Security & Compliance

- **Secrets:** DB work is local DuckDB; BBR crawl needs `FIRECRAWL_API_KEY`; chatbot needs `OPENROUTER_API_KEY`.
- **License:** MIT — see `docs/LICENSE`.

## Agent Guardrails

### Allowed Without Asking

- Read/search any file; file-scoped lint, format, `tsc`.
- Run data package tests with `concurrency=1`.

### Ask Before Doing

- Delete files or folders.
- Change `package.json` dependencies.
- Edit `.github/workflows/ci.yml`.
- Git commit or push.
- Modify `packages/data/src/shared/` (shared by web and agent).

## Unknowns & TODOs

- [ ] **Chatbot persistence:** `SqliteSaver` available via `CHATBOT_PERSIST_DIR`; not yet surfaced in web UI.
- [ ] **CopilotKit integration:** Wire full LangGraph streaming through CopilotKit runtime (partial stub in `api/copilotkit.ts`).
- [ ] **nbadb pipeline:** Ingesting/building `data/nba.duckdb` is out of repo scope.
- [ ] **DQ rollout:** Cross-source accuracy reconciliation built but not yet run at scale.
- [ ] **Chatbot HITL:** Interrupt-based SQL approval pattern available as future feature.

## Repository Map

A full codemap is available at `codemap.md` in the project root.

Before working on any task, read `codemap.md` to understand:
- Project architecture and entry points
- Directory responsibilities and design patterns
- Data flow and integration points between modules

For deep work on a specific folder, also read that folder's `codemap.md`.
