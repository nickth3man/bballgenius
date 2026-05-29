# AGENTS.md

## Project Overview

BBallGenius is a **Bun monorepo** with a single unified NBA analytics application under `src/`:

The application is a terminal NBA analytics hub (OpenTUI + DuckDB) with four tabs:
- **Game Center** (F1): Game directory, box scores, shot charts
- **Career Time-Machine** (F2): Player/team search, BBR mirror, dossier, honors
- **SQL Sandbox** (F3): Schema browser, SQL editor, autocomplete
- **Chat** (F4): LangGraph-powered conversational NBA agent (DuckDB + OpenRouter)

The hub consolidates game-by-game directories, box scores, play-by-play shot charts, and an ad-hoc SQL console into a single keyboard-driven TUI. It connects to a local DuckDB file (`data/nba.duckdb`) and has a comprehensive virtual-rendering test suite under `src/tests/`.

The chatbot tab provides a TUI chat interface powered by a LangGraph ReAct agent with SQL critic node (error-correction loop), multi-tool support (schema discovery + query execution), streaming token output, checkpointing for multi-turn conversation, and an eval suite with 100 categorized NBA test queries.

**Entry points:** `bun start` / `bun run hub:start` → hub TUI.

## Repository Structure

```text
bballgenius/
├── .github/workflows/     # CI (ci.yml)
├── data/
│   ├── fixtures/          # Committed nba.ci.duckdb (~2.8 MB) for CI
│   └── nba.duckdb         # Local full DB (gitignored, ~1.5 GB)
├── scripts/               # CI guards, fixture build, BBR crawl, chatbot-smoke
├── .firecrawl/            # BBR markdown cache (gitignored map artifacts)
├── bbr-screenshots/       # BBR PNG + JSON mirrors (gitignored)
└── src/
    ├── index.ts           # TUI bootstrap
    ├── core/              # appShell, db, dbHonors, errors, types
    ├── shared/            # Shared utilities (formatters, theme, keyboardHelp, dbPath)
    ├── tabs/              # registry + gameCenter/, timeMachine/, sqlSandbox/, chatbot/
    │   └── chatbot/       # Chatbot tab (LangGraph agent + UI)
    │       ├── tab.ts     # AppShellTab adapter
    │       ├── chatApp.ts # Chat UI controller (OpenTUI, streaming, metrics)
    │       ├── db.ts      # DuckDB access + schema introspection
    │       ├── openrouter.ts # OpenRouter API client
    │       ├── systemPrompt.ts # Dynamic schema-aware system prompt builder
    │       ├── agent/     # LangGraph agent
    │       ├── utils/     # sql.ts, retry.ts, metrics.ts, ansi.ts, theme.ts
    │       ├── features/  # modelSelector.ts (interactive model picker)
    │       ├── eval/      # nba-100-queries.ts (100 categorized NBA questions)
    │       └── __tests__/ # Bun tests with LangChain mocking
    └── tests/             # Hub tests + snapshots/
```

- **`src/shared/dbPath.ts`** — Single shared DB path resolver.
- **`src/tabs/chatbot/agent/`** — LangGraph agent: graph definition, state schema, tools, model binding, streaming.
- **`src/chatbot/utils/`** — SQL validation/extraction/execution, retry with backoff, metrics logger, ANSI parser, theme.
- **`src/chatbot/eval/`** — 100 categorized NBA test questions across 17 categories.
- **`scripts/`** — Automation (`ci-guards.sh`, `build-ci-fixture.ts`, `chatbot-smoke.ts`, BBR map/crawl).

### Package boundaries

- **Tabs** must not import sibling tabs — only `src/core/*`, `src/shared/*`, and their own `src/tabs/<tabId>/` folder (enforced by `scripts/ci-guards.sh`).
- **Chatbot tab modules** import from `./agent/*`, `./utils/*`, `./features/*`, and `../../shared/*`.
- **Repo-root assets** (`.firecrawl/`, `bbr-screenshots/`, `data/`) are resolved from code via relative paths up to the repository root.

### Subagent delegation

- **Always read `.agent/subtask-template.md` immediately before creating any subagent/task prompt.** Apply its critical rules to the delegated prompt: critical instructions in the first 15%, max nesting depth 4, 40-50% instruction ratio, single-source rule references, and token-efficient wording without losing precision.
- Use the template for every `task` tool call, including scout/research agents, code review agents, and implementation subagents. Do not rely on memory of the template; reread the file each time delegation is needed.

