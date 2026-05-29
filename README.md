# BBallGenius

[![CI](https://github.com/nickth3man/bballgenius/actions/workflows/ci.yml/badge.svg)](https://github.com/nickth3man/bballgenius/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-1.3.6+-000000?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript)](https://www.typescriptlang.org/)

BBallGenius is a Bun monorepo for terminal-first NBA analysis — a keyboard-driven OpenTUI analytics hub (Game Center, Career Time-Machine, SQL Sandbox) with an integrated LangGraph conversational chatbot tab. All code lives under `src/` and queries a local DuckDB file via `src/shared/dbPath.ts`.

## Requirements

- Bun `1.3.6+` (see `packageManager` in `package.json`)
- A terminal with ANSI color support
- `data/nba.duckdb` for full local data (~1.5 GB, gitignored)
- `OPENROUTER_API_KEY` only for chatbot live model calls and smoke tests (chatbot is accessible via F4 within the hub)

The committed CI fixture `data/fixtures/nba.ci.duckdb` is used for automated tests and local fixture-based runs.

## Quick Start

```bash
git clone https://github.com/nickth3man/bballgenius.git
cd bballgenius
bun install

# Run the terminal analytics hub (all tabs, including chatbot via F4)
bun start
```

By default, the app looks for `data/nba.duckdb`. Set `NBA_DUCKDB_PATH` to override the database path.

### Hub

```bash
bun start
# or
bun run hub:start
```

Hub tabs:

| Tab | Shortcut | Purpose |
|-----|----------|---------|
| Game Center | `F1` / `1` | Recent games, box scores, player shot charts |
| Career Time-Machine | `F2` / `2` | Player/team search, BBR mirror views, dossiers, honors |
| SQL Sandbox | `F3` / `3` | Schema browser and ad-hoc DuckDB query editor |
| Chatbot | `F4` / `4` | LangGraph conversational NBA agent with DuckDB tools |

Global hub shortcuts: `Tab` / `Shift+Tab` cycle focus, `?` opens help, `Esc` blurs/closes/quits, `Ctrl+C` quits.

### Chatbot Tab (F4)

The chatbot is an OpenTUI chat interface backed by a LangGraph ReAct graph:

```text
START -> llm -> tools? -> sql_critic -> llm -> END
```

It exposes two tools to the model:

| Tool | Purpose |
|------|---------|
| `query_nba_db` | Execute read-only DuckDB SQL with schema pre-validation |
| `get_schema_info` | Discover tables and columns before writing SQL |

Chatbot keys: `Enter` sends, `Tab` / `Shift+Tab` cycles input and scroll focus, `@` / `Ctrl+P` opens model selector, `Esc` blurs input.

## Database Setup

Database paths are resolved by `src/shared/dbPath.ts`:

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

Typical source: build from the [`nickth3man/nbadb`](https://github.com/nickth3man/nbadb) pipeline or another compatible DuckDB dataset with tables such as `dim_player`, `dim_game`, `fact_player_game_boxscore`, and `fact_pbp_events`.

### Optional Honors Database

Some local `nba.duckdb` builds have incomplete accolades. Point `NBA_HONORS_DUCKDB_PATH` at a separate DuckDB that exposes `v_player_honors_full`:

```bash
export NBA_DUCKDB_PATH="data/nba.duckdb"
export NBA_HONORS_DUCKDB_PATH="../basketball-data/duckdb/nba.duckdb"
bun start
```

## Project Layout

```text
.
├── .github/workflows/ci.yml
├── data/
│   ├── fixtures/nba.ci.duckdb
│   └── nba.duckdb                # local only, gitignored
├── scripts/
├── src/
│   ├── index.ts
│   ├── core/
│   ├── shared/
│   ├── tabs/
│   │   ├── gameCenter/
│   │   ├── timeMachine/
│   │   ├── sqlSandbox/
│   │   └── chatbot/
│   │       ├── agent/
│   │       ├── features/
│   │       ├── utils/
│   │       ├── eval/
│   │       └── __tests__/
│   └── tests/
├── biome.json
├── tsconfig.json
└── lefthook.yml
```

## Scripts

| Command | Description |
|---------|-------------|
| `bun start` / `bun run hub:start` | Run the analytics hub (all tabs) |
| `bun run test:unit` | Hub formatter tests, no DB |
| `bun run test:regression` | Hub regression bundle |
| `bun run test:chatbot` | Chatbot test suite with `--concurrency=1` |
| `bun run typecheck` | Full repo TypeScript check |
| `bun run lint` | Biome CI with `--error-on-warnings` |
| `bun run lint:fix` | Biome check/write on `src` and `scripts` |
| `bun run ci:integration` | Hub integration suite on CI fixture |
| `bun run chatbot:smoke` | Fact-checked live chatbot smoke test |
| `bun run chatbot:smoke:100` | Full 100-query live smoke suite |
| `bun run fixture:build` | Rebuild the CI DuckDB fixture from full local DB |
| `bun run ci` | Local PR-style CI bundle |

Always use `--concurrency=1` for DuckDB/OpenTUI test suites.

## Linting, Formatting, and Type Safety

- Biome formats with 2 spaces, single quotes, semicolons, and line width 100.
- Biome `organizeImports` is enabled.
- CI and `bun run lint` use `--error-on-warnings`.
- Strict lint rules enforce unused imports/variables, `import type` / `export type`, `const` preference, template consistency, enum initializers, no explicit `any`, no untyped `let`, and `===` over `==`.
- Lefthook runs `bunx biome check --write` on staged TypeScript/JSON files before commits.

## Testing

| Layer | Command |
|-------|---------|
| Hub unit | `bun run test:unit` |
| Hub integration/regression | `NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb bun run ci:integration` |
| Chatbot tests | `bun run test:chatbot` |
| Full repo typecheck | `bun run typecheck` |
| Lint | `bun run lint` |
| Audit | `bun run audit` |

Chatbot tests cover graph behavior, SQL safety, SQL extraction, result formatting, system prompt building, ANSI conversion, retry/error classification, and streaming events.

## CI

GitHub Actions workflow: `.github/workflows/ci.yml`.

Jobs:

| Job | Purpose |
|-----|---------|
| guards | Block `.only` / `.skip`, snapshot updates in CI, sibling tab imports, Biome warnings |
| lint | Biome strict lint |
| format | Biome format check |
| typecheck | Full repo TypeScript check |
| unit | Hub DB-free unit tests |
| regression | Hub regression suite on CI fixture |
| integration | Hub full test suite on CI fixture |
| chatbot | Chatbot tests on CI fixture |
| audit | Moderate+ dependency audit |
| CI | Aggregate required status |
| integration-full | Manual full-database workflow |

Run the closest local equivalent before pushing:

```bash
bun run lint
bun run typecheck
bun run test:unit
bun run test:chatbot
bun run ci:integration
bun run audit
```

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
- Regenerate golden snapshots only against `data/fixtures/nba.ci.duckdb`.
- Do not import tab modules from sibling tabs or from chatbot to other tabs. Use `src/shared/` only for deliberate shared modules.

## Related Projects

- [`nickth3man/nbadb`](https://github.com/nickth3man/nbadb) — NBA data extraction and DuckDB build pipeline
- [`anomalyco/opentui`](https://github.com/anomalyco/opentui) — Terminal UI framework
- [`langchain-ai/langgraph`](https://github.com/langchain-ai/langgraph) — Agent graph runtime

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and PR process.

## License

[MIT](LICENSE)
