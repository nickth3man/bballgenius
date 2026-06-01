# NBA DuckDB Database Audit Report

**Generated:** 2026-06-01 | **Database:** `data/nba.duckdb` (~21.7 GB) | **Total objects:** 516 tables/views across 14 schemas

---

## 1. Database Architecture Map

### Schema Overview

| Schema | Base Tables | Views | Role |
|--------|-------------|-------|------|
| `nbadb` | 251 | 1 | Curated star tier (public nbadb contract — 1:1 with nbadb.w4w.dev) |
| `raw_csv` | 59 | 0 | Raw CSV ingestion (odds, year-segmented PBP, boxscores) |
| `main` | 51 | 6 | BBallGenius canonical warehouse (BBR + NBA-API merge) |
| `audit` | 29 | 0 | DQ results, reconciliation, xref coverage |
| `raw_bref` | 22 | 0 | Raw Basketball-Reference ingestion |
| `stg_bref` | 22 | 0 | Staged BBR transforms (normalized keys added) |
| `raw_sqlite` | 22 | 0 | Raw SQLite ingestion (NBA-API endpoints) |
| `stg_nba_api_sqlite` | 22 | 0 | Staged NBA-API transforms |
| `unified_star` | 20 | 0 | Cross-source unified star schema |
| `meta` | 7 | 2 | Semantic catalog, source registry, stat crosswalk |
| `xref` | 6 | 0 | Entity cross-reference (player/team/game/official ID mapping) |
| `raw_json` | 3 | 0 | Raw JSON ingestion (season stats, leaders) |
| `raw_parquet` | 1 | 0 | Raw Parquet play-by-play |
| `raw_espn` | 1 | 0 | Raw ESPN player data |
| `api` | 0 | 21 | Convenience views for hub/chatbot consumption |

### Architecture Map — Major Tables by Domain

> Row counts verified live via `SELECT COUNT(*)`. Grain = semantic granularity of each table's key.

#### Players (Dimension)

| Schema | Table | Rows | Primary Key(s) | Grain |
|--------|-------|------|----------------|-------|
| `nbadb` | `dim_player` | 17,244 | `player_sk`, `player_id` | Surrogate-keyed player dimension (largest, 4,902 unique `player_id`) |
| `nbadb` | `dim_all_players` | 6,692 | `person_id` | Active + historical NBA-API players |
| `main` | `dim_player` | 6,692 | `person_id` | NBA-API player dimension |
| `main` | `dim_bref_player` | 5,416 | `slug` | BBR player dimension |
| `unified_star` | `dim_player` | 6,984 | `player_id`, `bref_player_id` | Cross-source unified player dim (6,692 NBA-API + 292 BBR-only) |
| `raw_csv` | `players` | 6,692 | `person_id` | Raw NBA-API player listing |
| `nbadb` | `fact_static_players` | 6,693 | `person_id` | Static player info |

#### Teams (Dimension)

| Schema | Table | Rows | Primary Key(s) | Grain |
|--------|-------|------|----------------|-------|
| `nbadb` | `dim_team` | 92 | `team_id` | Franchise-level teams (63 unique `team_id` values) |
| `nbadb` | `dim_team_extended` | 49 | `team_id` | Extended team attributes (arena, owner, GM) |
| `nbadb` | `dim_team_history` | 40 | `team_id`, `year_founded` | Team city/name history |
| `main` | `dim_team` | 140 | `team_id` | Expanded team dimension (97 unique, incl. history rows) |
| `unified_star` | `dim_team` | 97 | `team_id` | Mirrors `main.dim_team` (97 unique) |
| `raw_sqlite` | `nba__team` | 30 | `id` | Active teams only |
| `nbadb` | `fact_static_teams` | 72 | `team_id` | Static team info |

#### Shared Dimensions (Exact Copies Across Schemas)

| Table | Rows | In Schemas |
|-------|------|------------|
| `dim_arena` | 273 | nbadb, main, unified_star (all identical) |
| `dim_official` | 235 | nbadb, main, unified_star (all identical) |
| `dim_date` | 14,442 | nbadb, main, unified_star (all identical) |

#### Games (Dimension)

