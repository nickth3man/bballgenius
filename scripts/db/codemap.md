# scripts/db/

## Responsibility

Owns the **warehouse operations layer** for `data/nba.duckdb`: data-quality (DQ) verification suites, cross-source accuracy framework, entity-resolution (xref) layer, golden-record merge views, source registry, metric catalog, staging quarantine, and pipeline orchestration. All scripts are `bun run` executables that connect via `@duckdb/node-api` with `fromCache` and call `CHECKPOINT` after writes.

Does **not** touch runtime (`packages/data/`) or UI (`packages/web/`). Child codemap at `sources/codemap.md`.

---

## Groups

### 1. DQ Core Framework

| File | Role |
|------|------|
| `dq-core.ts` | Shared primitives: `CheckSpec`/`Outcome` types, `runCountChecks()`, `persistResults()`, `printReport()`, `applyGate()`, SQL builders (`violations`, `duplicateGrain`, `orphans`, `requiredColumns`). All DQ verification scripts import from here. Writes to `audit.dq_results`. |

### 2. DQ Verification Suites (internal consistency)

| File | Phase | Scope |
|------|-------|-------|
| `verify-dq.ts` | Single-table | ~60 checks on `nbadb` star tier: uniqueness (grain dupes), referential integrity (orphan FKs), consistency (made≤attempted, reb=oreb+dreb, pts formula), validity (percentages in [0,1], `season_year` format), completeness (required keys non-null). |
| `verify-cross-table.ts` | Cross-table | Box-score summation (player→team), aggregate continuity (game logs→season totals), record vs standings, agg_season total_× vs avg_××gp. Writes offending keys to `audit.cross_table_discrepancy`. |
| `verify-advanced-recompute.ts` | Recompute | Recomputes eFG%, TS%, USG% from raw box-score columns in `main.fact_player_game_stats`. Writes mismatches to `audit.advanced_stat_recompute`. Per-metric tolerance overridable via `--tol-<metric>=`. |
| `verify-historical.ts` | Boundary scan | NBA rule timeline checks (pre-1979 3PT, pre-1973 blk/stl) and player bio sanity (draft age, height/weight bounds). |
| `verify-dq-fixture.ts` | CI smoke | Lightweight check that the committed CI fixture (`data/fixtures/nba.ci.duckdb`) has required tables, non-empty dims, unique games, and no orphan regressions. |
| `dq-trend.ts` | Trend analysis | Queries `audit.dq_results` history for 7d/30d averages, trend direction, and regression detection. Exit non-zero on degrading CRITICAL checks. |

### 3. DQ Remediation

| File | Action |
|------|--------|
| `remediate-phase1-dq.ts` | Fixes impossible shot counts (make>attempt → null), rebound splits (null when oreb+dreb≠reb), swapped period components in `fact_game_result`, All-Star game `season_year` mis-parsed as 20xx. Inserts placeholder dim rows for special-event/international teams and orphan players. |
| `backfill-dimension-placeholders.ts` | Finds team_ids/player_ids referenced in facts but missing from dims, logs to `audit.placeholder_backfill_log`, inserts unnamed placeholder rows. |
| `backfill-bref-person-id.ts` | Propagates already-resolved xref `bref->master_id` mappings into `main.fact_bref_player_season_totals.person_id` where NULL (deterministic, 1:1 only). |

### 4. Accuracy / Cross-Source Verification

| File | Role |
|------|------|
| `accuracy.ts` | Core engine: `AccuracyCheck` type, `compareActual()` with 5 modes (exact/gte/lte/range/approx), `parseBbrCareerTotals()` (cheerio parser on BBR totals table), `buildCareerChecks()`, `parseBbrDraftPick()`, `buildDraftCheck()`. |
| `accuracy.test.ts` | Unit tests for accuracy.ts (check loader, BBR HTML parsing, check builder). |
| `verify-accuracy.ts` | Runs the JSON accuracy-check suite (`accuracy-checks.json`) against the DB. Prints PASS/FAIL per check with expected vs actual. |
| `fetch-accuracy-sources.ts` | Firecrawl CLI wrapper that scrapes BBR player pages, generates candidate accuracy checks from career-totals tables + draft meta, validates against DB, optionally appends passing candidates to `accuracy-checks.json`. |
| `classify-accuracy-discrepancies.ts` | Classifies `audit.metric_discrepancy` rows into *known_divergence* (documented source-rule variance e.g. pre-1974 ORB/DRB) vs *genuine_defect_candidate*. Writes 3-class classification surface + run summary. |
| `oracle-resolve-discrepancies.ts` | Queue-driven Firecrawl oracle. Reads HIGH genuine-defect candidates, resolves via xref to BBR slugs, scrapes BBR pages to `.firecrawl/oracle/`, logs to `audit.oracle_resolution`. Currently always empty (zero discrepancies). |
| `accuracy-checks.json` | Hand-curated JSON check definitions (79+ checks: career totals, draft picks, season milestones). |
| `accuracy-candidates.generated.json` | Auto-generated passing candidates from `fetch-accuracy-sources.ts`. |
| `bbr-accuracy-players.json` | BBR player seed list for the source fetcher. |

