# packages/data/src/tabs/gameCenter/

## Responsibility

Provides the DuckDB query layer for the **Game Center** tab — loading recent games, per-game box scores, and shot-location data. These functions are the **canonical data source** for the Game Center feature, consuming the warehouse's star schema (`dim_game`, `dim_team`, `dim_player`, `fact_player_game_boxscore`, `fact_pbp_events`).

## Design

- **Single file, three exported async functions.** Each accepts a narrow set of parameters and returns a typed row array via the shared `query()` helper from `../../core/db.js`.
- **Team deduplication via `DISTINCT ON` CTE.** All three queries join through a CTE that collapses historic franchise renames (e.g. Minneapolis → LA Lakers) by picking the most-recent `season_active_till` per `team_id`. This is repeated in `loadRecentGames` and `loadBoxScoreWithTeamDedup`.
- **Parameterised queries** use `$1` positional placeholders (DuckDB style) passed as a second argument to `query()`.
- **No ORM or query builder** — raw SQL strings composed directly.
- **Exported types** (`RecentGameRow`, `BoxScoreRow`, `GameShotRow`) serve as the contract between this layer and consumers; they mirror the SELECT column aliases.

## Flow

```
Web route / API handler
    ↓
import { loadRecentGames, loadBoxScoreWithTeamDedup, loadGameShots } from 'data/tabs/game-center/queries'
    ↓
query(sql, params?)  →  initDb() → DuckDBInstance.fromCache(read-only) → connection.runAndReadAll()
    ↓
Typed row array (JSON-safe, bigints as strings)
```

1. `loadRecentGames(limit?)` — `SELECT` from `dim_game` with team-dedup CTE, ordered by `game_date DESC`.
2. `loadBoxScoreWithTeamDedup(gameId)` — `SELECT` from `fact_player_game_boxscore` joined to `dim_player` and team-dedup CTE, filtered by `game_id = $1`.
3. `loadGameShots(gameId)` — `SELECT` from `fact_pbp_events` filtered to `is_field_goal = true` with non-null `x`/`y` coordinates, no dedup needed.

## Integration

### Workspace export

`packages/data/package.json` exposes this module via the alias:
```
"./tabs/game-center/queries": "./src/tabs/gameCenter/queries.ts"
```

Consumers import as:
```ts
import { loadRecentGames, loadBoxScoreWithTeamDedup, loadGameShots, RecentGameRow, BoxScoreRow, GameShotRow } from 'data/tabs/game-center/queries';
```

### Web route divergence

The web Game Center route (`packages/web/src/routes/game-center.tsx`) **does not use these canonical query functions**. Instead it duplicates inline SQL:

| Data | `queries.ts` source | Web route source |
|------|---------------------|------------------|
| Recent games | `dim_game` (unified_star) via `loadRecentGames` | Inline, identical SQL via `data`'s `query()` export |
| Box score | `fact_player_game_boxscore` (star schema) via `loadBoxScoreWithTeamDedup` | `main.fact_player_game_stats` (NBA-API schema, different column names: `person_id`, `num_minutes`) |
| Shot chart | `fact_pbp_events` via `loadGameShots` | Returns `[]` — warehouse does not expose shot columns in current schema |

The route's box score queries the **`main` schema** (NBA-API raw shape) rather than the canonical star-schema `fact_player_game_boxscore`. This means the web UI and any consumer using `queries.ts` will return different column sets for the same `gameId`.

### Schema dependency

All queries resolve against the DuckDB `search_path` set to `unified_star,main` (see `../../core/db.ts`). The CI fixture places tables in `main`, so the team-dedup CTE (which queries `dim_team`) works in both full and CI environments.
