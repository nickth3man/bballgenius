# packages/data/src/tabs/chatbot/utils/

## Responsibility

Shared utility layer for the LangGraph chatbot agent. Provides SQL safety validation/extraction/execution, retry with error categorization, structured metrics/telemetry, async-local correlation IDs, error capture, and terminal/stream formatting. All files are pure logic with zero graph-node dependencies.

## Design

| File | Exports | Role |
|------|---------|------|
| `sql.ts` | `validateReadOnlySql`, `extractSql`, `extractSqlFromMarkdown`, `validateSchemaReferences`, `checkSql`, `executeSql`, `formatResultsPretty` | SQL safety validation (blocks writes, multi-statement, external-access functions), extraction from LLM markdown output, schema-reference verification against live `getTables()`, and full execute pipeline with retry delegation |
| `retry.ts` | `withRetry`, `categorizeDbError`, `isRetryableError`, `formatErrorForUser`, `formatErrorForLLM`, `ERROR_PREFIX`, `RetryOptions` | Exponential-backoff retry wrapper; error classification into `transient`/`schema`/`syntax`/`permanent` via keyword heuristics; distinct error formatters for end-user vs. LLM re-prompt (prefixed strings the `sql_critic` node parses) |
| `correlation.ts` | `withRun`, `withRunContext`, `currentRun`, `updateRunContext`, `RunContext` | `AsyncLocalStorage`-based request-scoped context carrying `runId`, `turn`, `intent`, `model`. Used by metrics and error capture to correlate all events in a single chat turn |
| `metrics.ts` | `MetricsSession` class + module-level singletons (`startMetrics`, `recordToken`, `recordToolCall`, `recordToolEnd`, `recordError`, `recordUsage`, `recordChainStage`, `flushMetrics`, `getMetricsSession`, `getMetricsSummary`, `logMetric`) | Two NDJSON output streams: `chatbot-metrics.ndjson` (per-query `MetricsEntry` with duration, tool latencies, token counts, SQL complexity, success) and `chatbot-events.ndjson` (arbitrary structured events with `runId`/`turn`). `getMetricsSummary` aggregates across all entries. Configurable via `CHATBOT_LOG_LEVEL`, `CHATBOT_LOG_STDERR`, `CHATBOT_METRICS_DIR` |
| `errorCapture.ts` | `captureError`, `ErrorContext` | One-stop structured error capture: writes `level:error` event to NDJSON with `errName`, `errMessage`, `stack`, `sqlPreview` (truncated 500 chars), and optionally updates the in-memory `runId` on the async-local context |
| `tableFormatter.ts` | `formatResultsTable` | Converts `Record<string, unknown>[]` to an ASCII box-drawing table (Unicode `┌┬┐├┼┤└┴┘`). Auto-column-width, numeric right-alignment, 20-row cap with overflow notice |
| `markdown.ts` | `markdownToAnsi` | Converts markdown to ANSI escape sequences for terminal output. Handles code blocks (cyan), inline code, bold, headings, bullet lists, blockquotes, italic. Preserves `NO_COLOR` env var |
| `streamFormatting.ts` | `formatChainStageStatus`, `summarizeToolInput`, `summarizeToolOutput`, `formatToolStartBlock`, `formatToolEndBlock`, `truncateMiddle` | Maps internal `ChainStageName` enum to human-readable status strings; truncates tool inputs/outputs with center-ellipsis for compact streaming UI |
| `spinner.ts` | `SPINNER_FRAMES`, `getSpinnerFrame` | Braille spinner frame sequence for terminal progress indication |
| `theme.ts` | `dimOrPlain`, `statusText`, `bold`, `label`, `youLabel`, `aiLabel`, `sqlLabel`, `errorLabel` | Re-exports `Theme`/`isNoColor` from `shared/theme` and adds convenience ANSI wrappers for chatbot-specific labels |
| `index.ts` | — | Barrel re-export of all public modules except `correlation` and `errorCapture` (consumed internally by `metrics`). |

### Key Patterns

- **No cross-tab imports**: Utilities never import sibling chatbot modules (agent, db, systemPrompt). Only `sql.ts` imports `../db.js` for `getTables()`/`query()` and `retry.ts`/`tableFormatter.ts` for error/result formatting.
- **Singleton metrics session**: `MetricsSession` is instantiated once as `defaultSession`; module-level functions delegate to it. `getMetricsSession()` allows graph code to access the singleton directly.
- **Structured NDJSON logging**: Both metrics and events land in `data/` (configurable via `CHATBOT_METRICS_DIR`) as append-only NDJSON. Events carry required `runId`/`turn` from async-local context.
- **Error prefix contract**: `ERROR_PREFIX` constants are the shared protocol between utility error formatters and the `sql_critic` graph node. The node checks whether tool output starts with a known prefix to decide retry vs. proceed.

## Flow

```
LLM output ──► extractSql() ──► validateReadOnlySql() ──► validateSchemaReferences()
                                       │                         │
                              [blocks writes]           [checks table existence]
                                       ▼                         ▼
                                 checkSql() ──► "OK:" or error prefix
                                       │
                                       ▼
                               executeSql()
                                       │
                              withRetry() ──► query() (DB)
                                       │
                              ┌────────┴────────┐
                              ▼                  ▼
                     formatResultsTable()   formatErrorForLLM()
                     (tableFormatter.ts)    (retry.ts) ──► ERROR_PREFIX.*
                                                   │
                              MetricsSession singleton:
                              recordToolCall / recordToolEnd / recordToken /
                              recordUsage / recordChainStage / recordError
                                       │
                              flush() ──► chatbot-metrics.ndjson
                              logMetric() ──► chatbot-events.ndjson
                                       │
                              captureError() ──► chatbot-events.ndjson (level:error)

Streaming UI path:
  formatChainStageStatus(stage) ──► human status string
  formatToolStartBlock(name, input) ──► ["Tool X started", "SQL: ..."]
  formatToolEndBlock(name, output, ms) ──► ["Tool X completed in Nms", "Result: ..."]
```

## Integration

- **Graph nodes** (`graph.ts`, `tools.ts`) import `executeSql`, `checkSql`, `extractSql` from this folder to safely run LLM-generated SQL and validate it before execution.
- **sql_critic node** reads `ERROR_PREFIX` strings in tool output to decide whether the LLM should retry with corrected SQL.
- **Streaming module** (`streaming.ts`) uses `formatChainStageStatus`, `summarizeToolInput`/`summarizeToolOutput`, `formatToolStartBlock`/`formatToolEndBlock` to produce human-readable streaming event text for the web UI.
- **Tool implementations** (`tools.ts`) call `captureError` and the `MetricsSession` singleton (`recordToolCall`, `recordToolEnd`) to instrument each tool invocation.
- **Graph entry point** (`processQuestion.ts`) calls `withRun` from `correlation.ts` to scope each chat turn, and `startMetrics`/`flushMetrics` on the session.
- **System prompt** (`systemPrompt.ts`) references the SQL retry/prefix contract implicitly: the prompt instructs the LLM to fix errors when it sees error-prefixed messages.
- **External consumers**: Eval scripts (`scripts/eval/`) import `markdownToAnsi` and table formatters for CLI output formatting.
