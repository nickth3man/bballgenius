# bballgenius/ — Repository Atlas

## Project Responsibility

BBallGenius is a **Bun workspace monorepo** (`bun@1.3.6`, ESM, workspaces at `packages/*`) providing an NBA analytics suite. It combines a **local DuckDB warehouse** (~21.7 GB, 509+ tables across 12 medallion-tier schemas) with a **LangGraph chatbot agent** and a **TanStack Start/React web UI**. The system operates entirely offline against a local `.duckdb` file; no cloud database is involved.

Two workspace packages deliver the architecture:

| Package | Role | Key Stack |
|---------|------|-----------|
| `packages/data` | Data & agent layer | DuckDB, LangGraph, LangChain, Zod v4, OpenRouter |
| `packages/web` | Frontend UI | TanStack Start, React 19, Tailwind CSS v4, CopilotKit (chat) |

All DuckDB access flows through `data`; `web` consumes it exclusively via workspace subpath exports. The chatbot agent (LangGraph ReAct) executes SQL tools, runs a sql-critic error-correction loop, and streams tokens to the chat UI via a custom server-side POST handler.

Supporting automation lives under `scripts/`: CI guards/fixture building, DuckDB data-quality verification/curation, BBR (Basketball-Reference) Firecrawl mirror pipeline, and chatbot evaluation harnesses.

---

## System Entry Points — Root Configuration

| File | Purpose |
|------|---------|
| `package.json` | Root workspace config: `"workspaces": ["packages/*"]`, shared deps (LangChain, DuckDB, Zod, OpenAI), dev scripts (web, build:web, typecheck, lint, smoke test, DQ, BBR crawl, CI orchestration), Biome/lefthook overrides. |
| `tsconfig.base.json` | Base TS config: target `es2022`, module `esnext`, `bundler` resolution, strict mode, `bun` types. Extended by both packages and scripts. |
| `tsconfig.scripts.json` | Extends `tsconfig.base.json`; scoped to `scripts/**/*.ts` with `rootDir: "."`. |
| `biome.json` | Unified lint+format: 2-space indent, 100-char width, single quotes, semicolons. Rules: `noExplicitAny` error, `noUnusedImports` error, `organizeImports` on save. Scoped to `packages/*/src` and `scripts/`. |
| `bunfig.toml` | Test defaults: `concurrentTestGlob` for `__tests__/*.test.ts`, 10s timeout. |
| `lefthook.yml` | Pre-commit: Biome write + `.only`/`.skip` guard. Pre-push: typecheck + unit tests. |
| `.env.example` | Template for `OPENROUTER_API_KEY`, `NBA_DUCKDB_PATH`, `MODEL`, `CHATBOT_*`, `LANGSMITH_*`, `FIRECRAWL_API_KEY`. |
| `AGENTS.md` | Canonical project guide (rules, architecture, commands, conventions). Imported by `CLAUDE.md`. |
| `CLAUDE.md` | Claude-code entry — delegates to `AGENTS.md`. |
| `NBA_DB_SCHEMA_REFERENCE.md` | Auto-generated full column reference for the DuckDB warehouse (509+ tables). |

---

## Directory Map

Every sub-directory with a `codemap.md` is listed below. Each entry links to its detailed sub-map and gives a one-line responsibility summary.

### `packages/` — Workspace monorepo

