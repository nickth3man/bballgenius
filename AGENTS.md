# AGENTS.md

## Project Overview
BBallGenius is a terminal-based NBA analytics hub built with **Bun**, **OpenTUI**, and **DuckDB**. It consolidates game-by-game directories, box scores, play-by-play shot charts, and an ad-hoc SQL console into a single consolidated, keyboard-driven terminal application. It connects to a local DuckDB instance (`nba.duckdb`) and features a comprehensive virtual-rendering test suite.

## Repository Structure
- **.github/workflows/** - GitHub Actions CI configuration (`ci.yml`).
- **data/** - Root folder for datasets.
  - **fixtures/** - Holds the minimal committed `nba.ci.duckdb` (~2.8 MB) used in CI.
- **scripts/** - Automation and CI guard scripts (`ci-guards.sh`, `build-ci-fixture.ts`).
- **src/** - Application source code.
  - **queries/** - Production SQL query definitions.
  - **tabs/** - View controllers for each TUI tab (`GameCenterTab`, `TimeMachineTab`, `SqlSandboxTab`).
  - **tests/** - Full Bun-native test suite including visual snapshots, mocks, and regression suites.
  - **utils/** - Styling themes, keyboard bindings, and table/chart formatters.

## Tech Stack
- **Language:** TypeScript 5.x / 6.x (executed natively with Bun runtime)
- **Framework:** OpenTUI (Terminal UI framework with React-like layout box structure)
- **Database:** DuckDB (In-process analytical database accessed via `@duckdb/node-api`)
- **Linting & Formatting:** Biome (configured via `biome.json`)
- **Key Libraries:** `@opentui/core` (UI renderables), `@duckdb/node-api` / `@duckdb/node-bindings` (database bindings)

## Build & Development Commands

### File-Scoped Commands (Preferred for Fast Feedback)
```bash
# Type check a single file
bunx tsc --noEmit src/db.ts

# Lint or format a single file
bunx biome check --write src/db.ts

# Run a single test file
bun test src/tests/formatters.test.ts
```

### Project-Wide Commands (Use Sparingly)
```bash
# Install dependencies
bun install --frozen-lockfile

# Local mirror of complete CI (guards, lint, typecheck, unit, integration, audit)
bun run ci

# Run unit tests only (no database required)
bun run test:unit

# Run full integration tests on the committed CI fixture database
bun run ci:integration

# Rebuild CI DuckDB fixture from full local DB
bun run fixture:build
```

## CI/CD Infrastructure & API

### Overview
To allow robust full-suite integration tests in resource-constrained or headless CI environments without downloading a 1.5 GB database, BBallGenius employs a **CI DuckDB Fixture** strategy coupled with unified static checks and peer dependency overrides.

Key terms:
- **CI Fixture:** A pruned, committed ~2.8 MB DuckDB database (`data/fixtures/nba.ci.duckdb`) containing all core table schemas and a representative slice of historical and deduplication edge-case statistics.
- **Flat Peer Overrides:** Configuration rules forcing third-party dependencies (like `bun-ffi-structs`) to defer peer compilation directly to the project's root TypeScript 6.0.3 version.
- **Pre-commit Guards:** Shell validations preventing focused tests (`.only`/`.skip`), golden snapshot modifications, and any Biome warnings from entering CI (`scripts/ci-guards.sh`).
- **Lint policy:** `noExplicitAny` and `noImplicitAnyLet` are **errors** in `biome.json`; CI requires **zero warnings** from `biome lint` (guards enforce this even if a rule is later downgraded to `warn`).

### API Reference
#### `resolveDbPath(): string` (defined in `src/db.ts:11-22`)
Dynamically determines the path to the DuckDB connection file based on environmental contexts.

- **Parameters:** None.
- **Returns:** `string` (resolved database path).
- **Behavior:**
  1. If `process.env.NBA_DUCKDB_PATH` is specified, it returns that path (highest priority override).
  2. If running under `CI=true` or `GITHUB_ACTIONS=true` and `data/fixtures/nba.ci.duckdb` exists, it falls back to the committed CI fixture database.
  3. Defaults to the local development database path (`data/nba.duckdb`).

```ts
import { resolveDbPath } from './db.js';

const activePath = resolveDbPath(); // e.g., 'data/fixtures/nba.ci.duckdb'
```

### Automation & Script Details
- **`scripts/build-ci-fixture.ts`** (`bun run fixture:build`): Connects to the local full `data/nba.duckdb` and extracts a subset of games, players (LeBron, Bob Cousy), shot coordinates, and awards. Executes `CHECKPOINT` to eliminate extraneous WAL files.
- **`scripts/ci-guards.sh`** (run in CI and `bun run ci`): Scans `src/tests/` using ripgrep (`rg`) to reject `.only(` or `.skip(` patterns, ensures `UPDATE_SNAPSHOTS` is not enabled in Actions, and fails if `biome lint` reports any warnings.
- **`format:check`** (`bun run format:check`): Applies Biome format/write fixes then fails if `git diff` is non-empty (committed sources must already be formatted).
- **`audit`** (`bun run audit`): Fails on **moderate** (and above) dependency advisories via `bun audit --audit-level=moderate`.
- **`scripts/apply-branch-protection.sh`**: Helper script to programmatically enforce the aggregate `"CI"` check on the `main` branch via GitHub Branch Protection API.
- **Common Pitfalls:**
  - *Mismatching snapshots:* Regenerating snapshots with `UPDATE_SNAPSHOTS=1` against local full `nba.duckdb` instead of the CI fixture. Always set `NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb` before updating.
  - *Extraneous WAL files:* Quitting the database without closing connectionsSync, causing a `nba.ci.duckdb.wal` to be committed. Always cleanly disconnect connections.

## Code Style & Conventions

### Formatting
- **Indentation:** 2 spaces (configured in `biome.json:14-15`)
- **Formatter:** Biome, single-quote strings, semicolons enabled (`biome.json:37-41`)
- **Line Length:** 100 characters max (`biome.json:16`)

### Naming Conventions
- **Variables & Functions:** `camelCase` (e.g., `selectedGameIdx` in `src/tabs/gameCenter.ts:30`, `resolveDbPath()` in `src/db.ts:11`)
- **Types & Classes:** `PascalCase` (e.g., `GameCenterTab` in `src/tabs/gameCenter.ts:10`)
- **Constants:** `SCREAMING_SNAKE_CASE` or `PascalCase` theme wrapper (e.g., `DEFAULT_DB_PATH` in `src/db.ts:4`, `Theme` in `src/utils/theme.ts:6`)
- **Database Tables & Columns:** `snake_case` (e.g., `dim_game`, `season_year`, `player_id` queried in `src/queries/gameCenter.ts:18-21`)

### Import Organization
- **Local Imports:** MUST use relative pathing with the `.js` extension, despite coding in TypeScript (e.g. `import { closeDb, initDb } from './db.js'` in `src/index.ts:3`).
- **Grouping:** Group Node.js built-ins first (using `node:` prefix), followed by third-party imports, followed by relative local imports.

## Architecture Notes

### High-Level Overview
```text
+-------------------+      +-------------------+      +-------------------+
|   src/index.ts    | ---> | src/appShell.ts   | ---> |    src/tabs/*     |
|   (TUI Entrypoint) |      | (Key Router, Tabs)|      |  (Views & State)  |
+-------------------+      +-------------------+      +-------------------+
         |                           |                          |
         v                           v                          v
+-------------------+      +-------------------+      +-------------------+
|    src/db.ts      |      |  src/queries/*    | <--- |  src/utils/*      |
|  (DuckDB Access)  | <--- | (Production SQL)  |      | (Formatters, Theme)|
+-------------------+      +-------------------+      +-------------------+
         |                           |
         +------------+--------------+
                      v
          [data/nba.duckdb (1.5GB)]
          [data/fixtures/nba.ci.duckdb (3MB)]
```

### Key Components
- **TUI Entry Point:** `src/index.ts:5` boots the DB connection, configures `CliRenderer` at 30 FPS, and constructs the main `AppShell`.
- **Global Key Router:** `src/appShell.ts:340-410` binds `on('keypress')`, controls the tab headers, routes key shortcuts, and shows the global `?` help modal.
- **SQL Queries:** Separated entirely from rendering logic in `src/queries/` (e.g., `src/queries/gameCenter.ts` and `src/queries/timeMachine.ts`) ensuring clean separation of concerns and database-free unit test options.
- **TUI Tabs:** Components under `src/tabs/` manage private panel states, scroll views, and focus indices (cycled with `Tab` and `Shift+Tab`).

### Coupling & Dependencies
- `src/db.ts` acts as the single database connection manager; modifying its connection state or `resolveDbPath` affects all views.
- Production modules in `src/tabs/` are coupled to `src/queries/` for fetching structured data; tests import queries from `src/tests/helpers/queries.ts` to guarantee type alignment.

## Dos and Don'ts

### Do
- Always use `resolveDbPath()` to safely fallback to the committed CI fixture during automated actions (`src/db.ts:11-22`).
- Always pass `--concurrency=1` to any `bun test` runner to prevent race conditions on DuckDB connections or console snapshots (`package.json:10`).
- Convert text containing ANSI style codes to `StyledText` using `ansiToStyledText` before writing to `TextRenderable` objects (`src/tabs/gameCenter.ts:350`).

### Don't
- **Never** stage or commit the 1.5 GB `data/nba.duckdb` file (gitignored).
- **Never** allow `.only(` or `.skip(` in test commits (blocked in CI by `scripts/ci-guards.sh`).
- **Never** commit `any` types or untyped `let` bindings (`noExplicitAny` / `noImplicitAnyLet` are Biome errors).
- **Never** merge with Biome warnings or unformatted `src/` / `scripts/` (blocked by guards + `format:check`).
- **Never** permit raw ANSI sequence leaking or raw escape patterns to bleed into snapshot assertions (`src/tests/helpers/ansi.ts:15-18`).

## Testing Strategy

- **Unit Tests:** Formatter logic and ANSI-to-StyledText parsers are entirely database-free (`src/tests/formatters.test.ts`).
- **Integration Tests:** Execute virtual keyboard keystrokes, panel focus cycling, and input blurs using an OpenTUI `createTestRenderer` mock (`src/tests/tui_integration.test.ts`).
- **Structured span tests:** `captureSpans()` assertions in `src/tests/spans_frame.test.ts` (focus/tab bar colors without parsing ANSI).
- **Regression / Snapshot Tests:** Compares real render buffers with a deterministic, normalized golden visual snapshot (`src/tests/golden_snapshot.test.ts`; snapshots under `src/tests/snapshots/`).
- **Agent smoke (fast loop):** `NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb bash scripts/agent-smoke.sh` runs formatters + TUI integration + golden tests (~30s).
- **Keyboard map for agents:** `src/utils/keyboard-map.json` (source: `KEYBOARD_MAP` in `src/utils/keyboardHelp.ts`). Optional PTY exploration: `docs/agent-tui.md`.
- **Spans JSON dump:** `bun run scripts/capture-spans-dump.ts [tabIndex]` with the CI fixture path set.
- **Database Path in CI:** Set `NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb` to run the complete integration suite quickly inside GitHub Actions.

## Security & Compliance
- **Secrets:** No API keys or external secrets are required; all database work is performed in-process via local DuckDB SQLite-style file connections.
- **License:** No license file specified. The repository is source-available; do not distribute without permission.

## Agent Guardrails

### Allowed Without Asking
- Reading any codebase file, searching with `Grep`, or finding files via `Glob`.
- Running file-scoped lint checks, syntax formatting, or TypeScript compilation.
- Running unit/integration tests with `concurrency=1`.

### Ask Before Doing
- Deleting files or folders.
- Installing or upgrading npm/bun dependencies in `package.json`.
- Modifying GitHub workflow files (`.github/workflows/ci.yml`).
- Staging and pushing commits to the remote origin.

## Unknowns & TODOs
- [ ] **nbadb Pipeline:** Gaining access to the source code for building `data/nba.duckdb` is currently out of scope (built externally).
- [ ] **License Definition:** The repository requires a LICENSE file to explicitly state open-source vs private source-available terms.
