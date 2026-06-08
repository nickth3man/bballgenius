# `packages/data/src/tabs/chatbot/eval/`

## Responsibility
**Chatbot Evaluation Suite** — A comprehensive three-way eval harness that compares agent answers against both the local DuckDB and basketball-reference.com ground truth. Contains 100 categorized NBA test questions, a structured question matrix with behavioral tiers, BBR scraped truth data, deterministic DB truth resolvers, and a BBR player-page HTML parser.

## Design

### Evaluation Architecture (Three-Way Comparison)

The harness (`matrixHarness.ts`) compares three values per question:
```
agent answer   vs   DB value (dbTruth)   vs   BBR value (bbrTruth)
```

**Verdicts:**
| Verdict | Meaning |
|---------|---------|
| `pass` | Agent matches BBR, and DB also matches BBR |
| `data_quality` | Verified BBR value disagrees with DB (the DB is wrong) |
| `agent_bug` | DB matches BBR but the agent answer does not |
| `stale_test_expected` | Matrix's own expectedAnswer disagrees with BBR (test is stale) |
| `bbr_unverified` | No verified BBR anchor; agent-vs-DB only |
| `no_clarification` | Vague tier — agent failed to ask for clarification |
| `wrong_data_not_available` | Over-specific tier — agent didn't report data unavailable |
| `timeout` / `crash` | Execution failure |

### Question Sets

#### 100 NBA Queries (`nba-100-queries.ts`)
`NBA_100_QUERIES: NbaEvalQuery[]` — 100 questions across 10 categories:
- `career leaders` (15) — top 5 in points, assists, rebounds, steals, blocks, threes, FTs, games; specific player totals
- `season leaders` (15) — per-game leaders in multiple seasons, advanced stats (PER, WS, BPM)
- `awards` (10) — MVP, ROY, DPOY winners, vote shares, All-NBA/All-Defense/All-Star selections
- `team seasons` (10) — team records, SRS, offensive/defensive ratings, pace
- `games` (10) — final scores, box scores, high-scoring games, 70-point games, 25+ assist games
- `shot charts` (8) — three-point makes, corner threes, rim shots, shot distributions, team defense
- `play by play` (2) — made shots and turnovers in specific games
- `identity` (5) — BRef and NBA API ID lookups, unresolved/ambiguous bridge records
- `draft` (5) — first overall picks, draft comparisons, HOF draft classes
- `basketball reference` (5) — BRef-specific totals, advanced stats, shooting data
- `api schema` (5) — API schema game logs, shot charts, standings, franchise leaders
- `data quality` (5) — audit schema checks, row counts, key candidates, bridge quality
- `cross schema` (5) — cross-checks between main and unified_star

Type: `NbaEvalQuery { id, category, question, expectedTools?, expectNoSqlError? }`

#### Question Matrix (`question-matrix.ts`)
`QUESTION_MATRIX: EvalQuestion[]` — 30 questions across 4 behavioral tiers:

| Tier | Questions | Behavior | Expected Pattern |
|------|-----------|----------|-----------------|
| `simple` | 8 | Direct single-fact lookups | Exact entity or number |
| `multi-step` | 8 | Comparisons or derived facts | Multiple IDs, answer requires synthesis |
| `vague` | 7 | Ambiguous/unclear questions | Must return `CLARIFICATION_NEEDED` |
| `overly-specific` | 7 | Data not in database | Must return `DATA_NOT_AVAILABLE` |

Type: `EvalQuestion { id, tier, question, expectedAnswer, groundTruthIds[], expectedClarification, maxToolCalls, tolerance? }`

### Ground Truth

#### BBR Truth (`bbrTruth.ts`)
- Reads `bbr-truth.json` (values scraped live from basketball-reference.com, NBA-only)
- `resolveBbrValue(id)` — resolves a `groundTruthId` to `{ supported, verified, value, extra, asOf, source }`
- Supported ID shapes:
  - `career_<stat>_leaders.<rank>` → player name at that rank
  - `player_career_totals.<Player>.<stat>` → career total value
  - `mvp_winners.<season>` → MVP winner name | `mvp_winners.<Player>` → MVP count
  - `team_records.<Team_Year>` → `"W-L"` string
  - `season_leaders_2024.<stat>.<rank>` → leader name
  - `single_games.2016_finals_game7[.leading_scorers]` → score or top scorer
- `verified: true` entries are the authoritative anchor for data-quality verdicts
- Unverified entries fall back to agent-vs-test comparison only