| Directory | Codemap | Responsibility |
|-----------|---------|---------------|
| `packages/` | [`packages/codemap.md`](./packages/codemap.md) | Bun workspace root: two-package split (`data` + `web`), workspace protocol, export gating, typecheck isolation, Biome scope. |
| `packages/data/` | [`packages/data/codemap.md`](./packages/data/codemap.md) | Framework-agnostic data & agent layer: DuckDB singleton, 15 subpath exports, LangGraph worker + orchestrator graphs, dynamic system prompt, OpenRouter model selection, 100-query eval suite. |
| `packages/data/src/` | [`packages/data/src/codemap.md`](./packages/data/src/codemap.md) | Barrel entry (`index.ts`), subpath re-exports, tab isolation boundary rules (`core/`, `shared/`, `tabs/`). |
| `packages/data/src/core/` | [`packages/data/src/core/codemap.md`](./packages/data/src/core/codemap.md) | DuckDB connection lifecycle: singleton `initDb()` with promise-dedup, read-only mode, `search_path='unified_star,main'`, schema introspection, optional honors-DB secondary connection, type aliases (`DbRow`, `SqlParam`). |
| `packages/data/src/shared/` | [`packages/data/src/shared/codemap.md`](./packages/data/src/shared/codemap.md) | Cross-cutting stateless utilities: `resolveDbPath()` (CI-aware env→fixture→default), `formatTable()`/`drawHalfCourt()` (Unicode table + ASCII shot chart), TokyoNight `Theme` with `NO_COLOR` support, `getErrorMessage()`. |
| `packages/data/src/tabs/` | [`packages/data/src/tabs/codemap.md`](./packages/data/src/tabs/codemap.md) | Feature-area orchestration: four tabs (gameCenter, timeMachine, sqlSandbox, chatbot). Boundary rule: no sibling-tab imports. Subpath export map aliases (kebab-case). |
| `packages/data/src/tabs/gameCenter/` | [`packages/data/src/tabs/gameCenter/codemap.md`](./packages/data/src/tabs/gameCenter/codemap.md) | Game Center SQL queries: `loadRecentGames`, `loadBoxScoreWithTeamDedup` (DISTINCT ON CTE for franchise renames), `loadGameShots` (shot-chart x/y from `fact_pbp_events`). |
| `packages/data/src/tabs/timeMachine/` | [`packages/data/src/tabs/timeMachine/codemap.md`](./packages/data/src/tabs/timeMachine/codemap.md) | Career Time-Machine queries: player search, career stats (with dedup via `dedupeCareerStats`), dual-source awards (honors DB fallback), team lookup, season stats, roster. |
| `packages/data/src/tabs/timeMachine/utils/` | [`packages/data/src/tabs/timeMachine/utils/codemap.md`](./packages/data/src/tabs/timeMachine/utils/codemap.md) | Season-label normalization (`seasonEndYearToNbaLabel`) and nbadb career-stat deduplication (`canonicalSeasonKey`, `dedupeCareerStats`). Pure transformations, no DuckDB. |
| `packages/data/src/tabs/sqlSandbox/` | [`packages/data/src/tabs/sqlSandbox/codemap.md`](./packages/data/src/tabs/sqlSandbox/codemap.md) | SQL Sandbox backend: `runSandboxQuery` execution, `loadSchemaCatalog` introspection, `SqlAutocomplete` class (provisioned, not wired), `SchemaBrowser` tree model (provisioned, not wired). |
| `packages/data/src/tabs/chatbot/` | [`packages/data/src/tabs/chatbot/codemap.md`](./packages/data/src/tabs/chatbot/codemap.md) | Chatbot entry point: separate DuckDB singleton (`db.ts`, READ_ONLY), dynamic `buildSystemPrompt()`, model selection state (`openrouter.ts`), and three child subsystems. |
| `packages/data/src/tabs/chatbot/agent/` | [`packages/data/src/tabs/chatbot/agent/codemap.md`](./packages/data/src/tabs/chatbot/agent/codemap.md) | LangGraph agent: dual architecture — single-agent worker graph (SQL error correction, tool budget, hallucination validation) + multi-agent orchestrator (planner/workers/synthesizer). 5 Zod-v4 tools, streaming layer, intent classification. |
| `packages/data/src/tabs/chatbot/utils/` | [`packages/data/src/tabs/chatbot/utils/codemap.md`](./packages/data/src/tabs/chatbot/utils/codemap.md) | SQL safety pipeline (`validateReadOnlySql`, `extractSql`, `executeSql`), exponential-backoff retry with ERROR_PREFIX contract, NDJSON metrics/events session, async-local correlation IDs, error capture, ASCII table formatter, markdown→ANSI. |
| `packages/data/src/tabs/chatbot/eval/` | [`packages/data/src/tabs/chatbot/eval/codemap.md`](./packages/data/src/tabs/chatbot/eval/codemap.md) | Offline eval suite: 3-way truth comparison (agent vs DuckDB vs bbr-truth.json). Matrix eval (30 questions, 4 tiers) with BBR truth anchors, DB truth resolvers (`dbTruth.ts`), BBR HTML parser (`bbrPlayerParser.ts`). |
| `packages/web/` | [`packages/web/codemap.md`](./packages/web/codemap.md) | TanStack Start SSR app: Vite 8, React 19, Tailwind v4. 6 routes under a single root shell. Server functions (`createServerFn`) bridge UI→data package. Chat uses plain fetch POST to `/api/copilotkit`. |
| `packages/web/src/` | [`packages/web/src/codemap.md`](./packages/web/src/codemap.md) | Router setup (`TanStackRouter` with `QueryClientProvider`), auto-generated `routeTree.gen.ts`, root layout shell (`__root.tsx`), 6 route pages, 3 SQL Sandbox components, global TokyoNight Tailwind theme. |
| `packages/web/src/components/` | [`packages/web/src/components/codemap.md`](./packages/web/src/components/codemap.md) | Three reusable SQL Sandbox UI components: `CodeEditor` (CodeMirror 6), `SchemaTree` (recursive accordion), `ResultsTable` (TanStack Table v8). All inert presentational — no DB access. |
| `packages/web/src/routes/` | [`packages/web/src/routes/codemap.md`](./packages/web/src/routes/codemap.md) | Six file-based routes: `/` (→game-center redirect), `/game-center`, `/time-machine`, `/sql-sandbox`, `/chat`, `/api/copilotkit`. Server functions dynamically import `data` package. |
| `packages/web/src/routes/api/` | [`packages/web/src/routes/api/codemap.md`](./packages/web/src/routes/api/codemap.md) | Single API route: `POST /api/copilotkit`. Dynamic imports isolate CJS deps. Converts wire messages→LangChain `BaseMessage[]`, consumes `streamQuery()` generator, returns `{messages: [{role, content}]}`. |