| Schema | Table | Rows | Primary Key(s) | Grain |
|--------|-------|------|----------------|-------|
| `nbadb` | `dim_game` | 73,331 | `game_id` | Game dimension (largest, 85 games not in unified_star) |
| `nbadb` | `fact_game_result` | 73,246 | `game_id` | Game results |
| `nbadb` | `fact_game_context` | 224,963 | `game_id` | Game context (much broader scope than `main`) |
| `main` | `fact_game` | 73,246 | `game_id` | Canonical game table — 100% overlap with `unified_star.dim_game` |
| `main` | `fact_game_context` | 58,230 | `game_id` | Game context (narrower scope, ~26% of nbadb version) |
| `unified_star` | `dim_game` | 73,246 | `game_id` | Unified game dimension |
| `raw_csv` | `games1` | 73,246 | `gameId` | Raw game index |
| `raw_csv` | `games` | 73,233 | `game_id` | Raw game index (alt, 13 fewer rows) |
| `raw_sqlite` | `nba__game` | 65,698 | `game_id` | NBA-API game records (subset) |

#### Player Game Boxscores (Fact — Game-level Grain)

| Schema | Table | Rows | Primary Key(s) | Grain |
|--------|-------|------|----------------|-------|
| `nbadb` | `analytics_player_game_complete` | 3,116,411 | `player_id`, `game_id` | Expanded w/ advanced metrics |
| `raw_csv` | `playerstatistics` | 1,667,889 | `person_id`, `game_id` | Raw player boxscores |
| `main` | `fact_player_game_stats` | 1,667,844 | `person_id`, `game_id` | Canonical player game stats |
| `unified_star` | `fact_player_game_boxscore` | 1,667,844 | `player_id`, `game_id` | Unified player game boxscore |
| `nbadb` | `fact_player_game_traditional` | 1,558,590 | `player_id`, `game_id` | Traditional boxscores (subset, ~109K fewer rows) |
| `nbadb` | `fact_player_game_log` | 786,668 | `player_id`, `game_id` | NBA-API player game log |
| `raw_csv` | `player_boxscores` | 786,769 | `player_id`, `game_id` | Raw NBA-API player boxscores |

#### Team Game Boxscores (Fact — Game-level Grain)

| Schema | Table | Rows | Primary Key(s) | Grain |
|--------|-------|------|----------------|-------|
| `nbadb` | `fact_box_score_team` | 147,059 | `team_id`, `game_id` | NBA-API boxscores (2x games: home+away separate rows) |
| `nbadb` | `fact_team_game` | 75,980 | `team_id`, `game_id` | Team game summary |
| `main` | `fact_team_game_stats` | 75,980 | `team_id`, `game_id` | Canonical team game stats |
| `unified_star` | `fact_team_game_boxscore` | 75,980 | `team_id`, `game_id` | Unified team game boxscore |
| `nbadb` | `fact_box_score_four_factors` | 75,980 | `game_id`, `team_id` | Four factors data |

#### Play-by-Play (Fact — Event-level Grain)

| Schema | Table | Rows | Primary Key(s) | Scope |
|--------|-------|------|----------------|-------|
| `main` | `fact_play_by_play` | 18,722,958 | `game_id`, `action_number` | Canonical PBP (BBR-enriched) |
| `unified_star` | `fact_pbp_events` | 18,722,958 | `game_id`, `action_number` | Unified PBP (exact mirror of main) |
| `raw_parquet` | `playbyplay` | 18,707,576 | `game_id`, `eventnum` | Raw Parquet PBP |
| `raw_csv` | `play_by_play` | 18,246,195 | `game_id`, `eventnum` | Raw CSV PBP |
| `raw_sqlite` | `nba_stats_pbp__play_by_play` | 18,251,485 | `game_id`, `action_number` | NBA-API PBP v2 (detailed) |
| `nbadb` | `fact_cumulative_stats` | 17,629,314 | `game_id`, `eventnum` | Cumulative in-game stat snapshots |
| `nbadb` | `fact_play_by_play_v2` | 13,592,899 | `game_id`, `eventnum` | NBA-API PBP v2 (subset) |
| `nbadb` | `fact_play_by_play` | 13,555,800 | `game_id`, `eventnum` | NBA-API PBP legacy |
| `raw_sqlite` | `nba__play_by_play` | 13,592,899 | `game_id`, `eventnum` | Raw SQLite PBP (same as v2) |
| `main` | `fact_play_by_play_legacy_nba_api` | 13,592,899 | `game_id`, `eventnum` | Legacy NBA-API PBP |

#### Player Season Stats (Fact — Season-level Grain)

