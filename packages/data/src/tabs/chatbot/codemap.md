# `packages/data/src/tabs/chatbot/`

## Responsibility
**Chatbot Tab Root** — Container module for the LangGraph-powered NBA chatbot agent. Owns its own DuckDB connection (separate from the main `core/db.ts` singleton), OpenRouter model configuration, and the system prompt builder. Orchestrated via subdirectories: `agent/` (LangGraph graph + tools + streaming), `utils/` (SQL pipeline + metrics + formatting), and `eval/` (evaluation suite).

## Design

### Files at this level

| File | Responsibility |
|------|---------------|
| `db.ts` | Chatbot-specific DuckDB connection + schema introspection |
| `openrouter.ts` | Model name management + OpenRouter model listing |
| `systemPrompt.ts` | Dynamic system prompt builder with schema context |
| `agent/` | LangGraph graph, orchestrator, tools, streaming |
| `utils/` | SQL pipeline, retry, metrics, formatting |
| `eval/` | Eval suite (100 queries, question matrix, harness) |

### Chatbot DuckDB (`db.ts`)

Separate connection from `core/db.ts` — the chatbot operates its own DuckDB singleton for isolation. Uses the same lazy-singleton pattern with cached promise. Key differences from `core/db.ts`:

- Extended introspection: `getTableRefs()` returns `TableRef[]` with `{ schema, name, type, qualifiedName }` for all non-system schemas
- Schema cache: `tableRefsCache` + `columnsCache` with `invalidateSchemaCache()` to reset
- `getTables()` returns `qualifiedName` strings (main-schema tables omit the `main.` prefix via `qualifyTableName()`)
- `getColumns(table)` caches results by table name; supports both `schema.table` and bare `table` (defaults to `main` schema)

### OpenRouter (`openrouter.ts`)
- **Singleton model state** — `currentModel` (default `deepseek/deepseek-r1`), accessed via `getModel()` / `setModel()`
- **Model discovery** — `fetchModels()` queries the OpenRouter API (`/api/v1/models`) with 5-minute TTL cache
- `ModelInfo` type: `{ id, name }`

### System Prompt (`systemPrompt.ts`)
Dynamically generated prompt via `buildSystemPrompt()`:
1. Discovers core tables from `CORE_TABLE_PATTERNS` by checking across `SCHEMA_PRIORITY`
2. Fetches column metadata for each discovered table (up to 24 columns)
3. Lists ALL schemas and their tables
4. Assembles comprehensive prompt with:
   - Critical rules (no raw SQL in answers, anti-hallucination, ambiguity handling)
   - Available tools with usage guidance
   - Source priority (6-level: unified_star > main > stg_bref > nbadb > raw > audit)
   - SQL cookbook with working examples (career totals, award queries, playoff queries, shot charts, triple-doubles)
   - Schema listings and core table columns
   - Data-not-in-database warnings

## Integration

### Consumed by
- `agent/model.ts` — imports `getModel()` for model selection
- `agent/graph.ts` — imports `getModel()` for error metadata
- `agent/orchestrator.ts` — imports `buildSystemPrompt()` for worker base prompt
- `agent/streaming.ts` — imports `getModel()` for metadata
- `agent/tools.ts` — imports `query`, `getTableRefs`, `getColumns` from `db.ts`
- `agent/schemaCatalog.ts` — imports `getTableRefs` from `db.ts`
- `eval/matrixHarness.ts` — imports `initDb`, `closeDb` from `db.ts`, imports `getModel` and `buildSystemPrompt`

### Exported via package.json subpath exports
- `data/tabs/chatbot/system-prompt` → `./src/tabs/chatbot/systemPrompt.ts`
- `data/tabs/chatbot/db` → `./src/tabs/chatbot/db.ts`
- `data/tabs/chatbot/openrouter` → `./src/tabs/chatbot/openrouter.ts`
- `data/tabs/chatbot/agent` → `./src/tabs/chatbot/agent/index.ts`
- `data/tabs/chatbot/utils` → `./src/tabs/chatbot/utils/index.ts`
- `data/tabs/chatbot/eval` → `./src/tabs/chatbot/eval/index.ts`