### `scripts/` — Automation & tooling

| Directory | Codemap | Responsibility |
|-----------|---------|---------------|
| `scripts/` | [`scripts/codemap.md`](./scripts/codemap.md) | Automation root: CI guards/fixture building, DuckDB warehouse DQ+curation, chatbot eval harnesses, BBR Firecrawl mirror pipeline, ad-hoc dev debugging, nba_api validation. |
| `scripts/bbr/` | [`scripts/bbr/codemap.md`](./scripts/bbr/codemap.md) | Firecrawl-backed offline mirror of Basketball-Reference.com. Two-phase pipeline (map→crawl) produces `bbr-screenshots/` (PNG+JSON) and `.firecrawl/` (markdown). Per-directory 2 PNG + 2 JSON artifact quota. |
| `scripts/ci/` | [`scripts/ci/codemap.md`](./scripts/ci/codemap.md) | CI automation: `build-ci-fixture.ts` (prunes full DB→~2.8 MB committed fixture from `unified_star`, 7 tables), `ci-guards.sh` (rejects `.only`/`.skip`, `UPDATE_SNAPSHOTS`, Biome warnings), `apply-branch-protection.sh` (GitHub API). |
| `scripts/db/` | [`scripts/db/codemap.md`](./scripts/db/codemap.md) | DuckDB warehouse DQ + curation: 60+ single-table checks, cross-table verification, advanced stat recompute, accuracy reconciliation (BBR vs DB), golden-record merge views, entity xref, source registry, metric catalog. |
| `scripts/db/sources/` | [`scripts/db/sources/codemap.md`](./scripts/db/sources/codemap.md) | Config-only typed manifest registry for NBA data sources (bref, nba_api_sqlite, nba_stats, espn). Drives entity resolution, crosswalk derivation, and source onboarding via `SourceManifest` interface. |
| `scripts/eval/` | [`scripts/eval/codemap.md`](./scripts/eval/codemap.md) | Offline chatbot eval harnesses: fact-checked smoke test (`chatbot-smoke.ts`), multi-model matrix eval (`chatbot-eval-multi-model.ts`), streaming iteration loop (`iterate_loop.ts`) with JSONL traces and CSV summaries. |
| `scripts/eval/shared/` | [`scripts/eval/shared/codemap.md`](./scripts/eval/shared/codemap.md) | Shared eval utilities: model tier presets (`SMOKE_MODEL_TIERS`), type definitions (`TestResult`, `FailureType`), text/numeric normalizers, duplicate detection, timeout wrapper. Zero chatbot internals dependency. |
