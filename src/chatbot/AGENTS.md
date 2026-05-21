# AGENTS.md — chatbot

## Package Purpose

Terminal-based NBA analytics chatbot using LangGraph ReAct agent with DuckDB querying, streaming output, and error-correction loop.

## Subagent Delegation

Always read `.agent/subtask-template.md` from the repository root immediately before creating any subagent/task prompt. Apply its prompt rules to every delegation: critical instructions in the first 15%, nesting depth <=4, 40-50% instruction ratio, single-source rule references, and token-efficient wording that preserves domain precision.

This applies to all `task` tool calls for chatbot work, including scout/research, review, testing, and implementation subagents. Do not rely on remembered template details; reread the file each time before delegating.

## Agent Graph

```
START → classify_intent → llm → [toolsCondition] → tools → sql_critic → llm → END
```

### Nodes

| Node | File | Purpose |
|------|------|---------|
| `classify_intent` | `agent/graph.ts` | Deterministic keyword-based question classification (no LLM call) |
| `llm` | `agent/graph.ts` | Calls OpenRouter model with bound tools, returns tool calls or final answer |
| `tools` | `agent/graph.ts` | `ToolNode([queryNbaDb, getSchemaInfo, listNbaTables, checkNbaSql])` — executes tool calls (parallel when multiple) |
| `sql_critic` | `agent/graph.ts` | Validates tool output for SQL errors, routes back to `llm` for correction up to `MAX_SQL_RETRIES=3` |

### State

`agent/state.ts` — `StateSchema` with:
- `messages: MessagesValue` — LangGraph message history (required)
- `sqlRetryCount: z.number().optional()` — current SQL error retry count
- `intentCategory: z.string().optional()` — deterministic question category (career_leaders, awards, etc.)

### Tools

| Tool | File | Description |
|------|------|-------------|
| `query_nba_db` | `agent/tools.ts:7` | Executes read-only DuckDB SQL with pre-execution schema validation |
| `get_schema_info` | `agent/tools.ts:59` | On-demand table/column discovery with partial name matching |

## Module Map

```text
src/chatbot/
├── index.ts              # TUI bootstrap — initDb(), buildSystemPrompt(), createChatApp()
├── chatApp.ts            # Chat UI (OpenTUI): scrollable display, streaming, model selector, metrics
├── db.ts                 # DuckDB singleton + schema introspection (getTableRefs, getColumns, getTables)
├── openrouter.ts         # OpenRouter API: model list, model selection
├── systemPrompt.ts       # Dynamic system prompt builder from live database schema
├── agent/                # LangGraph agent core
│   ├── graph.ts          # buildGraph() — StateGraph with llm/tools/sql_critic nodes
│   ├── state.ts          # ChatbotState — MessagesValue + sqlRetryCount
│   ├── tools.ts          # query_nba_db + get_schema_info (Zod schemas)
│   ├── model.ts          # createModel() — ChatOpenAI @ OpenRouter, temp=0.3
│   └── streaming.ts      # streamQuery() async generator — StreamEvent union
├── utils/                # Stateless utilities
│   ├── sql.ts            # validateReadOnlySql, validateSchemaReferences, extractSql, executeSql, formatResultsPretty
│   ├── retry.ts          # categorizeDbError (transient/schema/syntax/permanent), formatErrorForLLM, withRetry
│   ├── metrics.ts        # NDJSON metrics logger (duration, tokens, SQL, errors)
│   ├── ansi.ts           # ansiToStyledText conversion for OpenTUI
│   └── theme.ts          # TokyoNight color palette
├── features/
│   └── modelSelector.ts  # Interactive model picker overlay (arrow keys, search, vim navigation)
├── eval/
│   └── nba-100-queries.ts # 100 categorized NBA questions (17 categories)
└── __tests/              # Bun tests with LangChain mocking
    ├── processQuestion.test.ts  # Graph behavior: ReAct, critic, retry, parallel calls
    ├── executeSql.test.ts       # SQL validation + execution against real DB
    ├── sqlExtraction.test.ts    # SQL extraction from LLM markdown output
    ├── formatResults.test.ts    # Pretty-print formatting
    ├── systemPrompt.test.ts     # Dynamic prompt building
    ├── ansi.test.ts             # ANSI-to-StyledText conversion
    ├── retry.test.ts            # Error classification, retry behavior, LLM error prefixes
    └── streaming.test.ts        # streamQuery token/tool/usage/done/error events
```

