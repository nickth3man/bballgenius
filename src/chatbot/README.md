# BBallGenius Chatbot

Terminal NBA analytics chatbot powered by OpenTUI, LangGraph, DuckDB, and OpenRouter.

The chatbot turns natural-language NBA questions into safe DuckDB tool calls, streams responses in a terminal UI, and uses a SQL critic loop to recover from schema/syntax mistakes.

## Quick Start

```bash
OPENROUTER_API_KEY=... bun run chatbot:start
```

Optional model override:

```bash
MODEL=openai/gpt-oss-120b OPENROUTER_API_KEY=... bun run chatbot:start
```

## Architecture

```text
OpenTUI chatApp.ts
  -> streamQuery()
  -> LangGraph StateGraph
       START -> llm -> tools? -> sql_critic -> llm -> END
```

Graph nodes:

| Node | Purpose |
|------|---------|
| `llm` | Calls OpenRouter model with bound tools |
| `tools` | Runs `ToolNode([queryNbaDb, getSchemaInfo])` |
| `sql_critic` | Detects SQL/tool errors and routes back to `llm` up to `MAX_SQL_RETRIES=3` |

State:

| Field | Purpose |
|-------|---------|
| `messages` | LangGraph message history via `MessagesValue` |
| `sqlRetryCount` | Current SQL correction retry count |

## Tools

| Tool | Description |
|------|-------------|
| `query_nba_db` | Executes read-only DuckDB SQL after read-only and schema validation |
| `get_schema_info` | Finds matching tables and returns column metadata |

SQL safety layers:

1. `validateReadOnlySql()` blocks writes, DDL, external access functions, and multi-statement SQL.
2. `validateSchemaReferences()` checks table references against `information_schema` before execution.
3. `withRetry()` retries transient database failures.
4. `formatErrorForLLM()` emits centralized `ERROR_PREFIX` messages consumed by `sql_critic`.

## Module Map

