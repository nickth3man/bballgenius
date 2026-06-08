# `packages/data/src/tabs/timeMachine/`

## Responsibility
**Time Machine / Player Dossier Data Access** — Comprehensive player and team data queries for the Career Time-Machine feature. Provides a `PlayerDossier` bundle (18 data sections) that aggregates everything from player metadata to franchise standings, award histories, season-by-season stats, shot zones, and game logs. Also supports team lookup, team season stats, and team roster queries.

## Design

### Dossier Pattern (Bulk Data Loading)

The flagship function `loadPlayerDossier(playerId)` executes **18 parallel data loaders** via `Promise.allSettled` so a missing view or column never crashes the page. Each failing loader is caught, logged to stderr, and returns its fallback value (null for scalars, `[]` for arrays).

```
PlayerDossier = {
  meta: PlayerMetaRow | null,              // dim_player + bridge + dim_bref_player
  totals: PlayerCareerTotalsRow | null,    // api.v_player_career
  draft: PlayerDraftRow | null,            // bridge + fact_draft_pick_bref
  combine: PlayerCombineRow | null,        // api.v_draft_combine
  awards: PlayerAwardRow[],                // honors (3-tier fallback)
  allStar: PlayerAllStarRow[],            // fact_all_star_selection
  votes: PlayerAwardVoteRow[],            // fact_player_award_vote
  perGame: PlayerPerGameRow[],            // fact_bref_player_season_per_game
  totalsSeason: PlayerTotalsRow[],        // fact_bref_player_season_totals
  per36: PlayerPer36Row[],                // fact_bref_player_season_per36
  advanced: PlayerAdvancedRow[],          // fact_bref_player_season_advanced
  shooting: PlayerShootingRow[],          // fact_bref_player_season_shooting
  playByPlay: PlayerPlayByPlayRow[],      // fact_bref_player_season_play_by_play
  gameLog: PlayerGameLogRow[],            // nbadb.fact_player_game_log
  franchise: PlayerFranchiseStandingRow[],// api.v_franchise_leaders
  shotZones: PlayerShotZoneRow[],         // api.v_shot_chart
  playoffPerGame: PlayerPerGameRow[],     // unified_star.fact_player_game_boxscore + dim_game
  careerStats: CareerStatRow[],           // fact_player_season_stats
}
```

### Key Data Loaders (each is a single SQL query)

| Loader | Source Tables | Purpose |
|--------|--------------|---------|
| `loadPlayerMeta` | `dim_player`, `bridge_player_source_id`, `dim_bref_player` | Name, position, height, weight, birth, draft info, HOF status |
| `loadPlayerCareerTotals` | `api.v_player_career` | Career aggregates (GP, ppg, rpg, apg, etc.) |
| `loadPlayerDraft` | `bridge_player_source_id`, `fact_draft_pick_bref` | Draft pick details via BRef bridge |
| `loadPlayerCombine` | `api.v_draft_combine` | Draft combine measurements |
| `loadPlayerAwards` | `v_player_honors_full` (3-tier fallback) | Acclaimed awards with categorization |
| `loadPlayerAllStarSelections` | `fact_all_star_selection` | All-Star game appearances |
| `loadPlayerAwardVotes` | `fact_player_award_vote` | MVP/ROY/DPOY vote shares |
| `loadPlayerPerGame` | `fact_bref_player_season_per_game` | Season-by-season per-game averages |
| `loadPlayerTotals` | `fact_bref_player_season_totals` | Season-by-season totals |
| `loadPlayerPer36` | `fact_bref_player_season_per36` | Per-36-minute stats |
| `loadPlayerAdvanced` | `fact_bref_player_season_advanced` | PER, TS%, WS, BPM, VORP, etc. |
| `loadPlayerShooting` | `fact_bref_player_season_shooting` | Shooting breakdowns by distance/zone |
| `loadPlayerPlayByPlay` | `fact_bref_player_season_play_by_play` | Position %, plus-minus, fouls drawn |
| `loadPlayerGameLog` | `nbadb.fact_player_game_log` | Game-by-game logs (default 25, newest first) |
| `loadPlayerFranchiseStanding` | `api.v_franchise_leaders` | Franchise leader categories (PTS/REB/AST/STL/BLK) |
| `loadPlayerShotZones` | `unified_star.dim_player`, `api.v_shot_chart` | Shot zone distribution |
| `loadPlayerPlayoffPerGame` | `unified_star.fact_player_game_boxscore` + `dim_game` | Playoff per-game averages |
| `loadCareerStats` | `fact_player_season_stats` | Season-by-season with TS%, PER, BPM, VORP |

