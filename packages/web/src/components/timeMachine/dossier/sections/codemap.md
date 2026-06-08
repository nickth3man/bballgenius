# `packages/web/src/components/timeMachine/dossier/sections/`

## Responsibility

Player dossier section components — the seven distinct visual sections that compose a player's Career Time-Machine profile. Each section is a self-contained React component that renders one facet of the `PlayerDossier` data: header/bio, career trajectory sparklines, grouped awards, All-Star and award voting, season stat tables, shot zones, game log, and draft/combine information.

## Design

### Component inventory

| Component | File | Props | Purpose |
|-----------|------|-------|---------|
| `DossierHeader` | `dossier-header.tsx` | `meta`, `totals`, `franchise`, `isActive` | Player name, headshot (NBA CDN with initials fallback), bio facts (position, height, weight, born, college, country, draft, career span), franchise leader status, career averages stat cards |
| `CareerTrajectory` | `career-trajectory.tsx` | `perGame`, `allStarSeasons?`, `playerKey?` | 8 mini SVG sparkline charts (PPG, RPG, APG, STL, MPG, FG%, 3P%, FT%) with animated line + area fill, hover tooltips, All-Star season markers |
| `AwardsGrouped` | `awards-grouped.tsx` | `groups: GroupedAward[]` | Categorized award badges (MVP, All-NBA teams, DPOY, ROY, etc.) with count × label and season range |
| `AwardVotesStrip` | `award-votes-strip.tsx` | `allStar`, `votes` | All-Star appearances (count + year list) and top award vote finishes with share percentage |
| `GameLogCard` | `game-log-card.tsx` | `rows: PlayerGameLogRow[]` | Recent games table: Date, Matchup, W/L, MIN, PTS, REB, AST, STL, BLK, TOV, +/- |
| `ShotZonesCard` | `shot-zones-card.tsx` | `zones: PlayerShotZoneRow[]` | Shot zone breakdown table: Zone, FGA, FGM, FG% (with PctBar) |
| `DraftCombineCard` | `draft-combine-card.tsx` | `draft`, `combine` | Side-by-side draft info (season, round, pick, team) and combine measurements (height, wingspan, vert, agility, etc.) |

### Pattern: Section wrapper with gradient accent

Each section follows the same layout pattern:
```tsx
<section>
  <SectionHeader variant="primary|accent">
    Section Title
  </SectionHeader>
  <SectionCard>
    {/* content */}
  </SectionCard>
</section>
```

- `SectionHeader` — Renders a uppercase label with a colored accent bar (`.bg-primary/60` or `.bg-accent/60`).
- `SectionCard` — Renders a bordered card with a top gradient accent line (`from-primary/60 to-transparent`), shadow, and padding.

### DossierHeader — the most complex section

- **Player headshot** — Fetches from `https://cdn.nba.com/headshots/nba/latest/260x190/{person_id}.png`. Falls back to initials on error (`imgError` state) or missing `person_id`.
- **Deterministic player color** — Uses `pickPlayerColor(person_id)` from `utils/theme.ts` to generate a consistent HSL color per player (hash-based). Applied to the headshot border, background gradient, and top accent bar.
- **Bio grid** — 2-column on mobile, 3-column on sm+ screens. Shows Position, Height, Weight, Born (with age), College, Country.
- **Draft line** — Formatted as `2023 · R1 · P2` or "Undrafted".
- **Career span** — From `totals.first_season → last_season · N seasons`, or falls back to `meta.from_year → Present/to_year`.
- **Franchise leader** — Conditional line showing "Franchise all-time leader in {categories} for {team}".
- **Career averages** — Grid of 9 `StatCard` components showing GP, PPG, RPG, APG, SPG, BPG, FG%, 3P%, FT% with themed color styling.

### CareerTrajectory — animated sparkline charts

- **8 metrics** — PPG, RPG, APG, STL, MPG, FG%, 3P%, FT%, each with a unique color.
- **SVG line chart** — Each `<CareerLineChart>` renders an inline SVG with:
  - Animated line + area fill (opacity transitions on mount via `useEffect` → `setAnimateIn(true)`).
  - Average reference line (dashed).
  - Dot markers (up to 8, evenly sampled for long careers).
  - Hover crosshair: vertical guide line, value tooltip, season label.
  - All-Star season star markers (★) for first, last, and peak honor seasons.
