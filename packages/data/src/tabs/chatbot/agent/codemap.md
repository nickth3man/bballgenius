# packages/data/src/tabs/chatbot/agent/

## Responsibility

Implements the LangGraph-based chatbot agent for NBA analytics. Contains two parallel graph architectures:

- **Single-agent worker graph** (`graph.ts`): A monolithic LLM + tools loop with SQL error correction, tool budget enforcement, loop detection, and hallucination validation. Used directly when `CHATBOT_ORCHESTRATION=0`, or as the SQL worker inside the orchestrator.
- **Multi-agent orchestrator** (`orchestrator.ts`): A planner/workers/synthesizer pipeline that decomposes complex questions into parallel sub-tasks, dispatches independent SQL worker agents, and merges findings.

The streaming layer (`streaming.ts`) wraps graph execution into an async-generator yielding typed `StreamEvent` objects consumed by the web chat route.

## Design

### Graph State (`state.ts`)

`ChatbotState` defined via LangGraph's `StateSchema`:

- **`messages`** (`MessagesValue`) — BaseMessage array (shared reducer).
- **`sqlRetryCount`**, **`totalToolCalls`**, **`validateAnswerRetries`** — counters for guard nodes.
- **`intentCategory`** — deterministic regex classification result (12 categories: `career_leaders`, `season_leaders`, `awards`, `team_seasons`, `games`, `shot_charts`, `play_by_play`, `identity`, `draft`, `data_quality`, `cross_schema`, `general`).
- **`originalQuestion`**, **`planMode`** (`'single'|'multi'|'clarify'`), **`subtasks`**, **`workerBasePrompt`**, **`activeSubtask`** — orchestrator planning fields.
- **`workerFindings`** — `ReducedValue` with custom array-append reducer (accepts `Overwrite` for reset).

### Model Binding (`model.ts`)

`createModel()` returns a `ChatOpenAI` instance pointed at `https://openrouter.ai/api/v1`. Configured via env vars: `OPENROUTER_API_KEY` (required), `MODEL` (default `openai/gpt-oss-120b`), `TEMPERATURE`/`LLM_TEMPERATURE`/`OPENROUTER_TEMPERATURE` (default 0.3). 2-minute timeout, `parallel_tool_calls: true`. Tools are bound at graph construction time via `model.bindTools([...nbaTools])`.

### Tools (`tools.ts`, `toolNames.ts`)

Five Zod-v4-defined LangChain `tool()` wrappers:

| Tool | Name constant | Purpose |
|------|---------------|---------|
| `queryNbaDb` | `query_nba_db` | Execute read-only SQL on DuckDB |
| `checkNbaSql` | `check_nba_sql` | Validate SQL without executing (safety + schema check) |
| `getSchemaInfo` | `get_schema_info` | Column discovery for a table (partial match) |
| `listNbaTables` | `list_nba_tables` | List schemas/tables, optionally filtered |
| `findStatColumns` | `find_stat_columns` | Semantic column search via `meta.stat_crosswalk` |

### Intent Classification (`graph.ts`)

`classifyQuestion()` scans the human message with 11 regex patterns (lines 36–78) and returns an `IntentCategory`. This is deterministic — no LLM call. Used by the `classify_intent` graph node to select schema prompts.

### Schema Injection (`schemaFilter.ts`, `schemaConstants.ts`)

`buildIntentSchemaPrompt(intentCategory)` maps each non-general category to:
1. A curated list of table patterns (e.g. `career_leaders` → `['fact_bref_player_season_totals', 'player_totals', 'dim_player']`)
2. Resolves qualified names via `SCHEMA_PRIORITY` (`main`, `stg_bref`, `unified_star`, `nbadb`, `api`, `audit`)
3. Fetches up to `DETAILED_COLUMN_LIMIT` (24) columns per table
4. Injects intent-specific SQL templates (e.g. career total patterns, award vote patterns)

The result is injected as a `SystemMessage` after intent classification. Returns `null` for `general` and `cross_schema`.

### Orchestrator Schema Catalog (`schemaCatalog.ts`)

`buildSchemaCatalog()` enumerates ALL non-system tables/views (no columns) for the planner's context. Cached per session, invalidated via `resetGraph()`.

### Abort Signal (`abort.ts`)

Shared module-level `AbortSignal` holder to avoid circular dependency between `graph.ts` and `orchestrator.ts`. Set by `streaming.ts` before graph invocation, read by both graph implementations for model calls.

## Flow

### Single-Agent Worker Graph (default when `CHATBOT_ORCHESTRATION=0`)

```
START → prepare_turn → classify_intent → inject_schema → llm
                                                          │
                                                  toolsCondition
                                                         ╱ ╲
                                                       ╱     ╲
                                                   tools     validate_answer
                                                     │           │
                                                     ▼           │
                                            tool_budget_guard     │
                                                     │           │
                                                     ▼           │
                                            sql_error_guard       │
                                                   ╱ ╲            │
                                                 ╱     ╲          │
                                              llm     finalize_turn ←─┘
                                                              │
                                                              ▼
                                                             END
```