### Awards Loading (3-Tier Strategy)

`loadPlayerAwards()` implements a cascade: 
1. **Honors DB** — if `NBA_HONORS_DUCKDB_PATH` configured and `v_player_honors_full` has rows, use them.
2. **Primary honors view** — `main.v_player_honors_full` for team honors (All-NBA, All-Rookie).
3. **Legacy fact table** — `fact_player_awards` for databases without the honors view.

Each tier tries the call and catches errors silently, falling through to the next.

### Team Queries

| Function | Purpose |
|----------|---------|
| `findTeam(query)` | Lookup team by abbreviation or name |
| `loadTeamSeasonStats(teamId, seasonYearPattern)` | Team averages (PPG, APG, RPG, etc.) per season |
| `loadTeamRoster(teamId, seasonYearPattern)` | Top 15 players by PPG for a team/season |

### Player Search

| Function | Purpose |
|----------|---------|
| `loadDefaultPlayer()` | Returns LeBron James (reference player for initial load) |
| `searchPlayerSuggestions(q)` | Autocomplete search by name fragment (LIMIT 8, newest first) |
| `loadFeaturedPlayers()` | Returns 8 hand-picked "most-clicked" players for the browse grid |

### Franchise Standing Deduplication
`loadPlayerFranchiseStanding()` scans all 5 `*_person_id` columns in `api.v_franchise_leaders` for matches and deduplicates to one row per category (keeping the highest value). This avoids duplicate entries from multiple team rows.

### Shot Zone Aggregation
`loadPlayerShotZones()` looks up player name from `unified_star.dim_player`, then groups `api.v_shot_chart` by `shot_zone_basic`, computing FGA, FGM, and FG% per zone.

### Pure Helpers
- `groupAwardsByCategory()` from `groupAwards.ts` — groups award rows by leading token (e.g., "All-NBA 1st" → "All-NBA" bucket) with team-number sorting. Re-exported from `queries.ts` for back-compat.
- `dedupeCareerStats()` from `utils/careerStats.ts` — deduplicates season rows when both calendar-year and NBA-label formats exist
- `seasonEndYearToNbaLabel()` from `utils/seasonYear.ts` — converts `2013` → `2012-13`

## Flow

```
Web UI TimeMachinePage.loadDossier(playerId)
  → loadPlayerDossier(playerId)
    → Promise.allSettled([18 loaders])
    → assemble PlayerDossier
    → return to UI for rendering
```

## Integration

### Consumes
- `../../core/db.js` — `query<T>()` for SQL execution
- `../../core/dbHonors.js` — `isHonorsDbConfigured()`, `queryHonors()` for secondary honors DB
- `../../core/types.js` — `DbRow` type for dynamic queries
- `./groupAwards.js` — `PlayerAwardRow`, `GroupedAward`, `groupAwardsByCategory`
- `./utils/careerStats.js` — `dedupeCareerStats()`
- `./utils/seasonYear.js` — `seasonEndYearToNbaLabel()`

### Exported via package.json subpath exports
- `data/tabs/time-machine/queries` → `./src/tabs/timeMachine/queries.ts`
- `data/tabs/time-machine/group-awards` → `./src/tabs/timeMachine/groupAwards.ts`

### Consumers
- **`packages/web`** — Time Machine route imports from subpath exports