## Key Patterns

### Error-Proof SQL Execution

`sql_critic` validates every tool result before routing. Errors are classified by `categorizeDbError()` (transient → retry, schema → correct, syntax → correct, permanent → surface). Error prefixes are centralized in `ERROR_PREFIX` (`utils/retry.ts`) and consumed by `graph.ts`/`sql.ts` to avoid string drift. The critic enforces `MAX_SQL_RETRIES=3` before giving up.

### Schema Pre-Validation

Before DuckDB execution, `validateSchemaReferences()` checks table existence against `information_schema`. This catches table name typos before they become DuckDB parse errors.

### Parallel Tool Calls

`ToolNode` supports parallel execution when the LLM emits multiple `tool_calls` in a single response. The system prompt instructs the LLM to use parallel calls for comparisons (e.g., "Compare LeBron vs MJ stats").

### Streaming via streamEvents v2

`streamQuery()` yields typed `StreamEvent` events: `token` (LLM output chunks), `tool_start`/`tool_end`/`tool_error` (tool lifecycle), `usage` (token counts), `done` (final messages), `error` (exceptions).

### Checkpointing

Graph compiled with `getCheckpointer()` — `MemorySaver` default, `SqliteSaver` when `CHATBOT_PERSIST_DIR` set. Enables multi-turn conversation memory and future HITL support.

### Singleton Graph

`getChatbotGraph()` returns cached graph. `resetGraph()` invalidates cache (called on model change). Each invocation uses a unique `thread_id` for isolation.

## Type Safety and Linting

Chatbot code is checked by the repo-wide `tsconfig.json` and a stricter chatbot-only config:

```bash
bun run typecheck          # full repo
bun run typecheck:chatbot  # chatbot + shared with strictest options
```

`tsconfig.chatbot.json` enables `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, unused checks, and `verbatimModuleSyntax`. Prefer guards/defaults over weakening types. Access environment variables and dynamic records with bracket syntax, e.g. `process.env['OPENROUTER_API_KEY']` and `input['sql']`.

Biome is strict and runs with `--error-on-warnings`. Use `import type` / `export type`, avoid unused locals/imports, prefer `const`, and let Biome organize imports. Lefthook runs Biome on staged TypeScript/JSON files before commits.

## Testing

All tests use `--concurrency=1` (DuckDB constraint). Mock pattern:

```typescript
mock.module('@langchain/openai', () => ({
  ChatOpenAI: class {
    bindTools() { return this; }
    async invoke() { return new AIMessage('Mock response'); }
  },
}));

mock.module('../db.js', () => ({
  query: async () => [{ person_id: '2544' }],
  getTables: async () => ['dim_player'],
}));
```

Run all chatbot tests: `bun test src/chatbot/__tests__ --concurrency=1`

Run the same checks used by chatbot CI:

```bash
bun run typecheck:chatbot
bun test src/chatbot/__tests__ --concurrency=1
```

CI also blocks `.only(` / `.skip(` in `src/chatbot/__tests__/` via `scripts/ci-guards.sh`.

When delegating chatbot testing or research to subagents, read `.agent/subtask-template.md` first and place the chatbot-specific success criteria near the top of the prompt.

## Adding a New Tool

1. Define in `agent/tools.ts` using `tool()` from `@langchain/core/tools` with Zod schema
2. Add to `bindTools([...])` and `ToolNode([...])` in `agent/graph.ts`
3. Handle new tool events in `chatApp.ts` stream handler (tool_start/tool_end)
4. Add test in `__tests__/processQuestion.test.ts` with mock responses
5. Update system prompt if the tool needs LLM guidance
6. Run `bun run typecheck:chatbot` and `bun test src/chatbot/__tests__ --concurrency=1`

## Adding a New Graph Node

1. Define async function taking `state: ChatbotStateType`
2. Return `Partial<ChatbotStateType>` for plain updates or `Command({ goto, update })` for routing
3. Add `addNode('name', fn)` + edges to `buildGraph()`
4. Add state fields to `ChatbotState` in `state.ts` only if a node reads/writes them
5. Add corresponding tests
6. Run `bun run typecheck:chatbot` and `bun test src/chatbot/__tests__ --concurrency=1`