1. **`prepare_turn`** — Resets `sqlRetryCount`, `totalToolCalls`, `validateAnswerRetries` to 0.
2. **`classify_intent`** — Deterministic regex on last human message → `intentCategory`.
3. **`inject_schema`** — Builds intent-specific `SystemMessage` with table columns + SQL templates.
4. **`llm`** — Invokes model with `trimMessagesForModel()` (keeps last 5 system + 40 non-system messages). Tools already bound.
5. **`tools`** — `ToolNode` executes parallel tool calls.
6. **`tool_budget_guard`** — Checks `totalToolCalls > 10` or loop detection (same tool+args 3×). Routes to `finalize_turn` on breach, otherwise continues.
7. **`sql_error_guard`** — Scans trailing `ToolMessage`s for error prefixes (`SQL_ERROR|SCHEMA_ERROR|SYNTAX_ERROR|TRANSIENT_ERROR|SCHEMA_VALIDATION_FAILED`). On error: routes back to `llm` with correction system message if retries < 3, else routes to `finalize_turn`. On success: routes to `llm`.
8. **`validate_answer`** — Extracts numbers ≥500 (excluding years 1900–2099) from AI answer. Cross-references against numbers in tool outputs. On hallucinated numbers: routes back to `llm` with correction (max 2 retries). Otherwise routes to `finalize_turn`.
9. **`finalize_turn`** — Resets all counters, reaches `END`.

### Multi-Agent Orchestrator (default when `CHATBOT_ORCHESTRATION` ≠ 0)

```
START → orch_plan → conditional dispatch
                       │
               ┌───────┴───────┐
               │               │
         orch_worker × N   orch_synthesize (clarify)
               │               │
               └───────┬───────┘
                       ▼
               orch_synthesize
                       │
                       ▼
                      END
```

1. **`orch_plan`** — Reads the full schema catalog, calls planner LLM with instructions to emit JSON `{mode, subtasks}`. `parsePlan()` extracts 1–4 subtasks. Handles LLM failure by falling back to single-task plan.
2. **`orch_worker`** — Dispatched via LangGraph `Send()` fan-out. Each worker runs an independent tool-calling loop (max 6 rounds) with the full NBA toolset. Workers share no message history. On tool budget exhaustion, forces a summary call. Returns `WorkerFinding`.
3. **`orch_synthesize`** — Merges findings via synthesizer LLM. For `clarify` mode, asks one clarification question. For missing data, emits exact phrase: `"I do not have that information in the database."`

### Streaming (`streaming.ts`)

`streamQuery(messages, threadId, signal?, opts?)` is an `AsyncGenerator<StreamEvent>`:

1. Sets abort signal on shared holder.
2. Calls `getChatbotGraph().streamEvents()` with version `v2` and `recursionLimit: 40`.
3. Maps LangGraph runtime events to typed `StreamEvent` union:
   - `on_chain_start` for known graph node names → `chain_stage`
   - `on_chat_model_stream` → `token`
   - `on_tool_start` → `tool_start`
   - `on_tool_end` → `tool_end` (with duration)
   - `on_tool_error` → `tool_error` (tracks SQL errors separately)
   - `on_chat_model_end` → `usage` (token counts)
4. After stream completes: reads final state via `graph.getState()` → yields `done` with messages.
5. On error: yields `error` event with formatted user message.

Span metrics (token count, tool starts/errors, SQL errors, chain stages, usage) are logged to `logMetric`.

## Integration

### Consumed by
- **`packages/data/src/tabs/chatbot/`** — `processQuestion.ts` and eval harnesses import from `./agent/`.
- **`packages/web/src/routes/api/copilotkit.ts`** — Web chat route calls `streamQuery()`.
- **`scripts/eval/chatbot-smoke.ts`** — Smoke test imports `getChatbotGraph()`, `streamQuery()`.

### Depends on
- **`packages/data/src/tabs/chatbot/db.ts`** — `getColumns()`, `getTableRefs()`, `query()` for all DB access.
- **`packages/data/src/tabs/chatbot/utils/sql.ts`** — `executeSql()`, `checkSql()` for tool implementations.
- **`packages/data/src/tabs/chatbot/utils/metrics.ts`** — `logMetric()` for span telemetry.
- **`packages/data/src/tabs/chatbot/utils/errorCapture.ts`** — `captureError()` for error logging.
- **`packages/data/src/tabs/chatbot/utils/correlation.ts`** — `updateRunContext()` for run ID correlation.
- **`packages/data/src/tabs/chatbot/utils/retry.ts`** — `ERROR_PREFIX`, `formatErrorForUser()`.
- **`packages/data/src/tabs/chatbot/openrouter.ts`** — `getModel()` for model name resolution.
- **`packages/data/src/tabs/chatbot/systemPrompt.ts`** — `buildSystemPrompt()` for base system prompt.

### Graph selection
`getChatbotGraph()` in `graph.ts` is the single entry point. When `CHATBOT_ORCHESTRATION` env var is not `'0'`, it returns the orchestrator graph; otherwise the worker graph. Both graphs compile over `ChatbotState` and expose the same `streamEvents`/`getState`/`invoke` surface so the streaming layer is agnostic to which graph runs.

### Checkpointing
Worker graph uses `MemorySaver` by default, or `SqliteSaver` when `CHATBOT_PERSIST_DIR` is set (with graceful fallback if the sqlite package is missing). Orchestrator always uses `MemorySaver`.
