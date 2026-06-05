# BBallGenius

[![CI](https://github.com/nickth3man/bballgenius/actions/workflows/ci.yml/badge.svg)](https://github.com/nickth3man/bballgenius/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-1.3.6+-000000?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript)](https://www.typescriptlang.org/)

BBallGenius is a Bun workspace monorepo for NBA analytics — a React web app (Game Center, Career Time-Machine, SQL Sandbox, Chat) backed by a local DuckDB warehouse and a LangGraph conversational agent. Application code lives in `packages/web` and `packages/data`; database paths resolve via `packages/data/src/shared/dbPath.ts`.

## Requirements

- Bun `1.3.6+` (see `packageManager` in `package.json`)
- `data/nba.duckdb` for full local data (~21.7 GB, gitignored)
- `OPENROUTER_API_KEY` for live chatbot model calls and smoke tests

The committed CI fixture `data/fixtures/nba.ci.duckdb` is used for automated tests and local fixture-based runs.

## Quick Start

```bash
git clone https://github.com/nickth3man/bballgenius.git
cd bballgenius
bun install

# Start the web app (http://localhost:3000 by default)
bun run web
```

By default, the app looks for `data/nba.duckdb`. Set `NBA_DUCKDB_PATH` to override the database path.

## Web App

| Route | Purpose |
|-------|---------|
| `/game-center` | Recent games, box scores, player shot charts |
| `/time-machine` | Player/team search, BBR mirror views, dossiers, honors |
| `/sql-sandbox` | Schema browser and ad-hoc DuckDB query editor |
| `/chat` | LangGraph conversational NBA agent with DuckDB tools |

```bash
bun run web          # Dev server
bun run build:web    # Production build
```

### Chatbot

The chatbot is a LangGraph ReAct graph exposed through the web chat route and CopilotKit API:

```text
START -> classify_intent -> llm -> tools? -> sql_critic -> llm -> END
```

| Tool | Purpose |
|------|---------|
| `query_nba_db` | Execute read-only DuckDB SQL with schema pre-validation |
| `get_schema_info` | Discover tables and columns before writing SQL |

## Data Quality & Accuracy

The repo uses a **three-tier DQ system**:

1. **Internal Consistency** (`bun run dq`) — Uniqueness, referential integrity, validity checks
2. **Cross-Source Reconciliation** (`bun run dq:accuracy`) — BBR ↔ NBA-API merge and discrepancy classification
3. **Fact-Check Verification** (`bun run accuracy:full`) — Firecrawl-backed external truth validation

Quick start:

```bash
bun run dq:gate          # Internal consistency gate (HIGH+ severity)
bun run dq:accuracy      # Cross-source reconciliation pipeline
bun run accuracy:full    # Refresh + verify Firecrawl fact-checks
```

See [AGENTS.md](./AGENTS.md#data-warehouse-schema--data-quality) for full documentation.

## Database Setup

Database paths are resolved by `packages/data/src/shared/dbPath.ts`:

| Priority | Path | When |
|----------|------|------|
| 1 | `process.env['NBA_DUCKDB_PATH']` | Explicit override |
| 2 | `data/fixtures/nba.ci.duckdb` | `CI=true` or `GITHUB_ACTIONS=true` and fixture exists |
| 3 | `data/nba.duckdb` | Default local database |

Create the data directory and place the full database locally:

```bash
mkdir -p data
# copy/build nba.duckdb into data/nba.duckdb
```

Typical source: build from the [`wyattowalsh/nbadb`](https://github.com/wyattowalsh/nbadb) pipeline (local fork: [`nickth3man/nbadb`](https://github.com/nickth3man/nbadb)) or another compatible DuckDB dataset. Public star-schema contract: [nbadb.w4w.dev](https://nbadb.w4w.dev/docs/schema).

### Optional Honors Database

Some local `nba.duckdb` builds have incomplete accolades. Point `NBA_HONORS_DUCKDB_PATH` at a separate DuckDB that exposes `v_player_honors_full`:

```bash
export NBA_DUCKDB_PATH="data/nba.duckdb"
export NBA_HONORS_DUCKDB_PATH="../basketball-data/duckdb/nba.duckdb"
bun run web
```

## Project Layout

```text
.
├── packages/
│   ├── web/               # TanStack Start + React UI
│   └── data/              # DuckDB, queries, LangGraph agent
├── data/
│   ├── fixtures/nba.ci.duckdb
│   └── nba.duckdb         # local only, gitignored
├── scripts/               # CI, DQ, eval, BBR crawl
├── biome.json
├── tsconfig.scripts.json
└── lefthook.yml
```

## Scripts

| Command | Description |
|---------|-------------|
| `bun run web` | Start web dev server |
| `bun run build:web` | Production web build |
| `bun run test:unit` | Formatter tests, no DB |
| `bun run data:test` | Full data package test suite |
| `bun run typecheck` | Data package TypeScript check |
| `bun run lint` | Biome CI with `--error-on-warnings` |
| `bun run lint:fix` | Biome check/write on `packages` and `scripts` |
| `bun run chatbot:smoke` | Fact-checked live chatbot smoke test |
| `bun run chatbot:smoke:100` | Full 100-query live smoke suite |
| `bun run fixture:build` | Rebuild the CI DuckDB fixture from full local DB |
| `bun run ci` | Local PR-style CI bundle |

Always use `--concurrency=1` for DuckDB test suites.

## Linting, Formatting, and Type Safety

- Biome formats with 2 spaces, single quotes, semicolons, and line width 100.
- CI and `bun run lint` use `--error-on-warnings`.
- Lefthook runs `bunx biome check --write` on staged TypeScript/JSON files before commits.

## Testing

| Layer | Command |
|-------|---------|
| Shared unit | `bun run test:unit` |
| Data package | `NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb bun --filter data test` |
| Full typecheck | `bun run typecheck` |
| Lint | `bun run lint` |
| Audit | `bun run audit` |

Run the closest local equivalent before pushing:

```bash
bun run lint
bun run typecheck
bun run test:unit
bun --filter data test
bun run audit
```

## CI

GitHub Actions workflow: `.github/workflows/ci.yml`.

Jobs: guards, lint, format, typecheck, typecheck-scripts, data-tests, dq-fixture, audit, docs.

## BBR Mirror

Basketball-Reference mirroring uses Firecrawl and writes gitignored assets under `.firecrawl/` and `bbr-screenshots/`.

```bash
bun run bbr:map
bun run bbr:crawl
bun run bbr:verify
```

Run `bbr:map` before `bbr:crawl`. Do not run map and crawl simultaneously because they share API quota.

## Common Pitfalls

- Do not commit `data/nba.duckdb`, `bbr-screenshots/`, `.firecrawl/bbr-map-full.txt`, or DuckDB WAL files.
- Do not commit `.only(` or `.skip(` in tests; CI blocks them.
- Do not import sibling tab modules across `packages/data/src/tabs/` boundaries.

## Related Projects

- [`wyattowalsh/nbadb`](https://github.com/wyattowalsh/nbadb) — upstream NBA data extraction and DuckDB build pipeline ([fork](https://github.com/nickth3man/nbadb)); schema docs at [nbadb.w4w.dev](https://nbadb.w4w.dev)
- [`langchain-ai/langgraph`](https://github.com/langchain-ai/langgraph) — Agent graph runtime
- [`TanStack/router`](https://github.com/TanStack/router) — Web routing and SSR

## Contributing

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for development setup, coding standards, and PR process.

## License

[MIT](docs/LICENSE)