## Tech Stack

- **Language:** TypeScript 5.x / 6.x (Bun runtime)
- **Hub UI:** OpenTUI (`@opentui/core`)
- **Chatbot UI:** OpenTUI (`@opentui/core`)
- **Agent framework:** LangGraph (`@langchain/langgraph` v1.3+), LangChain (`@langchain/core`, `@langchain/openai`)
- **Database:** DuckDB (`@duckdb/node-api`, `@duckdb/node-bindings`)
- **Model provider:** OpenRouter API (multi-model, configurable via `MODEL` env var)
- **Lint / format:** Biome (`biome.json`)
- **Typecheck:** `tsc --noEmit -p tsconfig.json` for the full repo.

## Build & Development Commands

### Hub & chatbot entrypoints

```bash
bun start              # alias: bun run hub:start → src/index.ts
bun run hub:start      # Terminal analytics TUI
```

### Chatbot-specific commands

```bash
bun test src/tabs/chatbot/__tests__ --concurrency=1   # Run chatbot tests (DB + mocked LLM)
bun run chatbot:smoke                                   # Smoke test with fact-checked NBA questions
bun run chatbot:smoke:100                               # Full 100-query smoke suite
```

### Fast-Feedback TDD Loop (Preferred for Daily Work)

```bash
# Run only tests affected by uncommitted changes (Bun 1.3.13+)
bun run test:changed

# Watch mode — re-runs affected tests on every file save
bun run test:changed:watch

# Stop at first failure, only changed tests
bun run test:quick

# Pre-commit sanity (typecheck + changed tests)
bun run typecheck && bun run test:quick
```

### File-Scoped Commands (Preferred for Fast Feedback)

```bash
# Type check a single file
bunx tsc --noEmit src/tabs/chatbot/agent/graph.ts

# Lint or format a single file
bunx biome check --write src/tabs/chatbot/agent/graph.ts

# Run a single test file
bun test src/chatbot/__tests__/processQuestion.test.ts --concurrency=1
```

### Project-Wide Commands (Use Sparingly)

```bash
bun install --frozen-lockfile
bun run ci                    # guards, lint, format:check, typecheck, unit, integration, audit
bun run test:unit             # hub formatters only (no DB)
bun run ci:integration        # full hub suite on CI fixture
bun run fixture:build         # rebuild data/fixtures/nba.ci.duckdb from local DB
bun run keyboard-map:sync     # src/shared/utils/keyboard-map.json from keyboardHelp.ts
```

### BBR screenshot crawl (Firecrawl)

