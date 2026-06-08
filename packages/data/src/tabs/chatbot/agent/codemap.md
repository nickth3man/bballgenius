# `packages/data/src/tabs/chatbot/agent/`

## Responsibility
**LangGraph Agent Layer** — Defines the chatbot's state graph, tools, model binding, streaming event system, and multi-agent orchestrator. This is the core reasoning engine that processes NBA questions by classifying intent, injecting schema context, executing SQL tools with retry/validation guards, and optionally decomposing complex questions across parallel SQL worker agents.

## Design

### Graph Architecture (StateGraph)

The agent uses **LangGraph's `StateGraph`** with two interchangeable graph configurations:

#### Single-Agent Worker Graph (`graph.ts` → `buildGraph()`)
```
START
  → prepare_turn (reset retry counters)
  → classify_intent (keyword-based intent detection)
  → inject_schema (inject context-appropriate schema prompt)
  → llm (call model with bound tools)
     ├── tools (ToolNode) → tool_budget_guard → sql_error_guard → llm (retry loop, max 3)
     └── END → validate_answer (hallucination check) → finalize_turn → END
```

#### Multi-Agent Orchestrator Graph (`orchestrator.ts` → `buildOrchestratorGraph()`)
```
START
  → orch_plan (planner agent decomposes question → N sub-tasks)
  → Send dispatch → orch_worker × N (parallel SQL worker agents)
  → orch_synthesize (merge findings into final answer)
  → END
```

**`getChatbotGraph()`** returns the orchestrator when `CHATBOT_ORCHESTRATION !== '0'`, otherwise the single-agent worker graph. Both expose the same `{ getState, streamEvents, invoke }` interface.

### State Schema (`state.ts`)

Uses **`zod/v4`** for runtime validation with LangGraph's `StateSchema`:

```typescript
ChatbotState = {
  messages: MessagesValue,           // LangGraph message accumulator
  sqlRetryCount?: number,            // SQL retry attempts (max 3)
  intentCategory?: string,           // classified intent label
  totalToolCalls?: number,           // cumulative tool call counter (max 10)
  validateAnswerRetries?: number,    // hallucination check retries (max 2)
  originalQuestion?: string,         // saved for orchestrator
  planMode?: 'single' | 'multi' | 'clarify',
  subtasks?: Subtask[],             // decomposed sub-questions
  workerBasePrompt?: string,         // base prompt for workers
  activeSubtask?: Subtask,          // per-worker dispatch
  workerFindings: ReducedValue<WorkerFinding[]>,  // accumulated via custom reducer
}
```

**Key types:** `IntentCategory` (12-value union), `Subtask` (id/focus/question), `WorkerFinding` (id/focus/finding/toolCalls), `PlanMode`.

### Intent Classification (`graph.ts` → `classifyQuestion()`)

**Keyword Pattern Matching** — Deterministic (no LLM call), using `RegExp` patterns mapped to 12 categories:
- `career_leaders` — triple-doubles, career stats, all-time, most points/rebounds/etc.
- `season_leaders` — season leader, per game, led the NBA
- `awards` — MVP, ROY, DPOY, All-NBA, All-Star, etc.
- `team_seasons` — team record, team rating, specific team names
- `cross_schema` — cross-check, between schemas
- `games` — finals, box score, playoff, game_id
- `shot_charts` — shot chart, three pointer, mid-range
- `play_by_play` — play-by-play, turnover, made shot
- `identity` — player ID, basketball-reference ID, bridge
- `draft` — draft pick, first overall
- `data_quality` — DQ, row count, audit
- `general` — fallback when no pattern matches

### Tools (`tools.ts`)

**5 tools** defined using `@langchain/core/tools` with `zod/v4` schemas:

| Tool Name | Function | Schema | Description |
|-----------|----------|--------|-------------|
| `query_nba_db` | `executeSql(sql)` | `{ sql: string }` | Execute read-only SQL on NBA database |
| `check_nba_sql` | `checkSql(sql)` | `{ sql: string }` | Validate SQL without executing |
| `get_schema_info` | `getColumns(qualifiedName)` | `{ tableName: string }` | Discover table/column definitions |
| `list_nba_tables` | `getTableRefs()` | `{ search?: string }` | List available tables/views |
| `find_stat_columns` | Canonical stat crosswalk query on `meta.stat_crosswalk` | `{ canonicalName, family?, limit? }` | Find columns mapped to a stat name |

### Schema Injection (`schemaFilter.ts`)

After intent classification, the `inject_schema` node builds a context-specific schema prompt:
- Maps intent category → relevant tables via `INTENT_TABLE_MAP` (e.g., `career_leaders` → `[fact_bref_player_season_totals, player_totals, dim_player]`)
- Resolves best-qualified table names using `SCHEMA_PRIORITY` (`[main, stg_bref, unified_star, nbadb, api, audit]`)
- Fetches column metadata (up to 24 columns per table) and appends SQL templates from `INTENT_SQL_TEMPLATES`

### Schema Catalog (`schemaCatalog.ts`)
- `buildSchemaCatalog()` — compact listing of EVERY schema and table (no columns), cached for the orchestrator planner prompt.
- `invalidateSchemaCatalogCache()` — clears the cache (called by `resetGraph()`).

### Schema Constants (`schemaConstants.ts`)
- `DETAILED_COLUMN_LIMIT = 24` — max columns shown in schema prompts
- `SCHEMA_PRIORITY` — ordered schema list for table resolution
- `CORE_TABLE_PATTERNS` — 37 canonical table names for system prompt inclusion

### Guard Mechanisms (`graph.ts`)

1. **Tool Budget Guard** (`tool_budget_guard`): Caps total tool calls at `MAX_TOTAL_TOOL_CALLS = 10`. Detects loops by checking if the same tool signature repeats `LOOP_DETECTION_THRESHOLD = 3` times in the current batch. Routes to `finalize_turn` on violation.