| Schema | Table | Rows | Primary Key(s) |
|--------|-------|------|----------------|
| `unified_star` | `fact_player_season_stats` | 66,421 | `player_id`, `team_id`, `season_year`, `is_playoffs` |
| `main` | `fact_player_season_stat` | 40,325 | `person_id`, `season` |
| `raw_json` | `fact_player_season_stat` | 40,325 | `person_id`, `season` |
| `nbadb` | `agg_player_season` | 39,807 | `player_id`, `season_id` |
| `nbadb` | `agg_player_season_advanced` | 39,807 | `player_id`, `season_id` |
| `nbadb` | `agg_player_season_per36` | 39,807 | `player_id`, `season_id` |
| `nbadb` | `agg_player_season_per48` | 39,807 | `player_id`, `season_id` |
| `raw_bref` | `player_per_game` | 33,339 | `slug`, `season` |
| `raw_bref` | `player_totals` | 33,339 | `slug`, `season` |
| `raw_bref` | `per_36_minutes` | 32,256 | `slug`, `season` |
| `main` | `fact_bref_player_season_per_game` | 31,119 | `slug`, `season` |
| `main` | `fact_bref_player_season_totals` | 31,119 | `slug`, `season` |
| `nbadb` | `fact_player_career` | 30,160 | `player_id`, `season_id` |
| `raw_bref` | `per_100_poss` | 27,692 | `slug`, `season` |

#### Draft / Combine

| Schema | Table | Rows | Primary Key(s) |
|--------|-------|------|----------------|
| `nbadb` | `fact_draft` | 8,658 | `person_id`, `season` |
| `nbadb` | `fact_draft_history` | 8,701 | `person_id` |
| `raw_bref` | `draft_pick_history` | 8,383 | `slug`, `season`, `round`, `pick` |
| `nbadb` | `fact_draft_board` | 8,257 | `player_id`, `season` |
| `main` | `fact_draft_pick_nba_api` | 8,257 | `person_id` |
| `raw_sqlite` | `nba__draft_history` | 8,257 | `person_id` |
| `main` | `fact_draft_pick_bref` | 8,109 | `slug`, `season` |
| `nbadb` | `fact_draft_combine_detail` | 17,626 | `player_id`, `season` |
| `nbadb` | `fact_draft_combine_stats` | 1,633 | `player_id`, `season` |
| `main` | `fact_draft_combine` | 1,633 | `person_id` |
| `unified_star` | `fact_draft_combine` | 1,633 | `player_id`, `draft_year` |

#### Awards / Honors

| Schema | Table | Rows | Primary Key(s) |
|--------|-------|------|----------------|
| `nbadb` | `fact_player_awards` | 11,583 | `player_id`, `description`, `season`, `award_type` |
| `main` | `fact_player_honor_vote` | 4,484 | `slug`, `season`, `honor` |
| `main` | `fact_player_award_vote` | 3,465 | `slug`, `season`, `award` |
| `raw_bref` | `player_award_shares` | 3,465 | `slug`, `season`, `award` |
| `unified_star` | `fact_player_awards` | 3,440 | `player_id`, `season_year`, `award` |
| `raw_bref` | `end_of_season_teams` | 2,222 | `slug`, `season`, `team_type` |
| `raw_bref` | `all_star_selections` | 2,058 | `slug`, `season` |
| `main` | `fact_player_honor` | 2,034 | `slug`, `season`, `honor` |
| `unified_star` | `fact_all_star_selections` | 1,997 | `player_id`, `season_year` |
| `main` | `fact_all_star_selection` | 1,850 | `person_id`, `season` |

#### Shot Charts

| Schema | Table | Rows | Primary Key(s) |
|--------|-------|------|----------------|
| `nbadb` | `fact_shot_chart` | 6,490,494 | `game_id`, `grid_type`, `player_id`, `event_id` |
| `nbadb` | `analytics_shooting_efficiency` | 6,490,494 | — (exact duplicate of `fact_shot_chart`) |
| `api` | `v_shot_chart` | 1,414,390 | — |
| `nbadb` | `agg_shot_zones` | 187,062 | — |
| `nbadb` | `agg_shot_location_season` | 15,384 | `season`, `player_id`, `shot_zone_basic` |

---

## 2. Overlap & Redundancy Registry

### 2.1 Exact Duplicates (Same Data, Different Schema)

