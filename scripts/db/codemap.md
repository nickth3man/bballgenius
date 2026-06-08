# `scripts/db/`

## Responsibility
DuckDB Warehouse Tooling — the main data quality assurance, cross-source reconciliation, canonical view/materialization, and warehouse maintenance suite for the NBA medallion-architecture database.

## Design

### DuckDB Scripting Conventions
All scripts follow consistent patterns:
- **Connection**: `const db = await DuckDBInstance.fromCache(DB_PATH); const conn = await db.connect();` — uses `fromCache` for read-only singleton access.
- **DB path**: `process.env['NBA_DUCKDB_PATH'] ?? './data/nba.duckdb'` — configurable via env var.
- **CHECKPOINT after writes**: `await conn.run('CHECKPOINT')` flushes the WAL to avoid cross-process replay bugs on Windows.
- **Query helper**: `const q = async (sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJson();`
- **Dry run pattern**: `--apply` flag gates writes; default is dry-run with read-only validation.

### CLI Pattern
All verification/build scripts accept:
- `--dry-run` / no flag = read-only validation (default).
- `--apply` = persist changes to DB.
- `--filter=<substring>` = subset checks by name.
- `--gate=<SEVERITY>` = fail the process on violations at or above this level (default: CRITICAL).

### Shared DQ Core (`dq-core.ts`)
Central module imported by 4+ verification scripts:
- **`CheckSpec` interface**: `name`, `table`, `severity`, `dimension`, `rule`, `countSql`.
- **Check builders**: `violations()`, `duplicateGrain()`, `orphans()`, `requiredColumns()`.
- **Runner**: `runCountChecks()` executes each check's `countSql` and captures errors.
- **Persistence**: `persistResults()` writes to `audit.dq_results` table with a shared `runId` timestamp.
- **Gating**: `applyGate()` filters outcomes by severity rank, sets `process.exitCode = 1` on failures at or above gate level.
- **Severity ladder**: CRITICAL > HIGH > MEDIUM > LOW > INFO.

### Cross-Source Reconciliation Pipeline (Phased Plan)
The scripts implement a documented 6-phase plan (see `.claude/plans/i-would-like-to-serialized-lake.md`):

| Phase | Script(s) | Output |
|-------|-----------|--------|
| 0 | `sync-crosswalk-to-db.ts` | `meta.stat_crosswalk` table from CSV, `meta.v_column_semantic_catalog`, `meta.v_unmapped_columns` |
| 1 | `build-source-registry.ts` | `meta.source`, `meta.source_entity`, `meta.source_column_map` |
| 2 | `build-xref.ts` | `xref.*_xref` tables (player, team, game, official) seeded from `unified_star` dims |
| 3 | `resolve-entities.ts` | Generic entity resolution for new sources (e.g. ESPN) via deterministic + fuzzy matching |
| 4 | `build-canonical-metric-registry.ts` | `meta.canonical_metric`, `meta.metric_source_authority`, `meta.canonical_metric_proposal` |
| 5 | `build-canonical-merge.ts` + `build-canonical-merge-game.ts` + `build-canonical-merge-team.ts` | `api.v_golden_player_season_totals`, `api.v_golden_player_game`, `api.v_golden_team_season` views + `audit.metric_discrepancy` rows |
| 6 | `onboard-espn-sample.ts` | Acceptance test: end-to-end source onboarding |

### Verification Suites (DQ Pipeline)

| Suite | Script | Focus | Tables Checked |
|-------|--------|-------|----------------|
| Internal consistency | `verify-dq.ts` | Uniqueness, referential integrity, consistency, validity, completeness | `nbadb.fact_player_game_traditional`, `fact_team_game`, `fact_game_result`, dim tables |
| Cross-table | `verify-cross-table.ts` | Box-score summation, aggregate continuity, record vs standings | Multiple `nbadb` tables, `unified_star.fact_player_season_stats`, `main.fact_bref_team_season_summary` |
| Advanced recompute | `verify-advanced-recompute.ts` | eFG%, TS%, USG% recomputed from raw stats vs stored values | `main.fact_player_game_stats` (~1.67M rows) |
| Historical boundary | `verify-historical.ts` | NBA rule timelines (3pt pre-1979, blk/stl pre-1973), player bio sanity | `nbadb.fact_player_game_traditional`, `main.dim_player` |
| Xref coverage | `verify-xref-coverage.ts` | Source IDs mapped in xref layer across raw tables | `xref.*_xref`, `raw_bref.*`, `raw_sqlite.*`, `raw_espn.*` |
| DQ trend | `dq-trend.ts` | Historical analysis of `audit.dq_results` over time | `audit.dq_results` |
| Fixture smoke | `verify-dq-fixture.ts` | Lightweight check for CI fixture (table existence, grain, FK contracts) | `main.*` tables in CI fixture |
| Meta schema | `verify-meta-schema.ts` | Validates expected meta tables, views, and indexes exist and are queryable | `meta.*`, `api.*` catalog objects |

### Remediation & Maintenance Scripts

