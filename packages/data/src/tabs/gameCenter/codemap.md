# `packages/data/src/tabs/gameCenter/`

## Responsibility
**Game Center Data Access** — Provides SQL query functions for the Game Center UI feature: recent games, box scores, shot charts, and team total aggregations. Each function is a single source of truth consumed by `GameCenterTab` in the web UI and test helpers.

## Design

### Data Access Object Pattern
Each function encapsulates a specific SQL query with typed result interfaces. All queries use `core/db.ts`'s `query<T>()` function.

### Key Types

| Type | Fields | Source |
|------|--------|--------|
| `RecentGameRow` | game_id, game_date, season_year, home_team, away_team, home_name, away_name | `dim_game` + `dim_team` |
| `BoxScoreRow` | 19 stat columns (points, rebounds, assists, etc.) | `fact_player_game_boxscore` + `dim_player` |
| `GameShotRow` | player_id, team_id, action_type, shot_result, x, y | `fact_pbp_events` |
| `TeamTotals` | 15 aggregated stat columns | computed from `BoxScoreRow[]` |

### Team Deduplication
Both `loadRecentGames()` and `loadBoxScoreWithTeamDedup()` use a **DISTINCT ON CTE** (`team_dedup`) to collapse historic franchise renames (e.g., Minneapolis Lakers → LA Lakers) to the most-recent name/abbreviation. This prevents duplicate player rows from multi-season team entries.

### Query Functions

| Function | SQL | Use |
|----------|-----|-----|
| `loadRecentGames(limit=40)` | `dim_game` JOIN `team_dedup` × 2, ordered by game_date DESC | Game Center home page |
| `loadBoxScoreWithTeamDedup(gameId)` | `fact_player_game_boxscore` JOIN `dim_player` JOIN `team_dedup`, filtered by game_id | Game detail view |
| `loadGameShots(gameId)` | `fact_pbp_events` WHERE `is_field_goal = true` AND `x IS NOT NULL` AND `y IS NOT NULL` | Shot chart overlay |
| `computeTeamTotals(rows)` | Pure JS aggregation of `BoxScoreRow[]` into `TeamTotals` | Team box score table |

### computeTeamTotals
A pure function (no DB calls) that sums all numeric fields from an array of `BoxScoreRow` objects. Used by `TeamBoxScoreTable` in the web UI to compute team-level aggregates from player box scores.

## Flow

```
Web UI GameCenterTab.init()
  → loadRecentGames() → query() → RecentGameRow[]

Web UI GameCenterTab.loadGameDetails(gameId)
  → loadBoxScoreWithTeamDedup() → query() → BoxScoreRow[]
  → loadGameShots() → query() → GameShotRow[]
  → computeTeamTotals(boxScoreRows) → TeamTotals
```

## Integration

### Consumes
- `../../core/db.js` — `query<T>()` for all SQL execution

### Exported via package.json subpath export
- `data/tabs/game-center/queries` → `./src/tabs/gameCenter/queries.ts`

### Consumers
- **`packages/web`** routes — Game Center route imports from the subpath export
