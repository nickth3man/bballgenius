# Contributing to BBallGenius

Thank you for your interest in contributing! This guide covers everything from setting up your development environment to submitting pull requests.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Architecture](#architecture)

## Development Setup

### Prerequisites

- **Bun** 1.3.6+ (see `packageManager` in `package.json`)
- **Git**
- A terminal with ANSI color support
- `OPENROUTER_API_KEY` (only needed for chatbot development)

### Getting Started

```bash
git clone https://github.com/nickth3man/bballgenius.git
cd bballgenius
bun install
```

### Database Setup

Both apps query a local DuckDB file. For development:

```bash
# Option 1: Use the CI fixture (small, ~2.8 MB, limited data)
export NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb

# Option 2: Use the full database (~1.5 GB, gitignored)
mkdir -p data
# Place nba.duckdb in data/ (build from nickth3man/nbadb pipeline)
```

### Environment Variables

Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

Key variables:

| Variable | Required | Purpose |
|----------|----------|---------|
| `NBA_DUCKDB_PATH` | No | Override default database path |
| `OPENROUTER_API_KEY` | Chatbot only | OpenRouter API key for model calls |
| `MODEL` | No | Model name (default: `openai/gpt-oss-120b`) |
| `CHATBOT_DEBUG` | No | Enable debug logging to stderr |

### Verify Setup

```bash
# Run the hub
bun start

# Run the chatbot (requires OPENROUTER_API_KEY, accessible as F4 tab in hub)
bun start

# Run the test suite
bun run test:unit
bun run ci:integration
bun run test:chatbot
```

## Project Structure

```text
bballgenius/
├── src/
│   ├── index.ts         # TUI bootstrap
│   ├── core/            # App shell, DB connection, types, errors
│   ├── shared/          # Formatters, theme, keyboard help, dbPath
│   ├── tabs/            # Tab registry + per-tab folders (gameCenter, timeMachine, sqlSandbox, chatbot/)
│   └── tests/           # Hub test suite + snapshots
├── scripts/             # CI guards, fixture builder, BBR crawl, smoke tests
├── data/
│   └── fixtures/        # CI DuckDB fixture (~2.8 MB, committed)
├── docs/                # Architecture and agent docs
├── .github/             # CI workflows, issue/PR templates
├── biome.json           # Linter + formatter config
├── tsconfig.json        # Full repo TypeScript config
└── lefthook.yml         # Pre-commit hooks
```

### Package Boundaries

- All code lives under `src/` — no separate package directories.
- Tabs must not import sibling tabs — only from `src/core/`, `src/shared/`, and their own tab folder.
- Chatbot tab lives at `src/tabs/chatbot/`, imports from `../../core/`, `../../shared/`, and `./`.

## Development Workflow

### Running the Apps

```bash
bun start              # Hub TUI (all tabs, including chatbot)
```

### Linting and Formatting

```bash
bun run lint           # Biome CI check (error on warnings)
bun run lint:fix       # Auto-fix lint + format issues
bun run format:check   # Verify formatting + git diff
```

Lefthook runs `bunx biome check --write` automatically on staged `.ts` and `.json` files before each commit.

### Type Checking

```bash
bun run typecheck            # Full repo check
```

For a single file:

```bash
bunx tsc --noEmit src/tabs/chatbot/agent/graph.ts
```

## Coding Standards

### Formatting (Biome)

- 2-space indentation, single quotes, semicolons
- 100-character line width
- `organizeImports` enabled

### TypeScript

- Strict mode enabled globally
- Chatbot has additional strictness: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`
- No `any` types (enforced by Biome)
- No untyped `let` (enforced by Biome)
- Use `import type` / `export type` for type-only imports/exports
- Prefer `const` over `let`
- Use `===` over `==`

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Variables, functions | `camelCase` | `selectedGameIdx`, `getChatbotGraph` |
| Types, classes | `PascalCase` | `ChatbotState`, `GameCenterTab` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_SQL_RETRIES`, `DEFAULT_DB_PATH` |
| DB tables/columns | `snake_case` | `dim_game`, `player_id` |

### Import Organization

- Use relative paths with `.js` extension (e.g. `import { initDb } from './db.js'`)
- Order: Node built-ins → third-party → relative local
- Biome auto-organizes imports on save/commit

### Adding a New Hub Tab

1. Create `src/tabs/<tabId>/` with `tab.ts`, optional `queries.ts`, and `index.ts`
2. Register in `TAB_REGISTRY` (`src/tabs/registry.ts`)
3. Add shortcuts to `KEYBOARD_MAP` in `src/shared/utils/keyboardHelp.ts`
4. Run `bun run keyboard-map:sync`
5. Write tests using `getTab(shell, '<tab-id>')` helper

### Adding Chatbot Features

1. **New tool**: Add to `src/tabs/chatbot/agent/tools.ts` → bind in `graph.ts`
2. **Graph node**: Add to `buildGraph()` in `graph.ts` → wire edges
3. **State field**: Add to `ChatbotState` in `state.ts` only if a graph node reads/writes it
4. **Tests**: Add to `src/tabs/chatbot/__tests__/`; use `mock.module()` for `@langchain/openai` and `../db.js`

## Testing

### Test Layers

| Layer | Command | Requires DB |
|-------|---------|-------------|
| Hub unit (formatters) | `bun run test:unit` | No |
| Hub integration | `bun run ci:integration` | CI fixture |
| Hub regression | `bun run test:regression` | CI fixture |
| Chatbot tests | `bun run test:chatbot` | CI fixture |
| Full typecheck | `bun run typecheck` | No |
| Lint | `bun run lint` | No |
| Audit | `bun run audit` | No |

Always pass `--concurrency=1` for DuckDB and OpenTUI test suites.

### Running Tests

```bash
# All hub tests on CI fixture
bun run ci:integration

# All chatbot tests
bun run test:chatbot

# Single test file
bun test src/tabs/chatbot/__tests__/processQuestion.test.ts --concurrency=1

# Full local CI equivalent
bun run ci
```

### Writing Tests

- Hub tests: `src/tests/` — use helpers from `src/tests/helpers/`
- Chatbot tests: `src/tabs/chatbot/__tests__/` — mock `@langchain/openai` and `../db.js` with `mock.module()`
- Golden snapshots: regenerate only against `data/fixtures/nba.ci.duckdb`, never the full DB
- Never use `.only(` or `.skip(` — CI guards block them

## Submitting Changes

### Before Opening a PR

1. Run the full local CI suite:

   ```bash
   bun run ci
   ```

2. Ensure no Biome warnings or unformatted files
3. Update `AGENTS.md` if architecture or commands changed
4. Regenerate golden snapshots if hub rendering changed (CI fixture only)

### PR Checklist

- [ ] All CI checks pass
- [ ] No `.only(` / `.skip(` in test files
- [ ] No `any` types or untyped `let`
- [ ] No cross-tab imports
- [ ] No sibling tab imports
- [ ] `AGENTS.md` updated if needed

### PR Process

1. Fork the repository and create a feature branch from `main`
2. Make your changes following the coding standards above
3. Open a pull request using the PR template
4. Address review feedback
5. Ensure all CI checks pass

## Architecture

See [docs/architecture.md](docs/architecture.md) for detailed architecture diagrams and data flow.

### Quick Reference

**Hub**: `src/index.ts` → `appShell` → `TAB_REGISTRY` → per-tab `queries.ts` → DuckDB

**Chatbot**: `src/tabs/chatbot/chatApp.ts` → LangGraph (`llm` → `tools` → `sql_critic` → `llm`) → DuckDB + OpenRouter

### Key Files

| File | Purpose |
|------|---------|
| `src/shared/dbPath.ts` | Shared DB path resolution |
| `src/core/appShell.ts` | Hub key routing and tab management |
| `src/core/db.ts` | Hub DuckDB connection |
| `src/tabs/registry.ts` | Tab registry |
| `src/tabs/chatbot/agent/graph.ts` | LangGraph agent definition |
| `src/tabs/chatbot/agent/tools.ts` | DuckDB tools for the agent |
| `src/tabs/chatbot/agent/streaming.ts` | Token streaming |
| `src/tabs/chatbot/utils/sql.ts` | SQL validation and extraction |

## Questions?

Open a [GitHub Discussion](https://github.com/nickth3man/bballgenius/discussions) or issue.
