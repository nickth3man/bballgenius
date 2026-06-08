# `scripts/eval/`

## Responsibility
Chatbot Evaluation — Fact-checked smoke tests, multi-model evaluation harness, and iterative observability loop for the LangGraph NBA chatbot agent.

## Design

### Evaluation Architecture
Three distinct eval harnesses share a common utility core (`scripts/eval/shared/`):

| Harness | File | Use Case | Model Configuration |
|---------|------|----------|-------------------|
| Smoke Test | `chatbot-smoke.ts` | Quick quality gate; validates answer against expected keywords | Single model (MODEL env) or tiered (free/baseline/all via CHATBOT_SMOKE_TIER) |
| Multi-model | `chatbot-eval-multi-model.ts` | Regression matrix across N models; iteration loop with failure analysis | Comma-separated EVAL_MODELS list |
| Iterate Loop | `iterate_loop.ts` | Deep observability: per-run traces, JSONL logging, duplicate detection, secret scanning | Single model via OpenRouter config |

### Smoke Test (`chatbot-smoke.ts`)

**Entry: `bun run chatbot:smoke`** and variants:
- `bun run chatbot:smoke:free` — 10 cases across free-tier models
- `bun run chatbot:smoke:baseline` — 10 cases across baseline models
- `bun run chatbot:smoke:100` — full 100-query broad NBA suite

**Configuration via env vars:**
- `CHATBOT_SMOKE_SUITE` — `facts` (JSON test cases) or `100` (NBA_100_QUERIES).
- `CHATBOT_SMOKE_TIER` — `free`, `baseline`, `all`, or omit for single MODEL.
- `CHATBOT_SMOKE_LIMIT` — max cases to run.
- `CHATBOT_SMOKE_DELAY_MS` — inter-case delay for rate limits (default 3000ms).
- `CHATBOT_SMOKE_TIMEOUT_MS` — per-case timeout (default 120000ms).
- `DRY_RUN=1` — validate structure without API calls.

**Validation logic:**
- Extracts expected keywords from the `expectedAnswer` JSON object (player names, notable numbers).
- Checks: empty answer, SQL error mentions, leaked control text (`<|channel|>`, tool names), raw SQL leaks (`\`\`\`sql`).
- Keyword matching: at least 30% of expected keywords must be found in the answer.
- For the 100-query suite: validates expected tool usage and absence of SQL errors.

### Multi-Model Eval (`chatbot-eval-multi-model.ts`)

**Entry: `bun run chatbot:eval`**

- Uses `QUESTION_MATRIX` from the data package (typed expected answers).
- Tests 5 default models (overridable via `EVAL_MODELS` env var).
- Failure types: `PASS`, `WRONG_ANSWER`, `SQL_ERROR`, `LOOP`, `TIMEOUT`, `CLARIFICATION`, `DATA_UNAVAILABLE`.
- Iteration loop: runs up to `EVAL_ITERATION_MAX` (default 5) iterations; analyzes failure patterns per model.
- Generates `results/EVAL_REPORT.md` and per-iteration JSON snapshots.
- Supports parallel model execution (`PARALLEL_MODELS` env var).

### Iterate Loop (`iterate_loop.ts`)

**Entry: `bun run chatbot:iterate`**

The most comprehensive harness — designed for deep observability:

- **Streaming-based**: Uses `streamQuery()` instead of `invoke()` to capture every `StreamEvent`.
- **Per-run traces**: Full `RunTrace` JSON including timing, tool calls, SQL candidates, token usage, node transitions.
- **JSONL output**: Every trace is appended to `observability.jsonl` in `LOG_DIR` (default `.runs/nba-chatbot/`).
- **Test mode prompt**: Appends a `TEST_MODE_PROMPT_SUFFIX` with detailed SQL query contracts (table names, column names, join strategies).
- **15+ failure categories**: sql_syntax, sql_schema, tool_loop, duplicate_final_answer, hallucination, refused, no_clarification, timeout, crash, recursion_limit, etc.
- **Expected answer kinds**: `clarification_required`, `not_available`, `negative_identity_exact`, `entity_exact`, `numeric_exact`, `numeric_with_tolerance`, `entity_with_value`, `comparison`, `set_exact`.
- **Secret scanning**: `SECRET_SCAN=1` (default) walks the repo for API keys before running tests.
- **Duplication detection**: `detectDuplicateFinalAnswer()` catches repeated tokens, sentences, or paragraphs.
- **Tool trace capture**: Records each tool call's input, output, SQL candidates, latency, and validation results.
- **Configurable**: `RUNS_PER_QUESTION`, `RUN_TIMEOUT_MS`, `MAX_TOOL_CALLS`, `EVAL_QUESTION_IDS` (pin specific questions), `EVAL_QUESTION_LIMIT`.

### Question Suites
All harnesses import questions from `packages/data/src/tabs/chatbot/eval/`:
- `nba-100-queries.ts` — 100 categorized NBA test queries across 17 categories.
- `question-matrix.ts` — typed expected answers with tolerance modes.
- `iterate-questions.ts` — questions for the iterate loop with expected kind + entity/value/validation config.

## Flow

```
Smoke test:
  chatbot-smoke.ts
    → initDb() → buildSystemPrompt()
    → For each model × test case:
        → getChatbotGraph().invoke()
        → checkAnswer() (keyword matching)
    → Summary: pass/fail per model

Multi-model eval:
  chatbot-eval-multi-model.ts
    → For each iteration (up to EVAL_ITERATION_MAX):
        → For each model × QUESTION_MATRIX:
            → getChatbotGraph().invoke()
            → checkAnswer() (typed matching)
        → analyzeFailures() → suggest fixes
    → Generate EVAL_REPORT.md

Iterate loop:
  iterate_loop.ts
    → initDb() → buildSystemPrompt() + TEST_MODE_PROMPT_SUFFIX
    → For each question × RUNS_PER_QUESTION:
        → streamQuery() → process StreamEvents
        → Build RunTrace (tools, SQL, timing, tokens)
        → evaluateAnswer() → pass/fail/failure category
        → Append to observability.jsonl
    → Write summary.json + failures.csv
```

## Integration
- **DB**: All harnesses import `initDb()` / `closeDb()` from `packages/data/src/tabs/chatbot/db.js`.
- **Graph**: Import `getChatbotGraph()`, `resetGraph()` from `packages/data/src/tabs/chatbot/agent/graph.js`.
- **Model**: Import `setModel()`, `getModel()` from `packages/data/src/tabs/chatbot/openrouter.js`.
- **Prompt**: Import `buildSystemPrompt()` from `packages/data/src/tabs/chatbot/systemPrompt.js`.
- **Streaming**: `iterate_loop.ts` imports `streamQuery()` from `packages/data/src/tabs/chatbot/agent/streaming.js`.
- **Questions**: Imported from `packages/data/src/tabs/chatbot/eval/` (crosses data package boundary — allowed for eval scripts).
- **Requires**: `OPENROUTER_API_KEY` for live API calls; `data/nba.duckdb` for DB access.