### 5. Golden-Record Merge Views

| File | View Created | Sources Merged |
|------|-------------|----------------|
| `build-player-season-3p-unified-view.ts` | `api.v_player_season_3p_unified` | `main.fact_bref_player_season_totals` × `nbadb.fact_player_career` via `main.bridge_player_source_id` (3PM canary). |
| `build-canonical-merge.ts` | `api.v_golden_player_season_totals` | BBR × NBA for 17 counting stats. BBR wins by precedence. Disagreements written to `audit.metric_discrepancy`. |
| `build-canonical-merge-game.ts` | `api.v_golden_player_game` | NBA-only (no BBR game-level table). Single-source golden record. |
| `build-canonical-merge-team.ts` | `api.v_golden_team_season` | BBR team totals+summary × NBA aggregated team games. Joined via `xref.team_xref`. |
| `build-canonical-views.ts` | `api.v_canonical_*` (5 views) | Column-renaming views mapped through `meta.stat_crosswalk` (source→canonical stat rename). Non-destructive; coexists with golden views. |

### 6. Cross-Reference & Entity Resolution

| File | Phase | Function |
|------|-------|----------|
| `build-xref.ts` | Phase 2 | Seeds `xref.{player,team,game,official}_xref` from `unified_star` master dims. Replays `xref.match_override` manual fixes. Validates 1:1 invariant per (source, key). |
| `resolve-entities.ts` | Phase 3 | Generic player entity resolution for *new* sources (ESPN, Spotrac). 3-tier matching: exact (name+DOB) → destripped → fuzzy (jaro_winkler, birth-date gated). Writes matches to `xref.player_xref`, misses to `xref.player_unresolved`, near-misses to `audit.match_candidates`. |
| `onboard-espn-sample.ts` | Phase 6 | Lands `sources/espn_player_sample.csv` into `raw_espn.player` as an acceptance test for the onboarding path. |
| `verify-xref-coverage.ts` | — | Checks every source's raw-table IDs have mappings in xref tables. Gated on HIGH. |

### 7. Source Registry & Metric Catalog

| File | Function |
|------|----------|
| `build-source-registry.ts` | Phase 1. Loads TypeScript source manifests (`sources/`) into `meta.source` and `meta.source_entity`. Validates every declared raw-table column against the live catalog. Derives `meta.source_column_map` from `meta.stat_crosswalk`. |
| `sync-crosswalk-to-db.ts` | Syncs `master-stat-crosswalk.csv` → `meta.stat_crosswalk`. Creates `meta.v_column_semantic_catalog` and `meta.v_unmapped_columns`. Supports `--check-drift` for read-only drift reporting. |
| `extend-master-stat-crosswalk.ts` | Adds advanced-stat column mappings (e_off_rating, e_def_rating, pct_ast, etc.) to the crosswalk CSV. Can apply DuckDB `COMMENT ON COLUMN` via `--apply-comments`. |
| `build-canonical-metric-registry.ts` | Phase 4. From the crosswalk, creates `meta.canonical_metric` (one row per canonical stat), `meta.metric_source_authority` (per-metric×source precedence+tolerance), and `meta.canonical_metric_proposal` (auto-classified unmapped columns for review). |
| `verify-meta-schema.ts` | Validates expected meta tables, canonical views, and indexes exist and are queryable. |

### 8. Staging / Quarantine

| File | Function |
|------|----------|
| `validate-staging-fk.ts` | Pre-ingest FK validation. Checks `stg_*` tables for orphan FKs against parent staging tables. Supports `--quarantine` mode that moves orphans into `stg_*.quarantine_*` tables. Exit non-zero when CRITICAL orphan rate exceeds threshold (default 0.1%). |
| `quarantine-review.ts` | Interactive review of quarantine tables. Supports actions: `review` (default, show stats+sample), `promote` (insert back to source table), `purge` (delete older than N days), `export` (CSV dump). Logs to `audit.quarantine_review_log`. |

### 9. Pipeline Orchestration

| File | Function |
|------|----------|
| `run-dq-pipeline.ts` | Orchestrates 12 stages as child processes in dependency order: validate-staging-fk → backfill-dimension-placeholders → build-xref → resolve-entities → verify-xref-coverage → build-canonical-merge (×3) → verify-dq → verify-cross-table → verify-advanced-recompute → verify-historical. Aborts on critical-failure. Logs to `data/pipeline-run-log.jsonl`. |

