# AGENTS.md

## Project Overview

BBallGenius is a **Bun monorepo** under `src/` with two packages:

| Package | Path | Status | Purpose |
|---------|------|--------|---------|
| **hub** | `src/hub/` | Production | Terminal NBA analytics hub (OpenTUI + DuckDB): game directory, box scores, shot charts, Time Machine, SQL sandbox |
| **chatbot** | `src/chatbot/` | Placeholder | Future conversational interface; entry stub only |

The hub consolidates game-by-game directories, box scores, play-by-play shot charts, and an ad-hoc SQL console into a single keyboard-driven TUI. It connects to a local DuckDB file (`data/nba.duckdb`) and has a comprehensive virtual-rendering test suite under `src/hub/tests/`.

**Entry points:** `bun start` / `bun run hub:start` → hub TUI; `bun run chatbot:start` → chatbot stub.

## Repository Structure

```text
bballgenius/
├── .github/workflows/     # CI (ci.yml)
├── data/
│   ├── fixtures/          # Committed nba.ci.duckdb (~2.8 MB) for CI
│   └── nba.duckdb         # Local full DB (gitignored, ~1.5 GB)
├── scripts/               # CI guards, fixture build, BBR crawl, agent-smoke
├── .firecrawl/            # BBR markdown cache (gitignored map artifacts)
├── bbr-screenshots/       # BBR PNG + JSON mirrors (gitignored)
└── src/
    ├── hub/               # Terminal hub (all production app code)
    │   ├── index.ts       # TUI bootstrap
    │   ├── core/          # appShell, db, dbHonors, errors, types
    │   ├── shared/utils/  # formatters, theme, keyboardHelp, keyboard-map.json
    │   ├── tabs/          # registry + gameCenter/, timeMachine/, sqlSandbox/
    │   └── tests/         # Bun tests + snapshots/
    └── chatbot/
        └── index.ts       # Placeholder CLI entry
```

- **`.github/workflows/`** — GitHub Actions CI (`ci.yml`).
- **`scripts/`** — Automation (`ci-guards.sh`, `build-ci-fixture.ts`, BBR map/crawl, `agent-smoke.sh`).
- **`src/hub/core/`** — App shell, DuckDB access, shared types (`appShell.ts`, `db.ts`, `dbHonors.ts`, `errors.ts`, `types.ts`).
- **`src/hub/shared/utils/`** — Cross-tab formatters, theme, keyboard help (`formatters.ts`, `theme.ts`, `keyboardHelp.ts`, `keyboard-map.json`).
- **`src/hub/tabs/`** — Tab registry plus per-tab folders (`gameCenter/`, `timeMachine/`, `sqlSandbox/`).
- **`src/hub/tests/`** — Full Bun-native test suite (visual snapshots, mocks, regression).

### Package boundaries

- **Hub** and **chatbot** are siblings under `src/`. Do not import one from the other until an explicit shared package exists (e.g. `src/shared/`).
- **Hub tabs** must not import sibling tabs — only `src/hub/core/*`, `src/hub/shared/*`, and their own `src/hub/tabs/<tabId>/` folder (enforced by `scripts/ci-guards.sh`).
- **Repo-root assets** (`.firecrawl/`, `bbr-screenshots/`, `data/`) are resolved from hub code via relative paths up to the repository root (e.g. `src/hub/tabs/timeMachine/utils/bbr/bbrMirroredStore.ts`).

## Tech Stack

- **Language:** TypeScript 5.x / 6.x (Bun runtime)
- **Hub UI:** OpenTUI (`@opentui/core`)
- **Database:** DuckDB (`@duckdb/node-api`, `@duckdb/node-bindings`)
- **Lint / format:** Biome (`biome.json`)
- **Typecheck:** `tsc --noEmit -p tsconfig.json` (`rootDir`: `./src`, includes `src/**/*`)

## Build & Development Commands

### Hub & chatbot entrypoints

```bash
bun start              # alias: bun run hub:start → src/hub/index.ts
bun run hub:start      # Terminal analytics TUI
bun run chatbot:start  # Chatbot stub (not implemented)
```

### File-Scoped Commands (Preferred for Fast Feedback)

```bash
# Type check a single hub file
bunx tsc --noEmit src/hub/core/db.ts

# Lint or format a single file
bunx biome check --write src/hub/core/db.ts

# Run a single hub test file
bun test src/hub/tests/formatters.test.ts --concurrency=1
```

### Project-Wide Commands (Use Sparingly)

```bash
bun install --frozen-lockfile
bun run ci                    # guards, lint, format:check, typecheck, unit, integration, audit
bun run test:unit             # hub formatters only (no DB)
bun run ci:integration        # full hub suite on CI fixture
bun run fixture:build         # rebuild data/fixtures/nba.ci.duckdb from local DB
bun run keyboard-map:sync     # src/hub/shared/utils/keyboard-map.json from keyboardHelp.ts
```

### BBR screenshot crawl (Firecrawl)

