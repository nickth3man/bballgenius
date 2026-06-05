# packages/data/src/tabs/chatbot/eval/

## Responsibility

Offline evaluation suite for the LangGraph chatbot agent. Measures factual accuracy, SQL correctness, clarification behavior, and data-quality gaps using a three-way comparison (agent answer vs DuckDB value vs basketball-reference.com scraped truth). Two evaluation systems coexist: the **matrix eval** (current, preferred) and the **legacy iteration set** (deprecated).

## Design

### Two Eval Systems

| System | Config | Truth Source | Runner | Status |
|--------|--------|-------------|--------|--------|
| **Matrix eval** | `question-matrix.ts` (30 questions, 4 tiers) | `bbr-truth.json` (BBR-scraped, `verified` flag) + `dbTruth.ts` (canonical SQL) | `matrixHarness.ts` | Current |
| **Legacy iteration** | `iterate-questions.json` (~900 questions, multi-source) | `ground-truth.json` + external sources (StatMuse, LandOfBasketball, BRef) | `scripts/eval/` | Deprecated |

### Three-Way Truth Comparison (Matrix Eval)

```
agent answer  vs  DB value (dbTruth.ts)  vs  BBR value (bbrTruth.ts)
```

Verdicts:
- **`pass`** — agent matches BBR, and DB also matches BBR.
- **`data_quality`** — verified BBR value disagrees with DB (the warehouse is wrong; the agent cannot be right-vs-BBR against it).
- **`agent_bug`** — DB matches BBR but the agent's answer does not.
- **`stale_test_expected`** — the matrix's `expectedAnswer` disagrees with BBR (the test spec is outdated, not the agent).
- **`bbr_unverified`** — no verified BBR anchor exists; falls back to agent-vs-DB only.
- **`no_clarification` / `data_not_available`** — behavioural checks for vague / overly-specific tiers.

### Key Interfaces

- **`NbaEvalQuery`** (`nba-100-queries.ts`): { id, category, question, expectedTools?, expectNoSqlError? } — 100 queries across 17 categories (career leaders, season leaders, awards, team seasons, games, shot charts, play-by-play, identity, draft, basketball-reference, api schema, data quality, cross-schema).
- **`EvalQuestion`** (`question-matrix.ts`): { id, tier (simple|multi-step|vague|overly-specific), question, expectedAnswer, groundTruthIds[], expectedClarification, maxToolCalls, tolerance? }.
- **`RunResult`** (`matrixHarness.ts`): { questionId, agentAnswer, verdict, passed, staleTestExpected, bbrUnverified, comparisons (IdComparison[]), toolCalls, stopReason, latencyMs }.

### Truth Resolvers

- **`bbrTruth.ts`** — synchronous resolver. Reads `bbr-truth.json` (scraped live from basketball-reference.com, NBA-only, stamped with `asOf` date). Supports id shapes: `career_<stat>_leaders.<rank>`, `player_career_totals.<Player>.<stat>`, `mvp_winners.<season|Player>`, `team_records.<Team_Year>`, `season_leaders_2024.<stat>.<rank>`, `single_games.<game>[.leading_scorers]`. Returns `{ supported, verified, value, extra, asOf, source }`.
- **`dbTruth.ts`** — async resolver. Runs canonical SQL directly against DuckDB (not through the agent). Each `groundTruthId` maps to pre-written SQL that queries `main.fact_bref_player_season_totals`, `main.fact_player_award_vote`, `main.fact_bref_team_season_summary`, `api.v_season_leaders`, etc. Returns `{ supported, value, sql, error }`.
- **`bbrPlayerParser.ts`** — HTML parser using `cheerio` to extract regular-season career totals from a BBR player page's `#totals_stats` (or legacy `#totals`) table `<tfoot>` row. Handles un-rendered HTML (strips `<!-- -->` markers). Filtered to NBA-only career rows, skipping per-game-averages and multi-team splits.

### NBA Query Matrix (`nba-100-queries.ts`)

100 `NbaEvalQuery` entries in 17 categories: career leaders, season leaders, awards, team seasons, games, shot charts, play by play, identity, draft, basketball reference, api schema, data quality, cross schema. Some entries carry `expectedTools` (e.g., `['query_nba_db']`) and `expectNoSqlError: true` to assert tool-selection or error-free execution.

## Flow

### Matrix Eval Harness (`matrixHarness.ts`)

```
main()
  │
  ├─ initDb()                          ← Open DuckDB connection
  ├─ buildSystemPrompt() + TEST_MODE_SUFFIX    ← Deterministic prompt
  ├─ getModel()                        ← OpenRouter model
  │
  └─ for each QUESTION_MATRIX entry (× RUNS_PER_QUESTION)
       │
       ├─ runAgent(q, prompt, threadId)
       │   ├─ resetGraph()
       │   ├─ streamQuery([SystemMessage, HumanMessage], threadId)
       │   └─ consume StreamEvent tokens → return { answer, toolCalls, stopReason, latencyMs }
       │
       ├─ classify(q, agentAnswer, stopReason)
       │   ├─ Timeout/crash → terminal verdict
       │   ├─ Vague tier    → check for "?" / clarification markers → pass/no_clarification
       │   ├─ Specific tier → check for "not available" → pass/wrong_data_not_available
       │   ├─ Factual       → resolve BBR for each groundTruthId → attach IdComparison[]
       │   └─ returns RunResult with verdict='pass', reason='pending-db'
       │
       ├─ resolveDbValue(groundTruthId)   ← Canonical SQL on DuckDB
       ├─ finalizeFactual(result, q)
       │   ├─ Any verified BBR ≠ DB?        → data_quality
       │   ├─ No verified BBR anchor?       → bbr_unverified (agent vs matrix expected only)
       │   ├─ DB = BBR, agent contains BBR? → pass / stale_test_expected
       │   └─ DB = BBR, agent ≠ BBR?       → agent_bug
       │
       └─ Append JSONL row → write summary.json → exit code 1 if failures
```

### BBR Parser Flow

```
parseBbrCareerTotals(html, league='NBA')
  ├─ strip HTML comment markers (<!-- -->)
  ├─ cheerio.load()
  ├─ find #totals_stats or #totals table
  ├─ iterate tfoot rows → filter by career label (/Career|N Yrs/i, skip Game Avg / team splits)
  ├─ filter by league (lg_id cell if present)
  ├─ parse data-stat cells (games, pts, trb, ast, stl, blk) via STAT_ALIASES
  └─ return CareerTotals | null
```

## Integration

- **Internally**: imports `../agent/graph.js` (resetGraph), `../agent/streaming.js` (streamQuery), `../db.js` (initDb, closeDb, query), `../openrouter.js` (getModel), `../systemPrompt.js` (buildSystemPrompt).
- **Externally consumed by**: `scripts/eval/chatbot-smoke.ts` and other repo-root eval scripts that import from this folder.
- **Not consumed** by the web app or the chatbot agent at runtime — eval is purely offline.
- **`bbr-truth.json`** is the authoritative truth anchor. Its `verified` flag gates data-quality verdicts. Regenerated by re-running BBR scrapes.
- **`ground-truth.json`** is legacy — explicitly distrusted per project rules. The matrix harness never consults it; replaced by `bbr-truth.json`.
- **`iterate-questions.json`** stores ~900 questions in the older `Question` format (with `ExpectedAnswer`, `ValidationConfig`, `SourceMetadata`). Used only by legacy iteration scripts; not wired into the matrix harness.
- **`index.ts`** is a barrel that re-exports `bbrPlayerParser`, `bbrTruth`, `dbTruth`, `nba-100-queries`, and `question-matrix`.
