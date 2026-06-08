# `packages/web/src/components/timeMachine/dossier/hooks/`

## Responsibility

Custom React hooks for the player dossier — encapsulate data transformation logic and interactive behavior that would otherwise bloat section/table components. Three hooks: weighted career-summary computation (with per-team sub-totals), sortable table state management, and keyboard navigation for the season-stats tab bar.

## Design

### `useCareerSummary(rows: PlayerPerGameRow[]): CareerSummaryRow[]`

Computes games-weighted career averages from per-game stat rows. Must be called unconditionally (before any early returns in the parent).

**Algorithm:**
1. Filters to valid rows (`g != null && g > 0`).
2. **Career row** — Games-weighted averages for all numeric stat columns. Percentage columns (`fg_percent`, `x3p_percent`, `x2p_percent`, `ft_percent`) are recomputed from total makes / total attempts rather than averaging per-season percentages (mathematically correct approach).
3. **Per-team sub-rows** — If rows span multiple teams (detected via `Map<string, PlayerPerGameRow[]>`), computes separate averages for each team. Skips aggregate markers like `'2TM'` and `'TOT'`.
4. Returns `CareerSummaryRow[]` with labels like `"14 Yrs"`, `"LAL (5 Yrs)"`, `"CLE (7 Yrs)"`.

**Memoization:** Wrapped in `useMemo(() => ..., [rows])` — only recomputes when the `rows` array reference changes.

**Edge cases:**
- Empty rows → returns `[]`.
- All rows have null/zero games → returns `[]`.
- Single team → no per-team sub-rows (only career row).
- Percentage with zero attempts → `0` (returns 0 rather than dividing by zero).

## `useSortableTable<T>(rows, options): UseSortableTableResult<T>`

Generic column-sorting hook for tabular data.

**Options:**
```ts
interface UseSortableTableOptions<T> {
  initialSortCol?: string | null;
  initialSortDir?: SortDir;       // 'asc' | 'desc'
  getValue: (row: T, col: string) => number;   // Extracts numeric sort value
  onSortChange?: (col: string | null, dir: SortDir) => void;  // Callback for URL sync
}
```

**Behavior:**
- Click same column → toggles asc/desc.
- Click different column → sets desc.
- `sortedRows` is a `useMemo` that clones and sorts the input array (stable sort via `[...rows].sort(...)`).
- `onSortChange` callback fires on every sort change, enabling URL search-param sync in the parent route.

**Used by:** `PerGameTable` with `getValue: (r, col) => Number((r as any)[col]) || 0`.

### `useSeasonTabs(phase, tab, onPhaseChange?, onTabChange?)`

Keyboard arrow-key navigation for the dual-tab-bar pattern (phase tabs + stat category tabs).

**Returns:** `{ phaseKeyDown, tabKeyDown }` — event handler functions to attach to `onKeyDown` on tab `<button>` elements.

**Behavior:**
- `ArrowRight` → next tab (circular, wraps around).
- `ArrowLeft` → previous tab (circular).
- After changing, focuses the new tab button via `document.getElementById(...)?.focus()` in a `setTimeout(0)`.
- Uses `PHASE_TABS` and `STATS_TABS` constants from `tables/season-tabs.ts` to determine available tabs.

## Flow

```
PerGameTable
  │
  ├─ useCareerSummary(rows)
  │   └─ CareerSummaryRow[] → rendered as bold footer rows
  │
  └─ useSortableTable<PlayerPerGameRow>(rows, {
       getValue: (r, col) => Number((r as any)[col]) || 0,
       onSortChange: (col, dir) => navigate with updated search params,
     })
       └─ { sortCol, sortDir, sortedRows, handleSort }
           └─ sortedRows rendered as season rows
           └─ handleSort attached to th onClick

SeasonTabs
  │
  └─ useSeasonTabs(phase, tab, onPhaseChange, onTabChange)
      └─ { phaseKeyDown, tabKeyDown }
          └─ attached to onKeyDown on tab buttons
```

## Integration

- **Consumers:**
  - `useCareerSummary` — `tables/per-game-table.tsx`.
  - `useSortableTable` — `tables/per-game-table.tsx`.
  - `useSeasonTabs` — `tables/season-tabs.tsx`.
- **Types:**
  - `PlayerPerGameRow` from `data/tabs/time-machine/queries`.
  - `CareerSummaryRow` from `../internal/types.js`.
  - `PhaseId`, `StatsTabId`, `PHASE_TABS`, `STATS_TABS` from `../tables/season-tabs.js`.
- **No external dependencies** — Pure React hooks, no TanStack, no UI primitives.
