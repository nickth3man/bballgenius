# packages/data/src/tabs/timeMachine/

Data-access layer for the **Career Time-Machine** feature — player search, season-by-season stats, awards, team lookup, and team roster queries.

---

## Responsibility

Provide pure query functions that the web Time-Machine route calls to render a player's career dossier (stats table + awards chips) and, separately, team-level aggregates by season. All queries target the curated `nbadb` star tier and are scoped to read-only DuckDB access.

---

## Design

- **Stateless query functions** — one export per API surface; no mutable state, no graph nodes.
- **Dual-source awards** — `loadPlayerAwards` prefers `NBA_HONORS_DUCKDB_PATH` (`v_player_honors_full` from a basketball-data DuckDB) for accurate MVP counts and falls back to `fact_player_awards` on the primary DB.
- **Career-stat deduplication** — `utils/careerStats.ts::dedupeCareerStats` resolves double-labeling from nbadb (e.g. both `"2025"` and `"2024-25"` for the same season) by preferring hyphenated labels and fuller rows.
- **Season-year normalization** — `utils/seasonYear.ts::seasonEndYearToNbaLabel` converts numeric end-years (`2013` → `"2012-13"`) for awards display.
- **Team queries** — `findTeam`, `loadTeamSeasonStats`, and `loadTeamRoster` follow the same pattern, joining `dim_game` and `fact_player_game_boxscore` for per-game averages.

### File layout

| File | Responsibility |
|---|---|
| `queries.ts` | All exported query functions + TypeScript row interfaces |
| `utils/seasonYear.ts` | `seasonEndYearToNbaLabel()` — single-use format helper |
| `utils/careerStats.ts` | `canonicalSeasonKey()` + `dedupeCareerStats()` — nbadb dedup |

---

## Flow

```
/time-machine (TanStack Route)
  │
  ├─ searchPlayersFn (server fn)
  │    └─ query() → dim_player (ILIKE, LIMIT 25)
  │
  └─ loadPlayerDataFn (server fn)
       ├─ loadCareerStats(playerId)
       │    └─ query() → fact_player_season_stats
       │    └─ dedupeCareerStats() → deduped rows
       ├─ loadPlayerAwards(playerId)
       │    ├─ isHonorsDbConfigured()? → queryHonors() → v_player_honors_full
       │    └─ fallback: query() → fact_player_awards
       └─ formatTable() → markdown-style ASCII table
```

Standalone queries (`findTeam`, `loadTeamSeasonStats`, `loadTeamRoster`) are not yet wired in the web route but are available for future dossier embedding.

---

## Integration

- **Package export** — `package.json` maps `"./tabs/time-machine/queries"` → `./src/tabs/timeMachine/queries.ts`
- **Web consumer** — `packages/web/src/routes/time-machine.tsx` imports via `import {...} from 'data/tabs/time-machine/queries'` inside `createServerFn` handlers (lazy-dynamic `import()` for code-splitting).
- **DB layer** — `query()` from `../../core/db.js` (primary DuckDB via `resolveDbPath()`), `queryHonors()` from `../../core/dbHonors.js` (optional honors DB).
- **BBR cross-source integration** — planned future augmentation at `utils/bbr/` (see `scripts/bbr/` for Firecrawl screenshot pipeline). No BBR source files exist in this folder yet.
- **Not re-exported** from `packages/data/src/index.ts` — consumers must use subpath imports directly.
