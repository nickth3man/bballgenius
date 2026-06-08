# `packages/web/src/components/timeMachine/dossier/tables/`

## Responsibility

Season-level stat table components for the player dossier. Six stat category tables (Per Game, Totals, Per 36, Advanced, Shooting, Play-by-Play) plus a tabbed orchestrator (`SeasonTabs`) that wraps them with phase (Regular Season / Playoffs) and stat-category selectors. Each table renders season-by-season rows from data fetched by `loadPlayerDossierFn`.

## Design

### Table inventory

| Table | File | Props | Key Columns |
|-------|------|-------|-------------|
| `PerGameTable` | `per-game-table.tsx` | `rows: PlayerPerGameRow[]`, `awards`, sort state | Season, Age, Tm, Lg, Pos, G, GS, MP, FG/FGA/%, 3P/3PA/%, 2P/2PA/%, eFG%, FT/FTA/%, ORB, DRB, TRB, AST, STL, BLK, TOV, PF, PTS, Awards |
| `TotalsTable` | `totals-table.tsx` | `rows: PlayerTotalsRow[]` | Season, Tm, Pos, G, GS, MP, FG/FGA/%, 3P/3PA/%, FT/FTA/%, ORB, DRB, TRB, AST, STL, BLK, TOV, PF, PTS, Trp-Dbl |
| `Per36Table` | `per-36-table.tsx` | `rows: PlayerPer36Row[]` | Season, Tm, G, MP, FG/FGA/%, 3P/3PA/%, FT/FTA/%, ORB, DRB, TRB, AST, STL, BLK, TOV, PF, PTS |
| `AdvancedTable` | `advanced-table.tsx` | `rows: PlayerAdvancedRow[]` | Season, Tm, Age, G, MP, PER, TS%, 3PAr, FTr, ORB%/DRB%/TRB%, AST%/STL%/BLK%/TOV%/USG%, OWS, DWS, WS, WS/48, OBPM, DBPM, BPM, VORP |
| `ShootingTable` | `shooting-table.tsx` | `rows: PlayerShootingRow[]` | Season, Tm, G, MP, FG%, Dist, %FGA by range, FG% by range, %Ast 2P/3P, %Dunks, #Dunks, Corner3% |
| `PlayByPlayTable` | `play-by-play-table.tsx` | `rows: PlayerPlayByPlayRow[]` | Season, Tm, G, MP, %PG/%SG/%SF/%PF/%C, OnCourt +/-, Net +/-, Pts via AST, FGA Blocked |

### Patterns across tables

- **Empty state** — Each table returns `<EmptyHint>No ... data available</EmptyHint>` when `rows.length === 0`, except `PerGameTable` which renders inline.
- **Shared DataTable wrapper** — Tables other than `PerGameTable` use `<DataTable headers={[...]}>` from `internal/data-table.tsx` which provides sticky headers, gradient fade scroll indicators, and a caption for accessibility.
- **Percentage formatting** — `PctBar` from `../../ui/pct-bar.js` is used for all percentage columns (FG%, 3P%, TS%, usage rates, etc.).
- **Season formatting** — Each table has a local `formatSeason()` helper: `(y-1)-{last2}` format.
- **Highlighting** — `AdvancedTable` uses `highlightClass()` from `internal/highlight.ts` to bold best values and dim worst values for PER, WS, BPM, and VORP columns.

### `PerGameTable` (the most complex table)

- **Sortable columns** — Uses `useSortableTable<PlayerPerGameRow>` hook with a `sortKeyMap` mapping column labels to row property keys. Click a header → toggles asc/desc. Arrow indicator in header.
- **Career summary rows** — Uses `useCareerSummary(rows)` hook to compute career totals and per-team sub-totals (games-weighted averages, percentage recomputed from totals). Summary rows render at the bottom with bold styling.
- **Awards column** — Builds `awardsBySeason` map from `PlayerAwardRow[]` (parses season strings like "1975-76" → end year). Renders award names inline.
- **Sticky columns** — The first 4 columns (Season, Age, Tm, G) are `sticky left-[Xrem]` so they stay visible during horizontal scroll.
- **Responsive split** — Desktop: full `<table>` with sticky columns. Mobile (`md:hidden`): card layout with season-by-season stat cards and summary cards.
- **Best/worst highlighting** — Pre-computes best/worst arrays for PTS, AST, TRB, STL, BLK, MP using `useMemo`. Applies `highlightClass()` to highlight career highs in bold blue and career lows in muted red.

### `SeasonTabs` orchestrator

- **Dual tab rows** — Phase tabs (Regular Season / Playoffs) and stat-category tabs (Per Game, Totals, Per 36, Advanced, Shooting, Play-by-Play). Both use `role="tablist"`/`role="tab"`/`role="tabpanel"` ARIA roles.
- **Keyboard navigation** — Uses `useSeasonTabs` hook for ArrowLeft/ArrowRight cycling between tabs with focus management.
- **Conditional rendering** — `{tab === 'per-game' ? <PerGameTable ... /> : null}` pattern — only the active table DOM is present.
- **Phase data switching** — `activePerGame = phase === 'regular' ? perGame : playoffPerGame` — only per-game data differs by phase; other tables use their dedicated arrays.

## Flow

```
SeasonTabs (orchestrator)
  │
  ├─ Phase: [Regular Season] [Playoffs]
  │   └─ activePerGame = phase === 'regular' ? perGame : playoffPerGame
  │
  └─ Stat category: [Per Game] [Totals] [Per 36] [Advanced] [Shooting] [Play-by-Play]
      │
      ├─ PerGameTable ← activePerGame + awards + sort state
      │   ├─ useSortableTable → sortedRows + handleSort
      │   ├─ useCareerSummary → summaryRows
      │   └─ highlightClass for career best/worst
      │
      ├─ TotalsTable ← totals
      ├─ Per36Table  ← per36
      ├─ AdvancedTable ← advanced
      │   └─ highlightClass for PER/WS/BPM/VORP
      ├─ ShootingTable ← shooting
      └─ PlayByPlayTable ← playByPlay
```

## Integration

- **Consumer** — `dossier/sections/` (indirectly via `SeasonTabs` being re-exported by `dossier/index.ts` and used in `time-machine.tsx`).
- **Data types** — All row types from `data/tabs/time-machine/queries`: `PlayerPerGameRow`, `PlayerTotalsRow`, `PlayerPer36Row`, `PlayerAdvancedRow`, `PlayerShootingRow`, `PlayerPlayByPlayRow`, `PlayerAwardRow`.
- **Internal deps** — `internal/data-table.tsx`, `internal/empty-hint.tsx`, `internal/highlight.ts`, `hooks/use-sortable-table.ts`, `hooks/use-career-summary.ts`, `hooks/use-season-tabs.ts`.
- **UI primitives** — `PctBar` from `../../ui/pct-bar.js`.
- **Utility functions** — `formatNumber`, `formatPct`, `formatSeason` from `../../../../utils/formatters.js`.
