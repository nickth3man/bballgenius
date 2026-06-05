# packages/data/src/tabs/timeMachine/utils/

## Responsibility

Provides **season-label normalization** and **career-stat deduplication** logic consumed exclusively by `../queries.ts`. These utility functions are pure transformations — no DuckDB queries, no side effects.

Sibling BBR-mirror integration (Firecrawl-backed offline Basketball-Reference snapshots) is planned at `utils/bbr/` but not yet implemented; the BBR crawl pipeline currently lives at repo root `scripts/bbr/` and `bbr-screenshots/`.

## Design

### `seasonYear.ts` — season-end-year → NBA label

- **`seasonEndYearToNbaLabel(n: number | string): string`** — Converts a season-end year (e.g. `2013`) to the canonical NBA label (`"2012-13"`). Used by `loadPlayerAwards()` in queries.ts to format award rows from the honors DB (where `season_end_year` is stored numerically). Pass-through on non-numeric input or already-formatted labels.

### `careerStats.ts` — label normalization + dedup pipeline

Two functions:

1. **`canonicalSeasonKey(seasonYear: string): string`** — Normalizes a season label to `"YYYY-YY"` format. If the input already matches `YYYY-YY` or `YYYY-YYYY` (regex), returns as-is. Otherwise treats the input as a calendar year `Y` and returns `"Y-1-YY"`. Used internally by `dedupeCareerStats`.

2. **`dedupeCareerStats(rows: CareerStatRow[]): CareerStatRow[]`** — Removes duplicate rows arising from nbadb's double labeling (e.g. both `"2025"` and `"2024-25"` for the same season). Resolution priority:
   - Prefer the hyphenated label over the bare-number label for a given `(season, is_playoffs)` key.
   - If both rows have the same label style, keep the one with more non-null stat columns (`reb`, `stl`, `blk`, `gs`, `ts_pct`, `per`) — a heuristic for row completeness.
   - Returns rows sorted descending by `season_year`, then `is_playoffs` (playoffs first).

### BBR Mirror Integration (future)

The AGENTS.md spec references `packages/data/src/tabs/timeMachine/utils/bbr/` for Firecrawl-backed offline BBR data used by Time Machine rendering. No source files exist at this path yet. Current BBR operations live in:
- `scripts/bbr/` — map/crawl/observe automation
- `bbr-screenshots/` — PNG + JSON mirror output
- `.firecrawl/` — cached markdown

## Flow

```
queries.ts:loadCareerStats()
  → DuckDB: fact_player_season_stats
  → returns CareerStatRow[] (may contain duplicates with bare-number + hyphenated season labels)
  → dedupeCareerStats(rows)
    → canonicalSeasonKey() for each row (normalizes to "YYYY-YY")
    → Map<(key, is_playoffs), row> with priority rules
  → returns deduplicated, sorted CareerStatRow[]

queries.ts:loadPlayerAwards()
  → DuckDB (honors or primary): returns WinnerRow with season_end_year (number)
  → seasonEndYearToNbaLabel(label) for each award row
  → returns PlayerAwardRow[] with "YYYY-YY" season labels
```

## Integration

| Caller (in `../queries.ts`) | Utility | Purpose |
|---|---|---|
| `loadCareerStats()` | `dedupeCareerStats()` | Post-process SQL results before returning to web route |
| `loadPlayerAwardsFromHonorsDb()` | `seasonEndYearToNbaLabel()` | Transform numeric `season_end_year` to display label |

Both utility modules are imported with `.js` extension (ESM convention). No other module outside `../queries.ts` imports them directly.
