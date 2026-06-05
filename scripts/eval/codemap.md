# scripts/eval/

## Responsibility

Offline chatbot evaluation harnesses that run NBA questions through the LangGraph agent (`packages/data/src/tabs/chatbot/agent/`) and grade responses. Supports keyword-based fact-checked validation, multi-model matrix evaluation, and iterative streaming runs with structured observability. Not used in CI; invoked manually or scheduled.

## Design

Three standalone scripts sharing a `shared/` utility module:

| Script | Surface | Answer Sources | Grading Strategy |
|---|---|---|---|
| `chatbot-smoke.ts` | Fact-checked JSON (`nba-facts-test-cases.json`) or 100-query TS suite | `graph.invoke()` (non-streaming) | Keyword presence + leak/error detection (≥30% threshold) |
| `chatbot-eval-multi-model.ts` | `QUESTION_MATRIX` (question-matrix.ts) | `graph.invoke()` (non-streaming) | `EvalQuestion.expectedAnswer` matching — exact string, numeric (with tolerance), item-set, clarification-required, data-unavailable |
| `iterate_loop.ts` | `QUESTIONS` (iterate-questions.ts) | `streamQuery()` (streaming events) | `ExpectedKind`-driven evaluator: entity, numeric, set, clarification, negative-identity, comparison + duplicate/loop/timeout detection |

**Key architectural decisions:**
- All three import chatbot internals directly via `../../packages/data/src/tabs/chatbot/...` (not workspace alias) — they are standalone scripts outside the monorepo build.
- Graph state reset (`resetGraph()`) between each question to prevent state leakage across runs.
- Model set via OpenRouter through `setModel()` at script/iteration granularity.
- DuckDB lifecycle managed by `initDb()`/`closeDb()` from `chatbot/db.js`.
- `iterate_loop.ts` appends a `TEST_MODE_PROMPT_SUFFIX` contract (SQL rules, final-answer protocol) to `buildSystemPrompt()` output — this is unique; the other two scripts use the base prompt only.

## Flow

```
script.ts
  ├── initDb() → DuckDB connection
  ├── buildSystemPrompt() → base system prompt
  ├── setModel(modelId) → OpenRouter model
  ├── resetGraph() → fresh graph state
  │
  ├── [chatbot-smoke.ts / chatbot-eval-multi-model.ts]
  │     └── graph.invoke({ messages: [SystemMessage, HumanMessage] })
  │           └── LangGraph agent → tools → sql_critic → final answer
  │         checkAnswer() / evaluateAnswer() → TestResult
  │
  └── [iterate_loop.ts]
        └── streamQuery([SystemMessage, HumanMessage], threadId)
              └── streaming event loop (asyncIterator):
                    token → accumulate streamedTokenText
                    tool_start → ToolTrace (SQL candidates, timing)
                    tool_end / tool_error → output summary
                    done → extractFinalAnswerFromMessages()
              evaluateAnswer() → RunTrace.evaluator
              appendFileSync(jsonlPath, jsonLine(trace))
        └── writeFailureCsv() / writeFileSync(summary.json)
```

**`iterate_loop.ts` specific observability pipeline:**

```
streamQuestion()
  → RunTrace (full event trace with tool calls, SQL candidates, timestamps)
  → evaluateAnswer() → FailureCategory (15 categories)
  → jsonLine() → observability.jsonl (newline-delimited JSON)
  → CSV summary (failures.csv) + summary.json
  → secret scanning (SECRET_SCAN=1 scans repo for leaked API keys)
```

**`chatbot-eval-multi-model.ts` iteration loop:**

```
main()
  → for iteration = 1..maxIterations:
       → for each model in MODELS:
            → runTestForModel() for each question in QUESTION_MATRIX
            → collect model IterationResult (pass/fail + failurePatterns)
       → if totalPass === totalQuestions: break
       → analyzeFailures() → suggest fixes (LOOP_DETECTION, SQL_IMPROVEMENT, PROMPT_IMPROVEMENT)
       → writeFileSync(results/iteration-{n}.json)
  → generateReport() → results/EVAL_REPORT.md
```

## Integration

| Dependency | Source | Used By |
|---|---|---|
| `getChatbotGraph()` | `packages/data/src/tabs/chatbot/agent/graph.ts` | All three scripts |
| `resetGraph()` | same | All three scripts |
| `streamQuery()` | `packages/data/src/tabs/chatbot/agent/streaming.ts` | `iterate_loop.ts` |
| `initDb()` / `closeDb()` | `packages/data/src/tabs/chatbot/db.ts` | All three scripts |
| `setModel()` / `getModel()` | `packages/data/src/tabs/chatbot/openrouter.ts` | All three scripts |
| `buildSystemPrompt()` | `packages/data/src/tabs/chatbot/systemPrompt.ts` | All three scripts |
| `NBA_100_QUERIES` | `packages/data/src/tabs/chatbot/eval/nba-100-queries.ts` | `chatbot-smoke.ts` |
| `QUESTION_MATRIX` / `EvalQuestion` | `packages/data/src/tabs/chatbot/eval/question-matrix.ts` | `chatbot-eval-multi-model.ts` |
| `QUESTIONS` / `Question` / `ExpectedAnswer` | `packages/data/src/tabs/chatbot/eval/iterate-questions.ts` | `iterate_loop.ts` |
| `StreamEvent` | `packages/data/src/tabs/chatbot/agent/streaming.ts` | `iterate_loop.ts` |

**Child codemap — `shared/`**: See `scripts/eval/shared/codemap.md`.
**Tests**: `scripts/eval/__tests__/evaluator-utils.test.ts` — unit tests for `normalizeText`, `normalizeNumeric`, `countOccurrences`, `detectDuplicateFinalAnswer` (re-exported from `iterate_loop.ts`).