2. **SQL Error Guard** (`sql_error_guard`): Checks tool outputs for error prefixes (`SQL Error`, `Schema error`, `SQL syntax error`, `Transient error`, `Schema validation failed`). On error with retries < 3, routes back to `llm` with increment. On ≥ 3 retries, routes to `finalize_turn` with a system error message.

3. **Hallucination Guard** (`validate_answer`): Extracts numbers ≥ `HALLUCINATION_NUMBER_THRESHOLD = 500` from the AI answer and cross-checks against numbers present in tool message outputs. Numbers ≥ 500 not found in tool outputs (and not years 1900-2099) are flagged as hallucinations. Routes back to `llm` for correction (max `MAX_VALIDATE_ANSWER_RETRIES = 2`).

4. **Message Trimming** (`trimMessagesForModel`): Retains up to 5 system messages and 40 non-system messages to avoid context window overflow.

5. **Loop Detection**: Within `toolBudgetGuard`, compares tool call signatures (name + first 80 chars of content) and triggers forced finalization when the same signature appears 3+ times.

### Model Binding (`model.ts`)
- `createModel()` — creates `ChatOpenRouter` instance with:
  - Model from `getModel()` (env `MODEL`, default `deepseek/deepseek-r1`)
  - Temperatures from env `TEMPERATURE` / `LLM_TEMPERATURE` / `OPENROUTER_TEMPERATURE` (default 0.3)
  - Reasoning config via `REASONING_EFFORT` env (off/low/medium/high, default medium)
  - `parallel_tool_calls: true` in `modelKwargs`

### Checkpointing (`graph.ts` → `getCheckpointer()`)
- **Singleton pattern**: `MemorySaver` by default; `SqliteSaver` when `CHATBOT_PERSIST_DIR` is set (loaded via dynamic `require()`).

### Streaming (`streaming.ts`)

**AsyncGenerator-based** — `streamQuery()` yields `StreamEvent` union:

```typescript
type StreamEvent =
  | { type: 'token'; content: string }           // LLM token
  | { type: 'reasoning'; content: string }        // thinking/reasoning tokens
  | { type: 'tool_start'; name, input, runId }   // tool invocation started
  | { type: 'tool_end'; name, output, runId, durationMs? }
  | { type: 'tool_error'; name, error, runId? }
  | { type: 'chain_stage'; stage: ChainStageName } // 13 graph node names
  | { type: 'usage'; usage: { inputTokens, outputTokens } }
  | { type: 'done'; messages: BaseMessage[] }      // final
  | { type: 'error'; message, runId, toolName?, stage? }
```

- Spans track `tokenCount`, `toolStarts`, `toolErrors`, `sqlErrors`, `chainStages`, `usage` for metrics logging.
- `extractReasoningChunk()` handles provider-specific reasoning keys (`reasoning`, `reasoning_content`, `reasoning_details`).
- `normalizeToolInput()` unwraps LangGraph's v2 `{ input: JSON.stringify(args) }` format.

### Abort Signal (`abort.ts`)
- Module-scoped holder `_abortSignal` shared between worker graph and orchestrator to avoid circular imports.
- `setAbortSignal(signal)` / `getAbortSignal()` / `abortOptions()`

## Flow

### Single-Agent Flow
```
User question → streamQuery(messages, threadId)
  → graph.streamEvents (v2)
    → prepare_turn (reset counters)
    → classify_intent (regex → IntentCategory)
    → inject_schema (fetch relevant table schemas as SystemMessage)
    → llm (invoke ChatOpenRouter with bound tools)
      ├── tool call → ToolNode → toolBudgetGuard → sqlErrorGuard
      │   └── (retry ≤3) → llm
      │   └── (max retries or budget) → finalize_turn
      └── no tool call → validate_answer
          ├── hallucination detected (≤2 retries) → llm
          └── clean → finalize_turn
```

### Multi-Agent Orchestrator Flow
```
streamQuery → orchestrator graph
  → orch_plan: planner LLM reads full schema catalog, emits JSON plan { mode, subtasks }
  → dispatchWorkers: Send('orch_worker', { activeSubtask }) × N
    → orch_worker: each runs runWorker() with independent message history, tool loop (max 6 rounds)
  → orch_synthesize: LLM merges worker findings → final AI message
```

## Integration

### Consumes
- `../db.js` — `query`, `getTables`, `getTableRefs`, `getColumns`, `invalidateSchemaCache`
- `../openrouter.js` — `getModel()`
- `../utils/sql.js` — `executeSql`, `checkSql`
- `../utils/errorCapture.js` — `captureError`
- `../utils/retry.js` — `ERROR_PREFIX`, `formatErrorForUser`
- `../utils/correlation.js` — `updateRunContext`
- `../utils/metrics.js` — `logMetric`
- `../systemPrompt.js` — `buildSystemPrompt` (orchestrator worker base)

### Exports
- `getChatbotGraph()` — main entry point (orchestrator or worker)
- `getWorkerGraph()` — worker graph directly
- `resetGraph()` — clears all caches and graph instances
- `classifyQuestion()` — exported for testing
- `streamQuery()` — async generator of StreamEvent
- `setAbortSignal()` — for external cancellation
- All state types: `ChatbotStateType`, `ChatbotUpdateType`, `IntentCategory`, `Subtask`, `WorkerFinding`

### Consumers
- **`../eval/matrixHarness.ts`** — imports `streamQuery`, `resetGraph` for evaluation
- **`packages/web/src/routes/api/copilotkit.ts`** — uses `streamQuery` for the chat API endpoint
- **`scripts/eval/chatbot-smoke.ts`** — imports from agent barrel for smoke testing