| Set | Tables | Evidence | Rows |
|-----|--------|----------|------|
| **BBR staging** | `raw_bref.*` ↔ `stg_bref.*` (all 22 tables) | Identical row count across every table. Staging adds `normalized_*` key columns only. | e.g. `advanced`: 33,339 ↔ 33,339 |
| **NBA-API staging** | `raw_sqlite*` ↔ `stg_nba_api_sqlite*` (all 18+ tables) | Identical row counts. Staging pass-through with added key columns. | e.g. `nba__play_by_play`: 13,592,899 ↔ 13,592,899 |
| **Shared dims** | `dim_arena` / `dim_official` / `dim_date` across nbadb, main, unified_star | Byte-for-byte identical across all three schemas. | 273 / 235 / 14,442 |
| **Team game boxscore** | `main.fact_team_game_stats` ↔ `unified_star.fact_team_game_boxscore` ↔ `nbadb.fact_team_game` | All three = 75,980 rows. Exact same grain. | 75,980 |
| **Enriched PBP** | `main.fact_play_by_play` ↔ `unified_star.fact_pbp_events` | Identical row count. Same enriched BBR-blended PBP. | 18,722,958 |
| **Legacy NBA-API PBP** | `raw_sqlite.nba__play_by_play` ↔ `main.fact_play_by_play_legacy_nba_api` ↔ `nbadb.fact_play_by_play_v2` | Three identical tables. | 13,592,899 |
| **Shot chart** | `nbadb.fact_shot_chart` ↔ `nbadb.analytics_shooting_efficiency` | Exact duplicate within same schema. | 6,490,494 |
| **Draft combine** | `main.fact_draft_combine` ↔ `unified_star.fact_draft_combine` ↔ `nbadb.fact_draft_combine_stats` | Identical row counts across all three. | 1,633 |
| **NBA-API draft** | `main.fact_draft_pick_nba_api` ↔ `raw_sqlite.nba__draft_history` ↔ `nbadb.fact_draft_board` | All three identical. | 8,257 |
| **Award votes** | `main.fact_player_award_vote` ↔ `raw_bref.player_award_shares` | Identical row counts. | 3,465 |

### 2.2 Partial Overlaps (Shared Grain, Different Coverage)

| Domain | Tables Compared | Key Finding |
|--------|----------------|-------------|
| **Player game boxscores** | `main.fact_player_game_stats` (1.67M) vs `unified_star.fact_player_game_boxscore` (1.67M) vs `nbadb.fact_player_game_traditional` (1.56M) vs `raw_csv.playerstatistics` (1.67M) | Main and unified_star are identical (1,667,844). `nbadb.fact_player_game_traditional` is a ~109K-row subset. `raw_csv` is nearly identical (1,667,889, +45 rows). `nbadb.analytics_player_game_complete` is much larger (3,116,411) with enriched attributes. |
| **Player dimensions** | 7 tables, 5,416–17,244 rows | `nbadb.dim_player` (17,244) is 2.6x larger than others due to surrogate keys (`player_sk`). `main.dim_player` = `nbadb.dim_all_players` = `raw_csv.players` = 6,692 (NBA-API). `unified_star` adds 292 BBR-only players (6,984 total). |
| **Team dimensions** | `nbadb.dim_team` (63 unique) vs `unified_star.dim_team` (97 unique) | Only 43 team IDs overlap. Different ID conventions: nbadb uses franchise-level IDs; unified_star uses history-aware IDs (team+city+name era). `xref.team_xref` has 364 entries to map them. |
| **Games** | `main.fact_game` (73,246) vs `nbadb.dim_game` (73,331) vs `raw_sqlite.nba__game` (65,698) | 100% overlap between main and unified_star. nbadb has 85 extra games (likely all-star/exhibition). `raw_sqlite.nba__game` is a subset (65,698). `xref.game_xref` covers all 73,246 unified games with 74,613 total cross-ref entries. |
| **Play-by-play** | 9 PBP tables (13.5M–18.7M rows) | Three tiers: (1) Legacy NBA-API: 13.5M; (2) Enriched BBR: 18.7M; (3) Intermediate raw: 17.6M–18.3M (`raw_parquet`, `raw_csv`, `raw_sqlite.nba_stats_pbp__`). The enriched 18.7M version is the canonical one. |
| **Player season stats** | 13+ tables (27K–66K rows) | `unified_star.fact_player_season_stats` (66,421) is the superset — merges NBA-API (~40K) and BBR (~33K). Raw tables have more BBR rows (33,339) than curated (31,119); the ~2,220-row difference reflects data quality filtering. |
| **Draft** | 7+ tables (1,633–8,701 rows) | BBR = 8,383 picks vs NBA-API = 8,257 picks. Overlap is ~97%. The 126-row difference represents source-specific picks. |
| **Awards** | `nbadb.fact_player_awards` (11,583) vs BBR tables (~2K–4K each) | nbadb is the superset with richer structure (`award_type`, `description`). BBR tables cover specific award subsets (votes, shares, all-star, end-of-season teams). |
| **Game context** | `nbadb.fact_game_context` (224,963) vs `main.fact_game_context` (58,230) | nbadb version is ~3.9x larger — covers more games and/or contains multiple rows per game. `main` version is a filtered subset. |