### 10. Source Manifests (`sources/` subdirectory)

See `sources/codemap.md`. Declares source metadata (trust tier, entity grains, natural/blocking keys) for bref, nba_api_sqlite, nba_stats, and espn. Used by `build-source-registry.ts`.

---

## Flow

```
┌─────────────────────────────────────────────────────────────┐
│                   PIPELINE (run-dq-pipeline.ts)              │
│                                                              │
│  1. validate-staging-fk ─── pre-ingest FK gate (stg→stg)     │
│  2. backfill-dimension-placeholders ─── fix orphan FKs       │
│  3. build-xref ─── seed xref from unified_star dims          │
│  4. resolve-entities ─── tiered match for new sources        │
│  5. verify-xref-coverage ─── gate on unmapped source IDs     │
│  6. build-canonical-merge (×3) ─── golden-record views       │
│     ├── build-canonical-merge.ts       (player-season)       │
│     ├── build-canonical-merge-game.ts  (player-game)         │
│     └── build-canonical-merge-team.ts  (team-season)         │
│  7. DQ gates (verify-dq, verify-cross-table,                 │
│     verify-advanced-recompute, verify-historical)            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              SOURCE ONBOARDING (new source path)             │
│                                                              │
│  * source.manifest.ts (sources/)                             │
│  → build-source-registry.ts ─── validate + persist meta      │
│  → resolve-entities.ts (3-tier match)                        │
│  → build-xref.ts (replay to xref layer)                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              ACCURACY / CROSS-SOURCE                         │
│                                                              │
│  accuracy-checks.json ──→ verify-accuracy.ts                 │
│  bbr-accuracy-players.json ──→ fetch-accuracy-sources.ts     │
│  build-canonical-merge.ts ──→ audit.metric_discrepancy       │
│    → classify-accuracy-discrepancies.ts                      │
│    → oracle-resolve-discrepancies.ts (queue-driven)          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              CROSSWALK → METRIC CATALOG                     │
│                                                              │
│  master-stat-crosswalk.csv                                   │
│  → sync-crosswalk-to-db.ts ― meta.stat_crosswalk             │
│    → v_column_semantic_catalog, v_unmapped_columns           │
│  → extend-master-stat-crosswalk.ts (add advanced stats)      │
│  → build-canonical-metric-registry.ts                        │
│    → meta.canonical_metric                                   │
│    → meta.metric_source_authority                            │
│    → meta.canonical_metric_proposal                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Integration

- **DB schemas read/written**: `nbadb`, `unified_star`, `main`, `stg_*`, `raw_*`, `xref`, `meta`, `audit`, `api`
- **Primary output tables**:
  - `audit.dq_results` — DQ check history (all verify-* scripts write here)
  - `audit.cross_table_discrepancy` — cross-table mismatch keys
  - `audit.advanced_stat_recompute` — recompute mismatch rows
  - `audit.metric_discrepancy` — cross-source value disagreements (from golden merges)
  - `audit.xref_coverage` — xref build coverage snapshot
  - `audit.placeholder_backfill_log` — placeholder dim row insertions
  - `audit.match_candidates` — fuzzy-resolve near-misses
  - `audit.discrepancy_known_divergence` — documented source-rule variances
  - `audit.metric_discrepancy_classification` — 3-way classification surface
  - `audit.oracle_resolution` — Firecrawl scrape artifacts
  - `audit.quarantine_review_log` — quarantine action history
  - `xref.{player,team,game,official}_xref` — entity cross-reference
  - `meta.{source,source_entity,source_column_map,stat_crosswalk,canonical_metric,metric_source_authority,canonical_metric_proposal}`
  - `api.v_golden_*` — canonical merge views consumed by `packages/data/src/tabs/`
  - `api.v_canonical_*` — column-renaming views through `meta.stat_crosswalk`
- **CI integration**: `verify-dq-fixture.ts` runs in Actions against `data/fixtures/nba.ci.duckdb`; `verify-meta-schema.ts` validates meta layer is intact.
- **Downstream consumption**: `api.v_golden_*` and `api.v_canonical_*` views queried by `packages/data/src/tabs/` runtime code. `xref` and `meta` schemas underpin the chatbot's entity-aware query engine.
- **Crosswalk CSV** (`master-stat-crosswalk.csv`) is the system-of-record for column→concept mapping; `sync-crosswalk-to-db.ts` propagates it to DuckDB. All four crosswalk scripts (`sync-crosswalk-to-db.ts`, `extend-master-stat-crosswalk.ts`, `build-source-registry.ts`, `build-canonical-metric-registry.ts`) participate in the crosswalk→catalog pipeline.