Mirrors [Basketball-Reference](https://www.basketball-reference.com) into repo-root `bbr-screenshots/` (PNG + JSON) and `.firecrawl/` (markdown). Used by hub Time Machine BBR views (`src/hub/tabs/timeMachine/utils/bbr/`). Requires `FIRECRAWL_API_KEY` and the [Firecrawl CLI](https://firecrawl.dev).

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
- **`src/hub/tests/bbrIntegration.test.ts`** expects optional local `.firecrawl/*.md` fixtures; failures there are OK in CI without a full crawl mirror.

## CI/CD Infrastructure & API

### Overview

To run integration tests in CI without the 1.5 GB database, BBallGenius uses a **CI DuckDB fixture** plus static guards and peer dependency overrides.

Key terms:

- **CI Fixture:** Pruned committed DB (`data/fixtures/nba.ci.duckdb`, ~2.8 MB) with representative games, players (LeBron, Bob Cousy), shots, awards.
- **Flat Peer Overrides:** Third-party peers (e.g. `bun-ffi-structs`) compile against root TypeScript 6.0.3.
- **Pre-commit Guards:** `scripts/ci-guards.sh` — no `.only`/`.skip` in `src/hub/tests/`, no sibling tab imports in `src/hub/tabs/`, no `UPDATE_SNAPSHOTS` in Actions, zero Biome warnings.
- **Lint policy:** `noExplicitAny` and `noImplicitAnyLet` are **errors**; CI requires **zero warnings** from `biome lint`.

### API Reference

#### `resolveDbPath(): string` (defined in `src/hub/core/db.ts`)

Dynamically determines the DuckDB file path.

- **Parameters:** None.
- **Returns:** `string` (resolved database path).
- **Behavior:**
  1. `process.env.NBA_DUCKDB_PATH` if set (highest priority).
  2. If `CI=true` or `GITHUB_ACTIONS=true` and `data/fixtures/nba.ci.duckdb` exists → CI fixture.
  3. Else `data/nba.duckdb`.

```ts
import { resolveDbPath } from './core/db.js'; // from within src/hub/

const activePath = resolveDbPath(); // e.g. 'data/fixtures/nba.ci.duckdb'
```

### Automation & Script Details

- **`scripts/build-ci-fixture.ts`** (`bun run fixture:build`): Subset from local `data/nba.duckdb`; `CHECKPOINT` to avoid WAL commits.
- **`scripts/ci-guards.sh`**: Hub test focus guards, sibling-tab import ban, Biome zero-warning policy.
- **`scripts/sync-keyboard-map.ts`**: Writes `src/hub/shared/utils/keyboard-map.json`.
- **`scripts/capture-spans-dump.ts`**: Span dump for hub shell debugging (imports `src/hub/core/*`).
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

### Naming Conventions

- **Variables & functions:** `camelCase` (e.g. `selectedGameIdx` in `src/hub/tabs/gameCenter/tab.ts`)
- **Types & classes:** `PascalCase` (e.g. `GameCenterTab`)
- **Constants:** `SCREAMING_SNAKE_CASE` or theme `PascalCase` (e.g. `DEFAULT_DB_PATH`, `Theme`)
- **DB tables/columns:** `snake_case` (e.g. `dim_game`, `player_id`)

### Import Organization

- **Local imports:** Relative paths with `.js` extension in TypeScript (e.g. `import { initDb } from './core/db.js'` in `src/hub/index.ts`).
- **Order:** Node built-ins (`node:`) → third-party → relative local.
- **Scope:** Hub code stays under `src/hub/`; chatbot under `src/chatbot/` until shared modules are introduced.

## Architecture Notes

### High-Level Overview (hub)

```text
+----------------------+     +------------------------+     +------------------------+
|   src/hub/index.ts   | --> | src/hub/core/appShell  | --> | src/hub/tabs/registry  |
|   (TUI entrypoint)   |     | (keys, tabs, help)     |     | + per-tab folders      |
+----------------------+     +------------------------+     +------------------------+
          |                            |                              |
          v                            v                              v
+----------------------+     +------------------------+     +------------------------+
|  src/hub/core/db.ts  |     | tabs/*/queries.ts      |     | src/hub/shared/utils   |
|  (DuckDB)            | <---| (production SQL)       |     | (formatters, theme)    |
+----------------------+     +------------------------+     +------------------------+
          |
          v
   data/nba.duckdb  |  data/fixtures/nba.ci.duckdb
```

```text
src/chatbot/index.ts  →  (future: LLM / API layer, may share hub db helpers later)
```

### Key Components (hub)

- **TUI entry:** `src/hub/index.ts` — `initDb()`, `CliRenderer` @ 30 FPS, `createAppShell()`.
- **Tab registry:** `src/hub/tabs/registry.ts` — `TAB_REGISTRY`; F-keys/digits routed dynamically.
- **Key router:** `src/hub/core/appShell.ts` — `keypress`, tab headers, `?` help overlay.
- **SQL:** `src/hub/tabs/<tabId>/queries.ts` per tab.
- **Tabs:** `src/hub/tabs/<tabId>/` — `tab.ts`, optional `queries.ts`, `index.ts` export; focus via `Tab` / `Shift+Tab`.

### Coupling & Dependencies

- `src/hub/core/db.ts` — single DuckDB connection for all hub views.
- Tabs: `src/hub/core/*`, `src/hub/shared/*`, own tab folder only — **never sibling tabs**.
- Tests: `getTab(shell, 'game-center')` via `src/hub/tests/helpers/tabs.ts` (stable ids, not numeric tab index).
- Chatbot: isolated; no hub imports until designed otherwise.

### Adding a New Hub Tab

1. Create `src/hub/tabs/<tabId>/` (`tab.ts`, `queries.ts` if needed, `index.ts`).
2. Register in `TAB_REGISTRY` (`src/hub/tabs/registry.ts`).
3. Add shortcuts to `KEYBOARD_MAP.tabs` in `src/hub/shared/utils/keyboardHelp.ts`; run `bun run keyboard-map:sync`.
4. Tests with `getTab(shell, '<tab-id>')` — no F-key changes in `appShell.ts`.

### Adding Chatbot Features

1. Implement under `src/chatbot/` (new modules as needed).
2. Prefer importing shared logic from a future `src/shared/` or extracted hub modules only after an explicit refactor — avoid tight coupling to TUI tab classes.
3. Add `chatbot:*` scripts to `package.json` when subcommands grow beyond `chatbot:start`.

## Dos and Don'ts

### Do

- Use `resolveDbPath()` in hub code for CI-safe DB paths (`src/hub/core/db.ts`).
- Pass `--concurrency=1` to `bun test` (DuckDB + snapshot stability).
- Convert ANSI text with `ansiToStyledText` before `TextRenderable` writes (`src/hub/tabs/gameCenter/tab.ts`).
- Put new terminal features in `src/hub/`; new conversational features in `src/chatbot/`.
- Follow `.agent/subtask-template.md` when writing subtask delegation prompts (position-sensitive critical rules, ≤4 nesting levels, 30-50% token reduction, @references for single-source rules).

### Don't

- Commit `data/nba.duckdb` (~1.5 GB).
- Use `.only(` / `.skip(` in `src/hub/tests/` (CI blocked).
- Commit `any` or untyped `let` (Biome errors).
- Merge with Biome warnings or unformatted `src/` / `scripts/`.
- Leak raw ANSI into snapshot assertions (`src/hub/tests/helpers/ansi.ts`).
- Commit `bbr-screenshots/` or generated `.firecrawl/bbr-map-full.txt`.
- Import `src/hub/tabs/*` from `src/chatbot/` (or vice versa) without a deliberate shared layer.

## Testing Strategy

| Layer | Location | Notes |
|-------|----------|-------|
| Unit | `src/hub/tests/formatters.test.ts` | No database |
| Integration | `src/hub/tests/tui_integration.test.ts` | OpenTUI `createTestRenderer` |
| Spans | `src/hub/tests/spans_frame.test.ts` | Structured focus/tab colors |
| Golden | `src/hub/tests/golden_snapshot.test.ts` | `src/hub/tests/snapshots/` |
| BBR parser | `src/hub/tests/bbrIntegration.test.ts` | Optional `.firecrawl/` fixtures locally |

- **Full hub suite:** `bun test src/hub/tests --concurrency=1` or `bun run ci:integration` with `NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb`.
- **Agent smoke:** `NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb bash scripts/agent-smoke.sh` (~30s).
- **Keyboard map:** `src/hub/shared/utils/keyboard-map.json` ← `keyboardHelp.ts`; see `docs/agent-tui.md`.
- **Spans dump:** `bun run scripts/capture-spans-dump.ts [tabIndex]` with CI fixture path set.
- **Honors overlay:** `NBA_HONORS_DUCKDB_PATH` for `v_player_honors_full` while game data stays on `NBA_DUCKDB_PATH`.

## Security & Compliance

- **Secrets:** Hub/chatbot DB work is local DuckDB; BBR crawl needs `FIRECRAWL_API_KEY` only for map/crawl scripts.
- **License:** No LICENSE file; source-available — do not redistribute without permission.

## Agent Guardrails

### Allowed Without Asking

- Read/search any file; file-scoped lint, format, `tsc`.
- Run hub tests with `concurrency=1`.

### Ask Before Doing

- Delete files or folders.
- Change `package.json` dependencies.
- Edit `.github/workflows/ci.yml`.
- Git commit or push.

## Unknowns & TODOs

- [ ] **Chatbot:** Implement `src/chatbot/` beyond placeholder; decide shared DB/API layer with hub.
- [ ] **nbadb pipeline:** Building `data/nba.duckdb` is out of repo scope.
- [ ] **License:** Add LICENSE (open-source vs source-available).