#### DB Truth (`dbTruth.ts`)
- Deterministic SQL resolvers (NOT through the agent) — runs canonical SQL directly on the DuckDB
- `resolveDbValue(id)` — returns `{ supported, value, sql, error? }`
- Supports the same ID shapes as `bbrTruth.ts` plus `single_games.*`
- Uses `main.fact_bref_player_season_totals` for career totals (with `team NOT LIKE '%TM%'` and `is_playoffs = false` filter)
- Uses `main.fact_player_award_vote` for MVP resolutions
- Uses `main.fact_bref_team_season_summary` for team records
- Uses `api.v_season_leaders` for season leader lookups
- Team abbreviation mapping for record queries (e.g., `Boston_Celtics` → `'BOS'`)

#### BBR Player Parser (`bbrPlayerParser.ts`)
- `parseBbrCareerTotals(html, league?)` — Extracts career totals from BBR player-page HTML using cheerio
- Handles both legacy (`table#totals`) and current (`table#totals_stats`) table formats
- Walks `<tfoot>` rows looking for "Career" or "`<N> Yrs`" label, skipping "82 Game Avg" and team-split rows
- Data-stat aliases: `{ games: ['games', 'g'], points: ['pts'], rebounds: ['trb'], assists: ['ast'], steals: ['stl'], blocks: ['blk'] }`
- Parses `CareerTotals: { games, points, rebounds, assists, steals, blocks }`

### Harness (`matrixHarness.ts`)

**Self-contained eval runner** — CLI entry point (`bun run src/tabs/chatbot/eval/matrixHarness.ts`):

1. Reads env: `RUNS_PER_QUESTION` (default 1), `QUESTION_LIMIT`, `RUN_TIMEOUT_MS` (90s), `MAX_TOOL_CALLS` (12), `LOG_DIR`
2. Initializes DuckDB via `initDb()`
3. Builds system prompt with `TEST_MODE_SUFFIX` appended
4. For each question in `QUESTION_MATRIX`:
   - Runs agent via `streamQuery()` with timeout race
   - `classify()` — determines verdict based on tier:
     - Vague: check for `?` + clarification keywords
     - Over-specific: check for "not available" patterns
     - Factual: attach BBR truth values
   - `finalizeFactual()` — attaches DB comparisons, determines agent_bug vs data_quality
   - Writes JSONL result and updates summary
5. Aggregates results by verdict and tier, identifies stale tests and data-quality issues
6. Writes `summary.json` to `LOG_DIR/matrix-<timestamp>/`
7. Exits with code 1 on failures (when `EXIT_NONZERO_ON_FAIL=1`)

**Comparison utilities:**
- `norm(s)` — lowercase + strip diacritics + collapse whitespace
- `containsToken(haystack, needle)` — fuzzy token matching, handles digit separators
- `valuesMatch(x, y, tol?)` — fuzzy comparison with tolerance (for numeric values)
- `numbersMatch(a, b, tol?)` — numeric tolerance matcher

### Iterate Questions (`iterate-questions.ts`)
- Loads `iterate-questions.json` as typed `Question[]` array
- Defines `Tier` (16 values), `ExpectedKind` (9 values), `ValidationConfig`, `SourceMetadata`, `QuestionMetadata` types
- Legacy question set used by `scripts/eval/iterate-loop.ts`

### Barrel (`index.ts`)
- Re-exports: `bbrPlayerParser`, `bbrTruth`, `dbTruth`, `nba-100-queries`, `question-matrix`

## Flow

```
matrixHarness.ts main()
  │
  ├── initDb() + buildSystemPrompt()
  │
  ├── for each question × RUNS_PER_QUESTION:
  │   ├── runAgent() → streamQuery() with timeout
  │   ├── classify() → attach BBR values
  │   ├── resolveDbValue() for each groundTruthId
  │   ├── finalizeFactual() → verdict
  │   └── append to JSONL
  │
  ├── compute rollups byVerdict, byTier
  ├── detect stale tests (matrixExpected ≠ BBR)
  ├── detect data quality issues (DB ≠ BBR)
  └── write summary.json
```

## Integration

### Consumes
- `../agent/graph.js` — `resetGraph()`
- `../agent/streaming.js` — `streamQuery()`
- `../db.js` — `initDb()`, `closeDb()`
- `../openrouter.js` — `getModel()`
- `../systemPrompt.js` — `buildSystemPrompt()`
- `./bbrTruth.js` — `resolveBbrValue()`
- `./dbTruth.js` — `resolveDbValue()`
- `./question-matrix.js` — `QUESTION_MATRIX`, `EvalQuestion`
- `bbr-truth.json` — scraped BBR truth data
- `iterate-questions.json` — legacy question data

### Exported via package.json subpath export
- `data/tabs/chatbot/eval` → `./src/tabs/chatbot/eval/index.ts`

### Consumers
- **`scripts/eval/chatbot-smoke.ts`** — smoke test runner importing from eval
- **`scripts/eval/iterate-loop.ts`** — legacy iteration harness
