# `packages/data/src/tabs/chatbot/utils/`

## Responsibility
**Chatbot Infrastructure Utilities** — Supporting modules for the LangGraph agent: SQL extraction/validation/execution, retry with exponential backoff, metrics logging and aggregation, error capture, stream formatting, terminal formatting, markdown-to-ANSI conversion, and spinner animation. These modules handle the mechanics that the agent graph orchestrates.

## Design

### SQL Pipeline (`sql.ts`)

**Three-stage pipeline** controlled by the `check_nba_sql` and `query_nba_db` tools:

1. **Extraction** — `extractSql(text)` extracts SQL from LLM output (fenced blocks ` ```sql ` first, then fallback regex for bare SELECT/WITH/DESCRIBE). `extractSqlFromMarkdown(text)` extracts all SQL blocks from markdown.

2. **Validation** — `checkSql(sql)` runs two gates:
   - `validateReadOnlySql(sql)` from `shared/sqlValidation.js` — blocks mutating statements and external-access functions
   - `validateSchemaReferences(sql)` — parses FROM/JOIN clauses to extract table references, checks each against `getTables()` result. Supports `main.` prefix stripping for normalized comparison. Returns `SchemaValidationError[]` with `missing_table` / `missing_column` types.
   - Returns `"OK: SQL passed read-only safety and schema checks."` on pass, or an error string prefixed with `ERROR_PREFIX` values.

3. **Execution** — `executeSql(sql)` calls `checkSql()` first, then runs the query via `withRetry(() => query(sql), ...)` (max 2 attempts, 500ms base delay). Converts results via `formatResultsPretty` → `formatResultsTable`.

### Retry with Backoff (`retry.ts`)

**Exponential Backoff Pattern** — `withRetry<T>(fn, options?)`:
- `maxAttempts: 3` (default), `baseDelayMs: 1000`, `maxDelayMs: 10000`
- Only retries on `transient` errors (timeout, connection, lock, network, rate limit)
- Error categorization via `categorizeDbError(err)`: returns `'transient' | 'schema' | 'syntax' | 'permanent'`
- `isRetryableError(err)` — true for transient only
- `formatErrorForUser(err)` — user-facing messages for auth errors, rate limits, timeouts, network errors
- `formatErrorForLLM(err)` — LLM-facing messages with `ERROR_PREFIX` tags for schema/syntax/transient/permanent errors
- `ERROR_PREFIX` constants: `SQL_ERROR`, `SCHEMA_ERROR`, `SYNTAX_ERROR`, `TRANSIENT_ERROR`, `SCHEMA_VALIDATION_FAILED`

### Table Formatter (`tableFormatter.ts`)

`formatResultsTable(results)` — Converts `Record<string, unknown>[]` to a Unicode box-drawing table string:
- Max 20 rows displayed
- Auto-detects numeric columns for right-alignment
- Uses `┌─┬─┐` / `│ │` / `└─┴─┘` borders
- Shows row count header when >20 rows

### Stream Formatting (`streamFormatting.ts`)

Human-readable status and tool summaries for the streaming UI:
- `formatChainStageStatus(stage)` — maps `ChainStageName` to descriptive text (e.g., `'classify_intent'` → `'Classifying question...'`)
- `truncateMiddle(text, maxChars)` — ellipsis-in-the-middle truncation
- `summarizeToolInput(input)` — SQL preview (175 chars) or generic input summary
- `summarizeToolOutput(output)` — output preview (215 chars)
- `formatToolStartBlock(name, input)` / `formatToolEndBlock(name, output, durationMs?)` — structured terminal blocks

### Metrics (`metrics.ts`)

**Session-based logging to NDJSON files:**

- `MetricsSession` class — accumulates per-query metrics in memory and flushes to `chatbot-metrics.ndjson`
- `logMetric(rec)` — low-level event logger writes to `chatbot-events.ndjson`, respects `CHATBOT_LOG_LEVEL` filter
- Session tracks: tool calls with latencies, SQL complexity (table/join count per statement), token counts (input/output), chain stages, success/error status
- `getMetricsSummary(metricsFile?)` — reads NDJSON file and computes aggregates: total queries, tool calls, avg duration, token totals, success rate, SQL complexity averages, model breakdown
- Default `MetricsSession` singleton accessed via `getMetricsSession()` and convenience functions: `startMetrics`, `recordToken`, `recordToolCall`, `recordToolEnd`, `recordError`, `recordUsage`, `recordChainStage`, `flushMetrics`

### Correlation (`correlation.ts`)

**AsyncLocalStorage-based run context** — Assigns a unique `runId` and `turn` number to each agent execution:
- `withRun(turn, fn)` — creates a new `RunContext` with `runId = randomUUID()`
- `withRunContext(ctx, fn)` — merges with existing context
- `currentRun()` — returns current `{ runId, turn }` (or `{ runId: 'no-run', turn: -1 }` outside a context)
- `updateRunContext(patch)` — modifies the current context in-place

### Error Capture (`errorCapture.ts`)

`captureError(err, ctx?)` — Structured error recording:
- Accepts `ErrorContext` with `intent`, `model`, `sql`, `toolName`, `retryCount`, `stage`, `question`, `runId`
- Logs via `logMetric` with `level: 'error'`, `event: 'error'`
- Includes error name, message, stack trace, and SQL preview (500 chars)
- Returns the Error object (ensuring it's always an Error)

### Theme (`theme.ts`)

Terminal labeling utilities with `NO_COLOR` support:
- `isNoColor`, `Theme` — re-exported from `shared/theme.js`
- `dimOrPlain(text)`, `bold(text)` — ANSI dim/bold wrappers
- `label(text, colorCode)` — colored label with bold
- `youLabel()` — `[You]` in blue
- `aiLabel()` — `[AI]` in green
- `sqlLabel()` — `[SQL]` in cyan
- `errorLabel()` — `[Error]` in red
- `statusText(text)` — dimmed status text

### Markdown-to-ANSI (`markdown.ts`)

`markdownToAnsi(text)` — Converts markdown to ANSI-colored terminal output:
- Code blocks → wrapped in cyan
- Inline code → cyan
- Bold → bold
- Headings → bold
- Unordered lists → bullet character
- Blockquotes → dim with vertical bar
- Italic → dim

### Spinner (`spinner.ts`)
- `SPINNER_FRAMES` — 10 Braille spinner characters
- `getSpinnerFrame(tick, text?)` — returns current frame with optional status text

## Flow

### SQL Execution Pipeline
```
LLM output → extractSql()
  → checkSql()
    → validateReadOnlySql() (safety gate)
    → validateSchemaReferences() (table existence)
  → executeSql() [via tool]
    → checkSql() again (defense-in-depth)
    → withRetry(query) → formatResultsTable()
```

### Metrics Flow
```
streamQuery() events
  → session.recordToken() / recordToolCall() / recordToolEnd()
  → session.recordUsage() / recordChainStage()
  → session.flush() → appendFileSync('chatbot-metrics.ndjson')
```

## Integration

### Consumed by
- **`agent/tools.ts`** — imports `executeSql`, `checkSql` for `query_nba_db` and `check_nba_sql` tools
- **`agent/graph.ts`** — imports `captureError`, `ERROR_PREFIX` for guard nodes
- **`agent/streaming.ts`** — imports `captureError`, `logMetric`, `updateRunContext`, `formatErrorForUser`
- **`agent/orchestrator.ts`** — imports `captureError`
- **`packages/web`** — may import `data/tabs/chatbot/utils` via subpath export

### Exported via package.json subpath export
- `data/tabs/chatbot/utils` → `./src/tabs/chatbot/utils/index.ts` (barrel exports all modules)