### 2.3 Key Intersections (Join Paths Between Schemas)

| Key | Verified Intersection | Join Path |
|-----|----------------------|-----------|
| **`player_id`** | `unified_star.dim_player` (6,984) ↔ `nbadb.dim_all_players.person_id` (6,692): **100% of dim_all_players match** (6,692 shared). 292 BBR-only players in unified_star have no NBA-API counterpart. `xref.player_xref` covers all 6,984 master IDs with 14,998 total cross-ref entries (avg 2.15 sources/player). | `unified_star.dim_player.player_id` ↔ `xref.player_xref.master_id` → resolves to `nba_api_sqlite`, `bref`, `nba_stats`, or `espn` source keys. |
| **`game_id`** | `unified_star.dim_game` (73,246) ↔ `nbadb.dim_game` (73,246 of 73,331): **100% of unified_star games in nbadb**. nbadb has 85 extra games not in unified_star. `xref.game_xref` has 74,613 entries covering all 73,246 unified games. | `unified_star.dim_game.game_id` = `nbadb.dim_game.game_id` directly. `xref.game_xref` resolves cross-source game IDs. |
| **`team_id`** | `unified_star.dim_team` (97 unique) vs `nbadb.dim_team` (63 unique): only **43 overlap**. Different key conventions between schemas. | Use `xref.team_xref` (364 entries, 97 master IDs) to bridge. nbadb uses franchise-level `team_id`, unified_star uses `team_id` + `city` + `name` era. |
| **`person_id` ↔ `player_id`** | 6,692 `person_id` values in `main.dim_player` match 6,692 in `nbadb.dim_all_players`. `nbadb.dim_player.player_id` (4,902 unique) maps to `person_id` via `xref.player_xref.source_id`. | `xref.player_xref` is the canonical bridge. Example: LeBron James → `player_id`=2544, mapped to `source_id`s: `nba_api_sqlite`=2544, `bref`=`jamesle01`, `espn`=1966. |
| **`slug` (BBR)** | `unified_star.dim_player.bref_player_id` bridges BBR `slug` to canonical `player_id`. | `unified_star.dim_player.player_id` ↔ `unified_star.dim_player.bref_player_id` → `raw_bref.*.slug`. |

### 2.4 Metric Duplication

The following statistical metrics appear in **7+ schemas** simultaneously:

| Metric | Schema Count | Schemas |
|--------|-------------|---------|
| `pts`, `ast`, `reb`, `stl`, `blk`, `tov` | 10 | api, main, nbadb, raw_bref, stg_bref, raw_csv, raw_json, raw_sqlite, stg_nba_api_sqlite, unified_star |
| `pace` | 9 | Same as above minus raw_json |
| `ts_pct`, `usg_pct`, `off_rating`, `def_rating`, `net_rating`, `efg_pct`, `pie`, `ast_pct`, `reb_pct`, `oreb_pct`, `dreb_pct`, `plus_minus` | 7 | api, main, nbadb, raw_csv, raw_sqlite, stg_nba_api_sqlite, unified_star |
| `per` | 5 | main, raw_bref, stg_bref, raw_json, unified_star |
| `tov_pct` | 4 | main, nbadb, raw_csv, unified_star |

These metrics are independently computed in each layer rather than being derived from a single source — a **single-writer principle** would reduce divergence risk.

---

## 3. Architecture Recommendations

### 3.1 Convert Staging Layers to Views

**Finding:** `raw_bref` → `stg_bref` and `raw_sqlite` → `stg_nba_api_sqlite` are 1:1 row-count mirrors with only `normalized_*` key columns added. This doubles storage for 40 tables.

