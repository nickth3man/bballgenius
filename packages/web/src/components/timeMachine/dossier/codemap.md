# `packages/web/src/components/timeMachine/dossier/`

## Responsibility

Player dossier — the detailed player profile view in the Career Time-Machine tab. This is the root dossier directory that re-exports all constituent parts (sections, tables, hooks) through a single `index.ts` barrel. The dossier is a composite of several independent sub-components that render different facets of a player's career: header with bio + career averages, season-by-season stat tables (per-game, totals, per-36, advanced, shooting, play-by-play), career trajectory sparkline charts, awards and honors, All-Star appearances, shot-zone breakdowns, game log, draft/combine info, and award-vote strips.

## Design

### Barrel re-export pattern (`index.ts`)

The `index.ts` file re-exports from `sections/` and `tables/` to provide a clean public API for the parent time-machine route. Nothing is defined directly in this directory — it is purely a composition point:

```ts
// Sections
export { AwardVotesStrip } from './sections/award-votes-strip.js';
export { AwardsGrouped } from './sections/awards-grouped.js';
export { CareerTrajectory } from './sections/career-trajectory.js';
export { DossierHeader, type DossierHeaderProps } from './sections/dossier-header.js';
export { DraftCombineCard, type DraftCombineProps } from './sections/draft-combine-card.js';
export { GameLogCard } from './sections/game-log-card.js';
export { ShotZonesCard } from './sections/shot-zones-card.js';

// Tables + tab definitions
export {
  PHASE_IDS, PHASE_TABS, type PhaseId,
  SeasonTabs, type SeasonTabsProps,
  STATS_TAB_IDS, STATS_TABS, type StatsTabId,
} from './tables/season-tabs.js';
```

### Subdirectory architecture

```
dossier/
├── index.ts          ← barrel re-exports
├── sections/         ← 7 section components (dossier-header, awards, trajectory, etc.)
├── tables/           ← 6 stat table components + season-tabs orchestrator
├── hooks/            ← 3 custom hooks (useCareerSummary, useSeasonTabs, useSortableTable)
└── internal/         ← 6 shared utilities (DataTable, SectionCard, SectionHeader, etc.)
```

### Composition model

The `time-machine.tsx` route composes these sections in a linear scroll layout:

```
<DossierHeader ... />
<CareerTrajectory ... />
<AwardsGrouped ... />
<AwardVotesStrip ... />
<SeasonTabs ... />
<ShotZonesCard ... />
<GameLogCard ... />
<DraftCombineCard ... />
```

Each section is wrapped in a `<SectionErrorBoundary>` to isolate rendering failures. The entire dossier is wrapped in a loading skeleton (`DossierSkeleton`) while data fetches.

## Flow

```
time-machine.tsx (route)
  │
  ├─ loadPlayerDossierFn → server fn → DuckDB → PlayerDossier
  │     { meta, totals, franchise, perGame, playoffPerGame, ... }
  │
  └─ Props distributed to child sections:
       │
       ├─ DossierHeader ← meta, totals, franchise, isActive
       ├─ CareerTrajectory ← perGame, allStarSeasons
       ├─ AwardsGrouped ← groupAwardsByCategory(awards)
       ├─ AwardVotesStrip ← allStar, votes
       ├─ SeasonTabs ← perGame, playoffPerGame, totals, per36, advanced, shooting, playByPlay, awards
       ├─ ShotZonesCard ← shotZones
       ├─ GameLogCard ← gameLog
       └─ DraftCombineCard ← draft, combine
```

## Integration

- **Consumer** — `routes/time-machine.tsx` (the Time-Machine route page).
- **Data dependency** — `PlayerDossier` type from `data/tabs/time-machine/queries`. The `PlayerDossier` is fetched via `loadPlayerDossierFn` (a `createServerFn`).
- **Internal dependencies** — `internal/` primitives (`DataTable`, `SectionCard`, `SectionHeader`, `EmptyHint`, `highlight`) and `hooks/` (career summary, sortable table, season tabs keyboard nav).
- **UI primitives** — Uses `PctBar` and `SectionErrorBoundary` from `../ui/`.
- **Utility functions** — `formatNumber`, `formatPct`, `formatSeason`, `formatDate` from `../../../utils/formatters.js` (via relative path to `packages/web/src/utils/formatters.ts`).
- **No direct data package imports** — All data is received via props from the route. Sections never call server functions directly.
