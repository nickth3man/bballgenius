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
- `OPENROUTER_API_KEY` (only needed for chatbot development and smoke tests)

### Getting Started

```bash
git clone https://github.com/nickth3man/bballgenius.git
cd bballgenius
bun install
```

### Database Setup

Both packages query a local DuckDB file. For development:

```bash
# Option 1: Use the CI fixture (small, ~2.8 MB, limited data)
export NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb

# Option 2: Use the full database (~21.7 GB, gitignored)
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
# Start the web app
bun run web

# Run the test suite
bun run test:unit
NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb bun --filter data test
```

## Project Structure

```text
bballgenius/
├── packages/
│   ├── web/             # TanStack Start + React UI
│   │   └── src/
│   │       ├── routes/  # game-center, time-machine, sql-sandbox, chat, api/
│   │       └── components/
│   └── data/            # DuckDB, tab queries, LangGraph agent
│       └── src/
│           ├── core/    # DB connection, types, errors
│           ├── shared/  # Formatters, theme, dbPath
│           └── tabs/    # gameCenter, timeMachine, sqlSandbox, chatbot
├── scripts/             # CI guards, fixture builder, BBR crawl, smoke tests
├── data/
│   └── fixtures/        # CI DuckDB fixture (~2.8 MB, committed)
├── docs/                # Architecture and agent docs
├── .github/             # CI workflows, issue/PR templates
├── biome.json           # Linter + formatter config
└── lefthook.yml         # Pre-commit hooks
```

### Package Boundaries

- **`packages/web`** imports from the `data` workspace package (`import ... from 'data/tabs/...'`). Do not use relative paths into `packages/data/src/`.
- **`packages/data`** tab modules must not import sibling tabs — only from `core/`, `shared/`, and their own tab folder.
- **Root scripts** (`scripts/eval/*`) import chatbot internals via `packages/data/src/tabs/chatbot/...`.

## Development Workflow

### Running the Apps

```bash
bun run web              # Web dev server
bun run build:web        # Production build
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
bun run typecheck            # Data package check
bun run typecheck:scripts    # Root eval/DB scripts
bun --filter web typecheck   # Web package
```

For a single file:

```bash
bunx tsc --noEmit packages/data/src/tabs/chatbot/agent/graph.ts
```

## Coding Standards

### Formatting (Biome)

- 2-space indentation, single quotes, semicolons
- 100-character line width
- `organizeImports` enabled

### TypeScript

- Strict mode enabled globally
- No `any` types (enforced by Biome)
- No untyped `let` (enforced by Biome)
- Use `import type` / `export type` for type-only imports/exports
- Prefer `const` over `let`
- Use `===` over `==`

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Variables, functions | `camelCase` | `selectedGameIdx`, `getChatbotGraph` |
| Types, classes | `PascalCase` | `ChatbotState`, `GameCenterQueries` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_SQL_RETRIES`, `DEFAULT_DB_PATH` |
| DB tables/columns | `snake_case` | `dim_game`, `player_id` |

### Import Organization

- Use relative paths with `.js` extension in `packages/data` (e.g. `import { initDb } from './db.js'`)
- Web package uses workspace imports from `data` (e.g. `import { resolveDbPath } from 'data/dbPath'`)
- Order: Node built-ins → third-party → relative local / workspace
- Biome auto-organizes imports on save/commit

### Adding a Web Feature

1. Add or extend SQL/queries in `packages/data/src/tabs/<area>/`.
2. Export from `packages/data/package.json` if not already exported.
3. Create or update a route under `packages/web/src/routes/`.

### Adding Chatbot Features

1. **New tool**: Add to `packages/data/src/tabs/chatbot/agent/tools.ts` → bind in `graph.ts`
2. **Graph node**: Add to `buildGraph()` in `graph.ts` → wire edges
3. **State field**: Add to `ChatbotState` in `state.ts` only if a graph node reads/writes it
4. **Tests**: Add to `packages/data/src/tabs/chatbot/__tests__/`; use `mock.module()` for `@langchain/openai` and `../db.js`

## Testing

### Test Layers

| Layer | Command | Requires DB |
|-------|---------|-------------|
| Shared unit (formatters) | `bun run test:unit` | No |
| Data package | `bun --filter data test` | CI fixture |
| Full typecheck | `bun run typecheck` | No |
| Lint | `bun run lint` | No |
| Audit | `bun run audit` | No |

Always pass `--concurrency=1` for DuckDB test suites.

### Running Tests

```bash
# All data package tests on CI fixture
NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb bun --filter data test

# Single test file
bun test packages/data/src/tabs/chatbot/__tests__/processQuestion.test.ts --concurrency=1

# Full local CI equivalent
bun run ci
```

### Writing Tests

- Data package tests: `packages/data/src/**/__tests__/` — mock `@langchain/openai` and `../db.js` with `mock.module()`
- Never use `.only(` or `.skip(` — CI guards block them under `packages/`

## Submitting Changes

### Before Opening a PR

1. Run the full local CI suite:

   ```bash
   bun run ci
   ```

2. Ensure no Biome warnings or unformatted files
3. Update `AGENTS.md` if architecture or commands changed

### PR Checklist

- [ ] All CI checks pass
- [ ] No `.only(` / `.skip(` in test files
- [ ] No `any` types or untyped `let`
- [ ] No cross-tab imports in `packages/data`
- [ ] `AGENTS.md` updated if needed

### PR Process

1. Fork the repository and create a feature branch from `main`
2. Make your changes following the coding standards above
3. Open a pull request using the PR template
4. Address review feedback
5. Ensure all CI checks pass

## Architecture

See [docs/architecture.md](architecture.md) for detailed architecture diagrams and data flow.

### Quick Reference

**Web**: `packages/web/src/routes/*` → `data` package exports → DuckDB

**Chatbot**: Web chat route / CopilotKit API → LangGraph (`llm` → `tools` → `sql_critic` → `llm`) → DuckDB + OpenRouter

### Key Files

| File | Purpose |
|------|---------|
| `packages/data/src/shared/dbPath.ts` | Shared DB path resolution |
| `packages/data/src/core/db.ts` | Hub DuckDB connection |
| `packages/data/src/tabs/chatbot/agent/graph.ts` | LangGraph agent definition |
| `packages/data/src/tabs/chatbot/agent/tools.ts` | DuckDB tools for the agent |
| `packages/data/src/tabs/chatbot/agent/streaming.ts` | Token streaming |
| `packages/data/src/tabs/chatbot/utils/sql.ts` | SQL validation and extraction |
| `packages/web/src/routes/api/copilotkit.ts` | Server-side chat API |

## Questions?

Open a [GitHub Discussion](https://github.com/nickth3man/bballgenius/discussions) or issue.