| Script | Purpose |
|--------|---------|
| `remediate-phase1-dq.ts` | Curated-layer data fixes: nulls impossible shot attempts, fixes swapped period components, inserts placeholder dimension rows for special-event teams |
| `backfill-dimension-placeholders.ts` | Finds orphan team_ids/player_ids in fact tables, captures violating keys to audit, inserts placeholder dim rows |
| `backfill-bref-person-id.ts` | Propagates resolved xref identities to `fact_bref_player_season_totals.person_id` where NULL |
| `quarantine-review.ts` | Review/resolve quarantined staging rows — supports review, promote, purge, export actions |
| `classify-accuracy-discrepancies.ts` | 3-way classification of cross-source disagreements (agree, known_divergence, genuine_defect_candidate) |
| `oracle-resolve-discrepancies.ts` | Firecrawl oracle for unresolved discrepancy candidates (currently empty queue) |
| `validate-staging-fk.ts` | Pre-ingest FK validation — report or quarantine orphan rows |
| `build-player-season-3p-unified-view.ts` | Canary cross-source 3PM merge (predecessor to phase 5 golden record) |
| `build-canonical-views.ts` | Creates `api.v_canonical_*` views from `meta.stat_crosswalk` mapping |
| `sync-crosswalk-to-db.ts` | Syncs `master-stat-crosswalk.csv` into `meta.stat_crosswalk`, validates no drift |
| `extend-master-stat-crosswalk.ts` | Programmatically add column mappings to the CSV crosswalk (e.g., advanced metrics) |
| `fetch-accuracy-sources.ts` | Firecrawl-backed BBR source fetcher for accuracy check generation |
| `accuracy.ts` | Core accuracy check types, BBR page parser (cheerio), check builder, comparison logic |

### Accuracy Verification
- **`accuracy-checks.json`**: JSON manifest of ~80+ known-value checks (career totals, season leaders) with expected values, comparison mode (exact/gte/lte/range/approx), and source attribution.
- **`accuracy.test.ts`**: Bun tests for `accuracy.ts` functions (loader, BBR parser, check builder, draft pick parser).
- **`verify-accuracy.ts`**: Runner that executes all checks against the live DB and reports pass/fail.
- **`fetch-accuracy-sources.ts`**: Generates new checks from Firecrawl-scraped BBR player pages.
- **`bbr-accuracy-players.json`**: Seed list of players for BBR accuracy check generation.

### DQ Pipeline Orchestrator (`run-dq-pipeline.ts`)
Sequential runner that executes stages in dependency order as child processes (`bun run <script>`):
1. validate-staging-fk (critical)
2. backfill-dimension-placeholders
3. build-xref (critical)
4. resolve-entities (espn)
5. verify-xref-coverage (critical)
6. build-canonical-merge
7. build-canonical-merge-game
8. build-canonical-merge-team
9. verify-dq (critical)
10. verify-cross-table
11. verify-advanced-recompute
12. verify-historical

Stages marked `critical` abort the pipeline on failure. Results logged to `data/pipeline-run-log.jsonl`. Supports `--apply` and `--dry-run`.

## Flow

```
── BUILD PIPELINE ──
  master-stat-crosswalk.csv
    → sync-crosswalk-to-db.ts       → meta.stat_crosswalk, meta.v_* views
    → extend-master-stat-crosswalk.ts (optional)
    → build-canonical-views.ts      → api.v_canonical_* views
    → build-source-registry.ts      → meta.source + meta.source_entity (from sources/)
    → build-xref.ts                 → xref.*_xref tables (seeded from unified_star)
    → resolve-entities.ts           → xref.player_xref (new sources)
    → build-canonical-metric-registry.ts  → meta.canonical_metric + metric_source_authority
    → build-canonical-merge.ts      → api.v_golden_player_season_totals + audit.metric_discrepancy
    → build-canonical-merge-game.ts  → api.v_golden_player_game
    → build-canonical-merge-team.ts  → api.v_golden_team_season
    → classify-accuracy-discrepancies.ts  → audit.accuracy_run_summary

── DQ PIPELINE (run-dq-pipeline.ts) ──
  1. validate-staging-fk
  2. backfill-dimension-placeholders
  3. build-xref
  4. resolve-entities
  5. verify-xref-coverage
  6. build-canonical-merge
  7. build-canonical-merge-game
  8. build-canonical-merge-team
  9. verify-dq
  10. verify-cross-table
  11. verify-advanced-recompute
  12. verify-historical

── ACCURACY ──
  BBR player pages (Firecrawl)
    → fetch-accuracy-sources.ts    → accuracy-candidates.generated.json
    → verify-accuracy.ts           → pass/fail report
```

## Integration
- **Consumed by**: `packages/data` runtime code reads `api.v_golden_*` views, `xref.*` tables, and `meta.*` registry.
- **Invoked via**: `bun run dq`, `bun run dq:*` aliases in root `package.json` (verify-dq, cross-table, recompute, historical, etc.).
- **Data sources**: `data/nba.duckdb` (production), `data/fixtures/nba.ci.duckdb` (CI).
- **No external API dependencies**: Except `fetch-accuracy-sources.ts` and `oracle-resolve-discrepancies.ts` which require Firecrawl CLI.
