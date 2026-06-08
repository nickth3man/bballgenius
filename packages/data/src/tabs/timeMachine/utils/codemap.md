# `packages/data/src/tabs/timeMachine/utils/`

## Responsibility
**Time Machine Utility Functions** — Pure helper modules (no DuckDB imports) that support the Time Machine dossier system. These are kept free of `core/db.js` dependencies so they can be safely imported into browser bundles without pulling CJS native addons.

## Design

### Content

| File | Function | Purpose |
|------|----------|---------|
| `careerStats.ts` | `canonicalSeasonKey()`, `dedupeCareerStats()` | Standardize season labels and deduplicate rows |
| `seasonYear.ts` | `seasonEndYearToNbaLabel()` | Convert season end year to NBA label format |

### Season Year Utilities

**`seasonEndYearToNbaLabel(seasonEndYear): string`** (`seasonYear.ts`)
- Converts a season end year (number or string) to NBA season label format
- `2013` → `2012-13`, `2024` → `2023-24`
- Returns the input as-is if it cannot be parsed as a number

**`canonicalSeasonKey(seasonYear): string`** (`careerStats.ts`)
- Maps any season label format to a canonical key for deduplication
- `"2024-25"` → `"2024-25"` (already canonical)
- `"2025"` → `"2024-25"` (calendar year → NBA label)
- Used by `dedupeCareerStats()` as the grouping key

**`dedupeCareerStats(rows): CareerStatRow[]`** (`careerStats.ts`)
- Removes duplicate season stat rows from nbadb-style double-labeling (both `"2025"` and `"2024-25"` for the same season)
- For each `(canonical season, is_playoffs)` key, keeps:
  - The hyphenated label row over the bare-year row
  - Otherwise, the row with more non-null stat columns (`statCompleteness()`)
- Results sorted by season_year DESC, playoffs first (is_playoffs DESC)

### `statCompleteness(row)`
- Counts non-null values across 6 columns: `reb`, `stl`, `blk`, `gs`, `ts_pct`, `per`
- Used as a tiebreaker to pick the more complete row when both hyphenated and bare-year formats exist for the same season

## Integration

### Consumers
- **`../queries.ts`** — imports `dedupeCareerStats` for `loadCareerStats()`
- **`../queries.ts`** — imports `seasonEndYearToNbaLabel` for award row mapping in `mapAwardRows()`