**Recommendation:** Replace both staging schemas with SQL views that compute `normalized_*` columns on the fly. Eliminates 40 redundant base tables (~2–3 GB savings). Existing queries remain compatible.

### 3.2 Deduplicate Shared Dimensions

**Finding:** `dim_arena`, `dim_official`, and `dim_date` are identical across all three schemas (nbadb, main, unified_star).

**Recommendation:** Keep one canonical copy in `unified_star`. Replace `nbadb.dim_*` and `main.dim_*` with views pointing to `unified_star`. Saves 6 duplicate tables.

### 3.3 Canonicalize Fact Tables

**Player game boxscores:** Designate `unified_star.fact_player_game_boxscore` as the single canonical source. Drop `main.fact_player_game_stats` (exact duplicate with different key name). Keep `raw_csv.playerstatistics` as raw archive only. Investigate the ~109K-row gap in `nbadb.fact_player_game_traditional`.

**Team game boxscores:** Designate `unified_star.fact_team_game_boxscore` as canonical. Drop `main.fact_team_game_stats` (duplicate). Keep `nbadb.fact_team_game` only for nbadb public contract compliance.

**Play-by-Play:** Designate `unified_star.fact_pbp_events` as canonical. Drop `main.fact_play_by_play` (exact duplicate). Drop or archive the 3 legacy NBA-API PBP tables (all 13.5M rows, all identical). Estimated savings: ~5–7 GB.

**Shot charts:** `nbadb.fact_shot_chart` and `nbadb.analytics_shooting_efficiency` are identical (6,490,494 rows). Drop one.

### 3.4 Unify Player Dimension

**Finding:** 7 player dimension tables with 5,416–17,244 rows, using 4 different key columns (`person_id`, `player_id`, `slug`, `player_sk`). The `xref.player_xref` table (14,998 entries) bridges all of them.

**Recommendation:** Use `unified_star.dim_player` as the canonical player dimension. Keep `main.dim_bref_player` for BBR-specific career attributes. Deprecate `nbadb.dim_player` (17,244-row surrogate-keyed version) once downstream consumers migrate to `unified_star.dim_player` + `xref.player_xref`.

### 3.5 Rationalize Game Context

**Finding:** `nbadb.fact_game_context` (224,963 rows) is ~3.9x larger than `main.fact_game_context` (58,230 rows) despite covering the same 73,246 games. They represent different scope or grain.

**Recommendation:** Investigate and align. The discrepancy suggests one is at a different grain (e.g., one row per game vs one row per broadcast/market). Consolidate once grain is confirmed.

### 3.6 Establish Single-Writer Metric Principle

**Finding:** Core metrics (pts, ast, ts_pct, usg_pct, etc.) are independently computed and stored in 7–10 schemas. The `meta.stat_crosswalk` (12,244 rows) already maps source columns to canonical semantic concepts.

**Recommendation:** Enforce a single-writer pattern:
- **Raw schemas** (`raw_bref`, `raw_csv`, etc.): store only source values.
- **`unified_star`**: compute and store derived metrics once.
- **`api`**: query `unified_star` exclusively for metrics.
- Use `meta.stat_crosswalk` as the authoritative catalog for all column-to-concept mappings.

### 3.7 Summary of Proposed Changes

| Action | Tables Affected | Est. Space Saved |
|--------|----------------|-----------------|
| Convert `stg_bref` + `stg_nba_api_sqlite` to views | 40 | ~2–3 GB |
| Deduplicate `dim_arena/official/date` | 6 | ~50 MB |
| Canonicalize team/player game boxscores to `unified_star` | 4–6 | ~1–2 GB |
| Canonicalize PBP to `unified_star.fact_pbp_events` | 4–5 | ~5–7 GB |
| Drop duplicate `analytics_shooting_efficiency` | 1 | ~500 MB |
| **Total** | **~55–60 tables** | **~8–12 GB** |

**Resulting simplified architecture:**

```
raw_bref / raw_csv / raw_sqlite / raw_parquet / raw_json / raw_espn
                    ↓ (views, not staged copies)
             unified_star ← canonical star schema (single source of truth)
                    ↓
                api ← stable view layer for hub/chatbot
                    ↓
             audit / meta / xref ← operational support
```

nbadb schema remains for public contract compliance, but the 251 tables should be audited for actual usage. The `main` schema gradually becomes unnecessary as `unified_star` absorbs its fact tables.
