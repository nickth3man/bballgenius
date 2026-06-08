# `packages/data/`

## Responsibility
**Data Workspace Package** (`@bballgenius/data`) — The framework-agnostic NBA data and chatbot agent layer for the BBallGenius monorepo. Provides all database access, shared utilities, feature-area query modules, and the LangGraph-powered chatbot agent with its evaluation suite. This is a **Bun workspace package** (`"private": true`) consumed by `packages/web` and eval scripts.

## Design

### Package Configuration (`package.json`)

```
name: "data"
type: "module"          # ES modules throughout
private: true           # Not published to npm
main: "./src/index.ts"  # Default entry point
```

### Subpath Exports Map

The package exposes **13 subpath exports**, organized by module domain:

| Domain | Subpath | Source | Purpose |
|--------|---------|--------|---------|
| **Core** | `.` | `./src/index.ts` | Barrel: DB access, types, formatters, theme |
| | `./db` | `./src/core/db.ts` | DuckDB connection + query execution |
| | `./dbPath` | `./src/shared/dbPath.ts` | CI-safe DB path resolution |
| | `./errors` | `./src/shared/errors.ts` | Error message formatting |
| | `./sqlValidation` | `./src/shared/sqlValidation.ts` | Read-only SQL gate |
| | `./formatters` | `./src/shared/formatters.ts` | Table + shot chart formatting |
| | `./theme` | `./src/shared/theme.ts` | TokyoNight ANSI color system |
| **Tabs** | `./tabs/game-center/queries` | `./src/tabs/gameCenter/queries.ts` | Game Center data |
| | `./tabs/time-machine/queries` | `./src/tabs/timeMachine/queries.ts` | Player dossier + team data |
| | `./tabs/time-machine/group-awards` | `./src/tabs/timeMachine/groupAwards.ts` | Award grouping helper |
| | `./tabs/sql-sandbox/queries` | `./src/tabs/sqlSandbox/queries.ts` | Sandbox query execution |
| | `./tabs/sql-sandbox/autocomplete` | `./src/tabs/sqlSandbox/autocomplete.ts` | SQL autocomplete |
| | `./tabs/sql-sandbox/schema-browser` | `./src/tabs/sqlSandbox/schemaBrowser.ts` | Schema tree browser |
| **Chatbot** | `./tabs/chatbot/system-prompt` | `./src/tabs/chatbot/systemPrompt.ts` | Dynamic system prompt |
| | `./tabs/chatbot/db` | `./src/tabs/chatbot/db.ts` | Chatbot DuckDB access |
| | `./tabs/chatbot/openrouter` | `./src/tabs/chatbot/openrouter.ts` | OpenRouter model config |
| | `./tabs/chatbot/agent` | `./src/tabs/chatbot/agent/index.ts` | LangGraph graph + tools + streaming |
| | `./tabs/chatbot/utils` | `./src/tabs/chatbot/utils/index.ts` | SQL pipeline + metrics + formatting |
| | `./tabs/chatbot/eval` | `./src/tabs/chatbot/eval/index.ts` | Eval suite (100 queries, matrix) |

### Dependencies

**Runtime:**
- `@duckdb/node-api` + `@duckdb/node-bindings` — DuckDB Node.js bindings for database access
- `@langchain/core` — LangChain framework (messages, tools, models)
- `@langchain/langgraph` — StateGraph, Send, MemorySaver, StateSchema
- `@langchain/openai` — OpenAI chat model integration
- `@langchain/openrouter` — OpenRouter provider (ChatOpenRouter)
- `langchain` — LangChain ecosystem
- `zod` — Schema validation (v4) for tool inputs and state
- `cheerio` — HTML parsing for BBR player page scraping
- `openai`, `parse5`, `parse5-htmlparser2-tree-adapter` — Supporting libs
- `uuid` — UUID generation for run correlation

**Dev:**
- `@types/bun`, `bun-types` — Bun runtime types
- `typescript` — TypeScript compiler
- `langsmith` — LangChain observability

### Scripts
- `typecheck` — `tsc --noEmit -p tsconfig.json`
- `test` — `bun test src --concurrency=1` (DuckDB requires single-concurrency)

### Package Boundary Rules

Per project convention:
1. **`packages/web`** imports from `data` workspace exports using subpath imports (`import { ... } from 'data/tabs/...'`). It must not reach into `packages/data/src/` with relative paths.
2. **Tab modules** under `tabs/<tabId>/` must not import sibling tabs — only `core/*`, `shared/*`, and their own folder.
3. **Eval scripts** at repo root import chatbot internals via `packages/data/src/tabs/chatbot/...` (not via workspace alias).

## Integration

### Consumers
- **`packages/web`** — TanStack Start web app (Game Center, Time Machine, SQL Sandbox, Chat)
- **`scripts/eval/`** — Chatbot smoke tests and eval harnesses
- **`scripts/ci/`** — CI guard scripts that verify database fixture integrity

### Dependencies consumed from monorepo
- None — this package has no internal workspace dependencies; it depends only on npm packages and the DuckDB binary data files.