- **Touch support** — `onTouchStart` handlers for mobile interaction.
- **Responsive grid** — `grid-cols-2 md:grid-cols-4`.

### AwardsGrouped — grouped award badges

- Takes `GroupedAward[]` (category + awards array) from `groupAwardsByCategory()` in the data package.
- Sub-groups awards by their label (e.g., "All-NBA" → {"All-NBA 1st": [seasons], "All-NBA 2nd": [seasons]}).
- **Color coding**:
  - Major awards (MVP, ROY): `border-warning/30 bg-warning/10 text-warning`
  - 1st Team: `border-primary/30 bg-primary/10 text-primary`
  - All-Star: `border-secondary/30 bg-secondary/10 text-secondary`
  - Other: `border-border/60 bg-surface-alt/60 text-fg-muted`
- Shows count (e.g., `3×`), title-cased label, and season range.

### DraftCombineCard — side-by-side data

- Two-column grid: Draft info (season, round, overall pick, team) vs. Combine measurements.
- If no draft data: shows `<EmptyHint>Undrafted</EmptyHint>`.
- If no combine data: shows `<EmptyHint>No combine measurements on record</EmptyHint>`.
- If both null: entire section returns `null`.

### Null-safety pattern

Most sections return `null` early when there's no data to display (e.g., `AwardVotesStrip` when `allStar.length === 0 && votes.length === 0`). The `ShotZonesCard` returns null for empty zones. The `GameLogCard` renders `<EmptyHint>` for empty log. Sections that return null are simply not rendered in the time-machine page, saving vertical space.

## Flow

```
time-machine.tsx (route)
  │
  └─ PlayerDossier object loaded from DuckDB via loadPlayerDossierFn
       │
       ├─ dossier.meta            → DossierHeader
       ├─ dossier.totals          → DossierHeader
       ├─ dossier.franchise       → DossierHeader
       ├─ dossier.perGame         → CareerTrajectory + SeasonTabs(PerGameTable)
       ├─ dossier.playoffPerGame  → SeasonTabs(PerGameTable)
       ├─ dossier.totalsSeason    → SeasonTabs(TotalsTable)
       ├─ dossier.per36           → SeasonTabs(Per36Table)
       ├─ dossier.advanced        → SeasonTabs(AdvancedTable)
       ├─ dossier.shooting        → SeasonTabs(ShootingTable)
       ├─ dossier.playByPlay      → SeasonTabs(PlayByPlayTable)
       ├─ dossier.awards          → groupAwardsByCategory() → AwardsGrouped
       ├─ dossier.allStar         → AwardVotesStrip
       ├─ dossier.votes           → AwardVotesStrip
       ├─ dossier.shotZones       → ShotZonesCard
       ├─ dossier.gameLog         → GameLogCard
       ├─ dossier.draft           → DraftCombineCard
       └─ dossier.combine         → DraftCombineCard
```

## Integration

- **Consumer** — The `time-machine.tsx` route renders each section wrapped in `<SectionErrorBoundary>`. Sections are direct children of the route component.
- **Data types** — Types from `data/tabs/time-machine/queries`: `PlayerMetaRow`, `PlayerCareerTotalsRow`, `PlayerFranchiseStandingRow`, `PlayerPerGameRow`, `PlayerAllStarRow`, `PlayerAwardVoteRow`, `GroupedAward`, `PlayerGameLogRow`, `PlayerShotZoneRow`, `PlayerDraftRow`, `PlayerCombineRow`.
- **Internal deps** — `internal/section-card.tsx`, `internal/section-header.tsx`, `internal/data-table.tsx`, `internal/empty-hint.tsx`.
- **UI primitives** — `PctBar` from `../../ui/pct-bar.js`.
- **Utility functions** — `formatNumber`, `formatPct`, `formatSeason`, `formatDate`, `formatPctValue`, `formatBirthDate`, `heightInchesToFtIn`, `ageString` from `../../../../utils/formatters.js`. `adjustColor`, `getInitials`, `pickPlayerColor` from `../../../../utils/theme.js`.
- **No direct DB access** — All sections receive data via props; no server functions or data package imports.