```text
src/chatbot/
├── index.ts              # TUI bootstrap
├── chatApp.ts            # Chat UI controller, streaming display, metrics, model selector
├── db.ts                 # DuckDB singleton and schema introspection
├── openrouter.ts         # Model selection and OpenRouter model list
├── systemPrompt.ts       # Dynamic schema-aware system prompt
├── agent/
│   ├── graph.ts          # LangGraph StateGraph and sql_critic routing
│   ├── model.ts          # ChatOpenAI configured for OpenRouter
│   ├── state.ts          # ChatbotState: messages + sqlRetryCount
│   ├── streaming.ts      # streamQuery() AsyncGenerator
│   └── tools.ts          # query_nba_db + get_schema_info
├── features/
│   └── modelSelector.ts  # @ / Ctrl+P model picker overlay
├── utils/
│   ├── ansi.ts           # ANSI -> StyledText conversion
│   ├── metrics.ts        # NDJSON metrics logger
│   ├── retry.ts          # Error classification and retry helpers
│   ├── sql.ts            # SQL validation/extraction/execution/formatting
│   └── theme.ts          # Chatbot color palette
├── eval/
│   └── nba-100-queries.ts
└── __tests__/
    ├── ansi.test.ts
    ├── executeSql.test.ts
    ├── formatResults.test.ts
    ├── processQuestion.test.ts
    ├── retry.test.ts
    ├── sqlExtraction.test.ts
    ├── streaming.test.ts
    └── systemPrompt.test.ts
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key for live model calls | required for app/smoke |
| `MODEL` | OpenRouter model id | `openai/gpt-oss-120b` |
| `NBA_DUCKDB_PATH` | DuckDB path override | `data/nba.duckdb` |
| `NBA_HONORS_DUCKDB_PATH` | Optional honors DB for hub honors overlay | unset |
| `CHATBOT_DEBUG` | Log stream events, graph transitions, and SQL to stderr | `false` |
| `CHATBOT_PERSIST_DIR` | Enables `SqliteSaver` checkpoints | unset (`MemorySaver`) |
| `CHATBOT_METRICS_DIR` | Directory for `chatbot-metrics.ndjson` | `data/` |
| `LANGSMITH_TRACING` | Enable LangSmith tracing | unset |
| `LANGSMITH_API_KEY` | LangSmith API key | unset |

## Key Bindings

| Key | Action |
|-----|--------|
| `Enter` | Send question |
| `Tab` / `Shift+Tab` | Cycle scroll/input focus |
| `@` / `Ctrl+P` | Open model selector |
| `Esc` | Quit |

## Testing

Run all chatbot tests:

```bash
bun run test:chatbot
```

Run strict chatbot typecheck:

```bash
bun run typecheck:chatbot
```

Run live smoke tests with OpenRouter:

```bash
OPENROUTER_API_KEY=... bun run chatbot:smoke
OPENROUTER_API_KEY=... bun run chatbot:smoke:100
```

Test coverage by file:

| File | Focus |
|------|-------|
| `processQuestion.test.ts` | Graph behavior, tool calls, SQL critic retry loop, conversation state |
| `executeSql.test.ts` | SQL validation, read-only enforcement, schema errors, injection vectors |
| `sqlExtraction.test.ts` | SQL extraction from markdown and leaked control-channel text |
| `formatResults.test.ts` | Pretty table formatting and row truncation |
| `systemPrompt.test.ts` | Dynamic schema-aware prompt content |
| `ansi.test.ts` | ANSI conversion into OpenTUI `StyledText` |
| `retry.test.ts` | Error categorization, retry behavior, LLM-facing error prefixes |
| `streaming.test.ts` | `streamQuery()` token/tool/usage/done/error events |

All tests use `--concurrency=1` because DuckDB connections and graph mocks are shared process resources.

## Type Safety and Linting

Chatbot code has a stricter TypeScript config than the full repo:

```bash
bun run typecheck          # full repo
bun run typecheck:chatbot  # chatbot + shared, stricter options
```

`tsconfig.chatbot.json` enables:

- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `noPropertyAccessFromIndexSignature`
- `noImplicitReturns`
- `noImplicitOverride`
- `noFallthroughCasesInSwitch`
- `noUnusedLocals`
- `noUnusedParameters`
- `verbatimModuleSyntax`

Practical rules:

- Use `process.env['NAME']`, not `process.env.NAME`.
- Use `record['key']` for dynamic records.
- Add guards/defaults for indexed access instead of weakening types.
- Keep `ChatbotState` minimal. Add fields only when a graph node reads/writes them.
- Use `import type` / `export type` when importing/exporting types only.

Biome is configured with strict linting and import organization. Lefthook runs Biome on staged TypeScript/JSON files before commits.

## Observability

### Debug Logging

Set `CHATBOT_DEBUG=true` to log:

- Graph state transitions
- Stream events
- SQL queries and timestamps
- Completion/error metadata

### Metrics

Metrics are appended to `{CHATBOT_METRICS_DIR}/chatbot-metrics.ndjson`.

Each line includes `timestamp`, `threadId`, `question`, `model`, `durationMs`, `toolCalls`, token counts, SQL queries, complexity heuristics, and success/error state.

Example:

```bash
# View recent entries
Get-Content data/chatbot-metrics.ndjson -Tail 5
```

### LangSmith

Set `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` to enable LangGraph/LangChain tracing.

## Adding Features

### Add a Tool

1. Define the tool in `agent/tools.ts` with `tool()` and a `zod/v4` schema.
2. Add it to `bindTools([...])` and `ToolNode([...])` in `agent/graph.ts`.
3. Update the system prompt if the model needs guidance.
4. Handle relevant tool events in `chatApp.ts` if display behavior changes.
5. Add tests in `__tests__/processQuestion.test.ts` or a focused test file.
6. Run `bun run typecheck:chatbot` and `bun run test:chatbot`.

### Add a Graph Node

1. Define an async node that accepts `ChatbotStateType`.
2. Return `Partial<ChatbotStateType>` for state updates or `Command({ goto, update })` for routing.
3. Add the node and edges in `agent/graph.ts`.
4. Add state fields only if the node reads/writes them.
5. Add graph tests and run strict typecheck/tests.

## CI

The root CI workflow runs a dedicated chatbot job:

```bash
bun run typecheck:chatbot
bun test src/chatbot/__tests__ --concurrency=1
```

`scripts/ci-guards.sh` blocks `.only(` and `.skip(` in `src/chatbot/__tests__/`.
