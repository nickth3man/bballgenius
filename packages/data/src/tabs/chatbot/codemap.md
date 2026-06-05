# packages/data/src/tabs/chatbot/

## Responsibility

Entry point and shared dependencies for the BBallGenius **LangGraph chatbot agent**. This package-level folder owns:

- **DuckDB singleton** (`db.ts`) — read-only connection, query execution, schema introspection with caching. All agent tools and the system prompt builder go through this module.
- **Runtime prompt construction** (`systemPrompt.ts`) — queries live schema at invocation time to inject table/column metadata into the LLM prompt.
- **Model selection state** (`openrouter.ts`) — OpenRouter model ID management, model listing with TTL cache.
- **Three child subsystems**, each with its own `codemap.md`:

| Subsystem | Path | Role |
|-----------|------|------|
| `agent/` | `./agent/` | LangGraph state graph (single-agent worker + multi-agent orchestrator), streaming, tools, schema discovery |
| `utils/` | `./utils/` | SQL validation/extraction/execution, retry with backoff, metrics, correlation, formatting helpers |
| `eval/` | `./eval/` | 100 NBA test queries, ground-truth assertions, BBR truth parser, matrix/iterate harnesses |

This folder does **not** contain a top-level barrel (`index.ts`). Consumers import directly from `db.js`, `systemPrompt.js`, `openrouter.js`, or from the child `agent/index.js`, `utils/index.js`, `eval/index.js` barrels.

## Design

### DuckDB Singleton (`db.ts`)

- Lazy singleton pattern: `initDb()` returns a cached `DuckDBConnection` (or a pending promise for concurrent first-callers).
- Connection is `READ_ONLY` via `DuckDBInstance.fromCache()`.
- `search_path` is set to `unified_star,main` (silently skipped if the CI fixture lacks schemas).
- Schema results are memoized: `tableRefsCache` (all tables/views) and `columnsCache` (per-qualified-table). `invalidateSchemaCache()` clears both.
- `getTableRefs()` and `getColumns()` are the schema-introspection primitives consumed by the tools and system prompt.
- Table names are qualified: `main`-schema tables drop the prefix (e.g., `dim_player` not `main.dim_player`); other schemas use `schema.table`.

### System Prompt (`systemPrompt.ts`)

- `buildSystemPrompt()` is an `async` function — it calls `getTableRefs()` and `getColumns()` at every invocation to embed the current schema into the prompt.
- Organizes output in sections: source priority, tool descriptions, chain stages, canonical database guidance, SQL cookbook (career stats, awards, playoffs, shot charts, etc.), full schema listing, and core-table column details (truncated to `DETAILED_COLUMN_LIMIT` columns per table).
- `discoverCoreTables()` finds tables matching `CORE_TABLE_PATTERNS` across schemas in `SCHEMA_PRIORITY` order.

### Model Selection (`openrouter.ts`)

- `getModel()` / `setModel()` — wraps `process.env.MODEL` (default `openai/gpt-oss-120b`).
- `fetchModels()` — calls OpenRouter `/api/v1/models` with 5-minute in-memory cache; returns empty array if no API key is set.

### Architecture

```
┌──────────────────────────────────────────┐
│  db.ts (DuckDB singleton)                │
│  openrouter.ts (model selection)         │
│  systemPrompt.ts (dynamic prompt)        │
├──────────────────────────────────────────┤
│  agent/  (LangGraph graphs, streaming)   │
│  utils/  (SQL, retry, metrics, fmt)      │
│  eval/   (test queries, truth, harness)  │
└──────────────────────────────────────────┘
```

## Flow

1. **Web route** (`packages/web/src/routes/api/copilotkit.ts`) calls `streamQuery()` from `agent/streaming.js`.
2. `streamQuery()` resolves `getChatbotGraph()` from `agent/graph.js`, which returns either:
   - **Multi-agent orchestrator** (default): `orch_plan` → parallel `orch_worker` × N → `orch_synthesize`
   - **Single-agent worker** (`CHATBOT_ORCHESTRATION=0`): `prepare_turn` → `classify_intent` → `inject_schema` → `llm` ↔ `tools` → `validate_answer` → `finalize_turn`
3. Both graphs use `db.ts` for runtime queries and `systemPrompt.ts` for the initial system message.
4. Graph nodes call `createModel()` from `agent/model.js` (ChatOpenAI → OpenRouter).
5. Tools (`agent/tools.js`) invoke `utils/sql.js` for validation, retry, and formatting.
6. `utils/metrics.js`, `utils/correlation.js`, `utils/errorCapture.js` instrument every turn.
7. Eval harnesses (`eval/`) replay the 100-question suite against real or mocked graph execution.

## Integration

- **Consumed by:** `packages/web/src/routes/api/copilotkit.ts` (chat endpoint), eval scripts (`scripts/eval/chatbot-smoke.ts`, `scripts/eval/iterate-questions.ts`).
- **Consumes from `../../shared/`:** `resolveDbPath` (used by `db.ts` for CI-safe DB path resolution).
- **Consumes from `../../core/`:** Type-only (`DbRow`, `SqlParam` from `core/types.js`).
- **DB dependency:** `data/nba.duckdb` (or `data/fixtures/nba.ci.duckdb` in CI) — no other runtime service.
- **External API:** OpenRouter HTTPS endpoint (`https://openrouter.ai/api/v1`).
- **Child subsystem codemaps:**
  - `agent/codemap.md` — Graph structure, node wiring, orchestrator lifecycle, tool definitions.
  - `utils/codemap.md` — SQL pipeline details, retry strategy, correlation, metrics.
  - `eval/codemap.md` — Question matrix, truth data sources, harness execution.

### Key Exports (no barrel at this level)

| Symbol | Source | Used By |
|--------|--------|---------|
| `initDb`, `query`, `getTables`, `getTableRefs`, `getColumns` | `db.ts` | `agent/tools.ts`, `systemPrompt.ts`, eval harnesses |
| `buildSystemPrompt` | `systemPrompt.ts` | `agent/graph.ts`, `agent/orchestrator.ts` |
| `getModel`, `setModel`, `fetchModels` | `openrouter.ts` | `agent/model.ts`, `agent/graph.ts`, `agent/streaming.ts` |