Mirrors [Basketball-Reference](https://www.basketball-reference.com) into repo-root `bbr-screenshots/` (PNG + JSON) and `.firecrawl/` (markdown). Used by hub Time Machine BBR views (`src/tabs/timeMachine/utils/bbr/`). Requires `FIRECRAWL_API_KEY` and the [Firecrawl CLI](https://firecrawl.dev).

**Per-directory quota:** each mirrored folder gets up to **2 PNG** and **2 JSON** files (full scrape payload: `markdown`, `links`, `metadata`, `screenshot` URL).

**Map/crawl scope (default):** `players`, `teams`, `leagues` (seasons), `leaders`, `awards`, and player **gamelog** discovery only — no site-wide map passes or other BBR sections.

**Throughput (Firecrawl 2 concurrent jobs):** `BBR_MAP_PARALLEL=2`, `BBR_MAP_DELAY_SEC=0` (defaults). Crawl: `BBR_CRAWL_CONCURRENCY=2`, `BBR_SCRAPE_TIMEOUT_MS=120000`. Do not run map + crawl together — they share the same API quota.

**Always run map before crawl** (map is rebuilt from scratch every time; legacy `bbr-map*.txt` files are not merged in):

```bash
bun run bbr:map      # multi-pass firecrawl map → .firecrawl/bbr-map-full.txt + bbr-depth-index.json
bun run bbr:crawl    # wipes bbr-screenshots/*, then node scripts/takeBbrScreenshots.cjs
bun run bbr:verify   # map + per-directory 2 PNG / 2 JSON checks
bun run bbr:verify:map
bun run bbr:status   # heartbeat + progress JSON (no full log tailing)
bun run bbr:watch    # refresh status every 3s
bun run bbr:map:cancel
bun run bbr:observe  # kaizen: 5× cancel → 15s map probe → snapshot (scripts/bbrMapObserveCycle.sh)
```

- Map observability: `.firecrawl/bbr-map-progress.json`, `.firecrawl/bbr-map-heartbeat.txt`, `.firecrawl/bbr-map-observe-cycles.jsonl`.
- `bbr:crawl` calls `scripts/bbrPreflightCrawl.sh` (wipe + map freshness check).
- Optional: `BBR_CRAWL_BUDGET=500` to cap scrape count; `BBR_USE_LEGACY_SEEDS=1` to add old scattered seeds (default off).
- Map scratchpad: `.firecrawl/scratchpad/map-*` (gitignored). Discovered URLs during crawl append to `.firecrawl/bbr-map-discovered.txt` for the next `bbr:map` run.
- **`src/tests/bbrIntegration.test.ts`** expects optional local `.firecrawl/*.md` fixtures; failures there are OK in CI without a full crawl mirror.

## CI/CD Infrastructure & API

### Overview

To run integration tests in CI without the 1.5 GB database, BBallGenius uses a **CI DuckDB fixture** plus static guards and peer dependency overrides.

Key terms:

- **CI Fixture:** Pruned committed DB (`data/fixtures/nba.ci.duckdb`, ~2.8 MB) with representative games, players (LeBron, Bob Cousy), shots, awards.
- **Flat Peer Overrides:** Third-party peers (e.g. `bun-ffi-structs`) compile against root TypeScript 6.0.3.
- **Pre-commit Guards:** `scripts/ci-guards.sh` — no `.only`/`.skip` in `src/tests/` or `src/tabs/chatbot/__tests__/`, no sibling tab imports in `src/tabs/`, no `UPDATE_SNAPSHOTS` in Actions, zero Biome warnings.
- **Lint policy:** Biome runs with `--error-on-warnings`. Unused variables/imports, explicit `any`, untyped `let`, type-only imports/exports, `const` preference, enum initializers, template consistency, and double-equals are enforced.
- **Pre-commit hooks:** Lefthook runs `bunx biome check --write` on staged TypeScript/JSON files (parallel), plus a full-suite `.only`/`.skip` guard before commit. Pre-push runs full typecheck + unit tests.

### API Reference

#### `resolveDbPath(): string` (defined in `src/shared/dbPath.ts`)

Dynamically determines the DuckDB file path. Used by both hub and chatbot.

- **Parameters:** None.
- **Returns:** `string` (resolved database path).
- **Behavior:**
  1. `process.env.NBA_DUCKDB_PATH` if set (highest priority).
  2. If `CI=true` or `GITHUB_ACTIONS=true` and `data/fixtures/nba.ci.duckdb` exists → CI fixture.
  3. Else `data/nba.duckdb`.

```ts
import { resolveDbPath } from '../shared/dbPath.js'; // from within src/tabs/chatbot/

const activePath = resolveDbPath(); // e.g. 'data/fixtures/nba.ci.duckdb'
```

### Automation & Script Details

- **`scripts/build-ci-fixture.ts`** (`bun run fixture:build`): Subset from local `data/nba.duckdb`; `CHECKPOINT` to avoid WAL commits.
- **`scripts/ci-guards.sh`**: Hub/chatbot test focus guards, sibling-tab import ban, Biome zero-warning policy.
- **`scripts/sync-keyboard-map.ts`**: Writes `src/shared/utils/keyboard-map.json`.
- **`scripts/capture-spans-dump.ts`**: Span dump for hub shell debugging (imports `src/core/*`).
- **`scripts/chatbot-smoke.ts`**: Real API smoke test validating chatbot answers against expected keywords.
- **`scripts/agent-smoke.sh`**: Fast hub loop (formatters + TUI integration + golden) on CI fixture.
- **`format:check`**: Biome write on `src/` + `scripts/`, then `git diff --exit-code`.
- **`audit`**: Fails on moderate+ advisories.
- **Common pitfalls:**
  - *Snapshots:* Regenerate with `NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb`, not the full local DB.
  - *WAL files:* Close DuckDB cleanly before committing `nba.ci.duckdb`.

## Code Style & Conventions

### Formatting

- **Indentation:** 2 spaces (`biome.json`)
- **Formatter:** Biome, single quotes, semicolons
- **Line length:** 100 characters
- **Imports:** Biome `organizeImports` is enabled and run by `biome check --write` / Lefthook.

### Naming Conventions

- **Variables & functions:** `camelCase` (e.g. `selectedGameIdx`, `getChatbotGraph`)
- **Types & classes:** `PascalCase` (e.g. `ChatbotState`, `GameCenterTab`)
- **Constants:** `SCREAMING_SNAKE_CASE` or theme `PascalCase` (e.g. `MAX_SQL_RETRIES`, `DEFAULT_DB_PATH`, `Theme`)
- **DB tables/columns:** `snake_case` (e.g. `dim_game`, `player_id`)

### Import Organization

- **Local imports:** Relative paths with `.js` extension in TypeScript (e.g. `import { initDb } from './db.js'`).
- **Order:** Node built-ins (`node:`) → third-party → relative local.
- **Scope:** Hub code stays under `src/`; chatbot under `src/tabs/chatbot/`; shared under `src/shared/`.

## Architecture Notes

### High-Level Overview (hub)

```text
+----------------------+     +------------------------+     +------------------------+
|   src/index.ts       | --> | src/core/appShell      | --> | src/tabs/registry      |
|   (TUI entrypoint)   |     | (keys, tabs, help)     |     | + per-tab folders      |
+----------------------+     +------------------------+     +------------------------+
          |                            |                              |
          v                            v                              v
+----------------------+     +------------------------+     +------------------------+
|  src/core/db.ts      |     | tabs/*/queries.ts      |     | src/shared/utils       |
|  (DuckDB)            | <---| (production SQL)       |     | (formatters, theme)    |
+----------------------+     +------------------------+     +------------------------+
          |
          v
   data/nba.duckdb  |  data/fixtures/nba.ci.duckdb
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

- **`classify_intent` node**: Deterministic keyword-based classification (no LLM call). Tags the question with a category like `career_leaders`, `awards`, `games`, etc.
- **`llm` node**: Calls the model with bound tools (`query_nba_db`, `get_schema_info`, `list_nba_tables`, `check_nba_sql`). Returns tool calls or final answer.
- **`tools` node** (`ToolNode`): Executes tool calls. Supports parallel execution when the LLM emits multiple tool calls in a single response.
- **`sql_critic` node**: Examines tool output for SQL errors. Classifies errors (schema, syntax, transient) and routes back to LLM for correction up to `MAX_SQL_RETRIES=3`. Resets retry count on success. Routes to END when exhausted.
- **State** (`ChatbotState`): `messages` (MessagesValue), `sqlRetryCount` (optional number), and `intentCategory` (optional string). Do not add state fields unless a graph node reads/writes them.

### Key Components (hub)

- **TUI entry:** `src/index.ts` — `initDb()`, `CliRenderer` @ 30 FPS, `createAppShell()`.
- **Tab registry:** `src/tabs/registry.ts` — `TAB_REGISTRY`; F-keys/digits routed dynamically.
- **Key router:** `src/core/appShell.ts` — `keypress`, tab headers, `?` help overlay.
- **SQL:** `src/tabs/<tabId>/queries.ts` per tab.
- **Tabs:** `src/tabs/<tabId>/` — `tab.ts`, optional `queries.ts`, `index.ts` export; focus via `Tab` / `Shift+Tab`.

### Key Components (chatbot)

- **Graph:** `src/tabs/chatbot/agent/graph.ts` — `buildGraph()` creates the StateGraph with llm/tools/sql_critic nodes, `getChatbotGraph()` returns cached singleton, `resetGraph()` invalidates cache for model changes.
- **Streaming:** `src/tabs/chatbot/agent/streaming.ts` — `streamQuery()` yields `StreamEvent` (token, tool_start, tool_end, tool_error, usage, done, error) via LangGraph `streamEvents` v2.
- **Model:** `src/tabs/chatbot/agent/model.ts` — `createModel()` returns `ChatOpenAI` pointed at OpenRouter with `temperature: 0.3`.
- **Tools:** `src/tabs/chatbot/agent/tools.ts` — `query_nba_db` (read-only SQL execution with schema pre-validation) and `get_schema_info` (on-demand table/column discovery).
- **Error classification:** `src/tabs/chatbot/utils/retry.ts` — `categorizeDbError()` (transient/schema/syntax/permanent), `formatErrorForLLM()` (structured error messages for LLM consumption).
- **SQL utilities:** `src/tabs/chatbot/utils/sql.ts` — `validateReadOnlySql()`, `validateSchemaReferences()` (pre-execution table existence check), `extractSql()`, `executeSql()`.
- **Metrics:** `src/tabs/chatbot/utils/metrics.ts` — Structured NDJSON logger for duration, tokens, SQL queries, error rates.

### Coupling & Dependencies

- `src/core/db.ts` — single DuckDB connection for all hub views.
- `src/tabs/chatbot/db.ts` — separate DuckDB connection (richer introspection: `getTableRefs()`, `getColumns()`, `getTables()`).
- `src/shared/dbPath.ts` — shared path resolution used by both.
- Tabs: `src/core/*`, `src/shared/*`, own tab folder only — **never sibling tabs**.
- Tests: `getTab(shell, 'game-center')` via `src/tests/helpers/tabs.ts` (stable ids, not numeric tab index).
- Chatbot: tab under `src/tabs/chatbot/`; shares `src/shared/dbPath.ts` with hub.

### Adding a New Hub Tab

1. Create `src/tabs/<tabId>/` (`tab.ts`, `queries.ts` if needed, `index.ts`).
2. Register in `TAB_REGISTRY` (`src/tabs/registry.ts`).
3. Add shortcuts to `KEYBOARD_MAP.tabs` in `src/shared/utils/keyboardHelp.ts`; run `bun run keyboard-map:sync`.
4. Tests with `getTab(shell, '<tab-id>')` — no F-key changes in `appShell.ts`.

### Adding Chatbot Features

1. **New tool**: Add to `src/tabs/chatbot/agent/tools.ts` → bind in `graph.ts` `bindTools([...])` + `ToolNode([...])`.
2. **Graph node**: Add to `buildGraph()` in `graph.ts` → wire edges.
3. **State field**: Add to `ChatbotState` in `state.ts` only if a graph node reads/writes it.
4. **Stream event**: Add to `StreamEvent` union in `streaming.ts` → handle in `chatApp.ts`.
5. **Tests**: Add to `src/tabs/chatbot/__tests__/`; use `mock.module()` for `@langchain/openai` and `../db.js`.

## Dos and Don'ts

### Do

- Use `resolveDbPath()` for CI-safe DB paths (`src/shared/dbPath.ts`).
- Use `bun run test:changed` for fast TDD feedback (runs only tests affected by uncommitted changes, Bun 1.3.13+).
- Pass `--concurrency=1` to `bun test` for full test suite runs (DuckDB + snapshot stability).
- Convert ANSI text with `ansiToStyledText` before `TextRenderable` writes.
- Put new terminal features in `src/`; new conversational features in `src/tabs/chatbot/`.
- Use `mock.module()` in chatbot tests to mock `@langchain/openai` and `../db.js`.
- Use `zod/v4` for tool schemas and state validation.
- Read `.agent/subtask-template.md` before writing every subtask delegation prompt.

### Don't

- Commit `data/nba.duckdb` (~1.5 GB).
- Use `.only(` / `.skip(` in test files (CI blocked).
- Commit `any` or untyped `let` (Biome errors).
- Merge with Biome warnings or unformatted `src/` / `scripts/`.
- Leak raw ANSI into snapshot assertions.
- Commit `bbr-screenshots/` or generated `.firecrawl/bbr-map-full.txt`.
- Import `src/tabs/chatbot/*` from sibling tabs (or vice versa) beyond `src/shared/` and `src/core/`.
- Wrap `interrupt()` calls in try/catch blocks (interrupts throw to signal the runtime).

## Testing Strategy

| Layer | Location | Notes |
|-------|----------|-------|
| Hub unit | `src/tests/formatters.test.ts` | No database |
| Hub integration | `src/tests/tui_integration.test.ts` | OpenTUI `createTestRenderer` |
| Hub spans | `src/tests/spans_frame.test.ts` | Structured focus/tab colors |
| Hub golden | `src/tests/golden_snapshot.test.ts` | `src/tests/snapshots/` |
| Hub BBR | `src/tests/bbrIntegration.test.ts` | Optional `.firecrawl/` fixtures locally |
| Chatbot graph | `src/tabs/chatbot/__tests__/processQuestion.test.ts` | Mocked LLM + DB, tests ReAct + critic loops |
| Chatbot intent | `src/tabs/chatbot/__tests__/intentClassification.test.ts` | Deterministic keyword classification |
| Chatbot SQL | `src/tabs/chatbot/__tests__/executeSql.test.ts` | Real DuckDB, tests validation + execution |
| Chatbot extraction | `src/tabs/chatbot/__tests__/sqlExtraction.test.ts` | SQL parsing from LLM output |
| Chatbot formatting | `src/tabs/chatbot/__tests__/formatResults.test.ts` | Pretty-print formatting |
| Chatbot system | `src/tabs/chatbot/__tests__/systemPrompt.test.ts` | Dynamic prompt building |
| Chatbot ANSI | `src/tabs/chatbot/__tests__/ansi.test.ts` | ANSI-to-StyledText conversion |
| Chatbot retry | `src/tabs/chatbot/__tests__/retry.test.ts` | Error classification, retry behavior, LLM error prefixes |
| Chatbot streaming | `src/tabs/chatbot/__tests__/streaming.test.ts` | `streamQuery()` token/tool/usage/done/error events |
| Smoke | `scripts/chatbot-smoke.ts` | Real API, fact-checked NBA questions |

### Fast-Feedback Workflows

| Goal | Command | Notes |
|------|---------|-------|
| Changed-only tests (TDD) | `bun run test:changed` | Only tests touching uncommitted changes |
| Watch mode | `bun run test:changed:watch` | Re-runs on every save |
| Quick pre-commit | `bun run test:quick` | `--changed` + `--bail`, stops at first failure |
| Pre-push sanity | `bun run typecheck && bun run test:quick` | 30-60s typical |
| Snapshot update | `bun run snapshots:update` | CI fixture path pre-set |
| Full hub suite | `bun test src/tests --concurrency=1` or `bun run ci:integration` | CI fixture |
| Full chatbot suite | `bun test src/tabs/chatbot/__tests__ --concurrency=1` | Mocked LLM |
| Chatbot smoke | `OPENROUTER_API_KEY=... bun run chatbot:smoke` | Real API, fact-checked |

- **Agent smoke:** `NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb bash scripts/agent-smoke.sh` (~30s).
- **Keyboard map:** `src/shared/utils/keyboard-map.json` ← `keyboardHelp.ts`; see `docs/agent-tui.md`.
- **Honors overlay:** `NBA_HONORS_DUCKDB_PATH` for `v_player_honors_full` while game data stays on `NBA_DUCKDB_PATH`.

### Caveats

- `--changed` requires Bun 1.3.13+. It infers affected tests from git diff; freshly created files may not be detected until staged.
- `--concurrency=1` is still needed for full suite runs due to DuckDB singleton and snapshot ordering.

## Chatbot Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key (required) | — |
| `MODEL` | Model name (e.g. `openai/gpt-oss-120b`) | `openai/gpt-oss-120b` |
| `NBA_DUCKDB_PATH` | DuckDB path | `data/nba.duckdb` |
| `NBA_HONORS_DUCKDB_PATH` | Optional honors DB | — |
| `CHATBOT_DEBUG` | Enable debug logging to stderr | `false` |
| `CHATBOT_PERSIST_DIR` | Directory for persistent checkpoints (`SqliteSaver`) | — (uses `MemorySaver`) |
| `CHATBOT_METRICS_DIR` | Metrics output directory | `data/` |
| `LANGSMITH_TRACING` | Enable LangSmith tracing | — |
| `LANGSMITH_API_KEY` | LangSmith API key | — |

## Security & Compliance

- **Secrets:** Hub/chatbot DB work is local DuckDB; BBR crawl needs `FIRECRAWL_API_KEY`; chatbot needs `OPENROUTER_API_KEY`.
- **License:** No LICENSE file; source-available — do not redistribute without permission.

## Agent Guardrails

### Allowed Without Asking

- Read/search any file; file-scoped lint, format, `tsc`.
- Run hub or chatbot tests with `concurrency=1`.

### Ask Before Doing

- Delete files or folders.
- Change `package.json` dependencies.
- Edit `.github/workflows/ci.yml`.
- Git commit or push.
- Modify `src/shared/` (shared by both packages).

## Unknowns & TODOs

- [ ] **Chatbot persistence:** `SqliteSaver` available via `CHATBOT_PERSIST_DIR`; not yet surfaced in TUI as save/load feature.
- [ ] **Hub-chatbot bridge:** Embed chatbot in hub TUI as a new tab or overlay.
- [ ] **nbadb pipeline:** Building `data/nba.duckdb` is out of repo scope.
- [ ] **License:** Add LICENSE (open-source vs source-available).
- [ ] **Chatbot HITL:** Interrupt-based SQL approval pattern documented but not wired due to complexity; available as future feature.
