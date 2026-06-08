# `packages/web/src/components/ui/`

## Responsibility

Reusable UI primitives — the BBallGenius design system's local component library. Replaces the temp root design artifact imports with web-owned, theme-consistent building blocks: buttons, badges, cards, tabs, stat tiles, team crests, skeletons, error boundaries, and percentage bars. All are inert presentational components with no server/DB access.

## Design

### Pattern: Inline-style design tokens via CSS custom properties

Every component reads from CSS custom properties defined in `styles/app.css` (`--primary`, `--surface`, `--text-muted`, `--border`, `--radius-lg`, `--ease-spring`, etc.). There are no CSS modules, styled-components, or Tailwind classes inside the component files — only inline `style={{}}` objects referencing variable names. This keeps the primitives theme-agnostic and avoids coupling to utility class names.

### Component inventory

| Component | File | Props | Variants/States |
|-----------|------|-------|-----------------|
| `Button` | `button.tsx` | `variant`, `size`, `loading`, `iconLeft/Right`, HTML button attrs | `primary/accent/secondary/ghost/danger` × `sm/md/lg` + hover/active/disabled/loading |
| `Badge` | `badge.tsx` | `tone`, `dot`, `live`, `size` | `neutral/primary/accent/success/danger/warning/award/live` × `sm/md` + optional pulsing dot |
| `Card` | `card.tsx` | `title`, `action`, `accent`, `pad`, `elevated` | Optional accent color bar at top, header with title+action slot, configurable padding |
| `Tabs` | `tabs.tsx` | `tabs`, `value`, `onChange`, `variant`, `size` | `segmented` (pill-group) or `underline` variant × `sm/md` |
| `StatTile` | `stat-tile.tsx` | `label`, `value`, `delta`, `deltaDir`, `unit`, `accent`, `size`, `align` | `sm/md/lg` size, up/down delta arrow, accent color highlight |
| `TeamCrest` | `team-crest.tsx` | `abbrev`, `color`, `shape`, `size`, `filled` | `square`/`circle` shape, filled/outlined variants, auto font-size |
| `Skeleton` | `skeleton.tsx` | `width`, `height`, `radius` | Shimmer animation via `bbg-shimmer` keyframe |
| `PctBar` | `pct-bar.tsx` | `value` | Compact horizontal bar + formatted percentage text |
| `SectionErrorBoundary` | `section-error-boundary.tsx` | `children`, `sectionName` | Class component, catches errors, renders fallback UI with section name |

### Button state machine

`Button` tracks three interaction states via local `useState`:
- **Hover** — `onMouseEnter`/`onMouseLeave` toggle a `hover` boolean → applies `variantStyle.hoverBackground`.
- **Active (press)** — `onMouseDown`/`onMouseUp` toggle `active` → applies `translateY(0.5px) scale(0.985)` transform via spring easing.
- **Disabled** — Derived from `disabled || loading` → sets `opacity: 0.45`, `cursor: not-allowed`, overrides all interaction handlers.

### Badge tone system

The `tones` record maps 8 tone names to `{ bg, fg, bd }` objects referencing themed CSS variables. The `live` tone additionally renders a pulsing dot (`bbg-pulse` keyframe) for live indicators.

### Tab normalization

`Tabs` accepts `TabDefinition[]` which is `string | { id, label }`. The `normalizeTab()` helper normalizes bare strings to `{ id, label }` objects so simple string-based tab lists work without boilerplate.

### SectionErrorBoundary as a class component

This is the only class component in the codebase. It uses `getDerivedStateFromError` + `componentDidCatch` to capture rendering errors within a single player dossier section and render a graceful fallback ("X data unavailable for this player") instead of crashing the entire page. Each dossier section in `time-machine.tsx` is wrapped in its own `SectionErrorBoundary` with a unique `sectionName`.

## Flow

```
┌──────────────────────────────┐
│  Parent component            │
│  (route page or dossier sec) │
│                              │
│  <Button variant="primary"   │
│    onClick={...}             │
│    loading={isLoading}       │
│  >                           │
│    Run Query                 │
│  </Button>                   │
│                              │
│  <Card accent="primary"      │
│    title="Career Averages"   │
│  >                           │
│    <StatTile label="PPG"     │
│      value={27.1}           │
│      size="lg"               │
│    />                        │
│  </Card>                     │
│                              │
│  <SectionErrorBoundary       │
│    sectionName="Awards"      │
│  >                           │
│    <AwardsGrouped ... />     │
│  </SectionErrorBoundary>     │
└──────────────────────────────┘
```

Data is one-way (props down). No events bubble up from these primitives except standard HTML events (`onClick`, `onChange`) plus `Badge`/`Button`/`Tabs` having their own local interaction state.

## Integration

- **Consumed by** — All route pages (`game-center.tsx`, `time-machine.tsx`, `sql-sandbox.tsx`, `chat.tsx`) and dossier sections (`dossier-header.tsx`, `shot-zones-card.tsx`, `per-game-table.tsx`, `advanced-table.tsx`).
- **Re-exported via** — `index.ts` barrel file: `export { Badge, Button, Card, PctBar, SectionErrorBoundary, Skeleton, StatTile, Tabs, TeamCrest }`.
- **Import paths** — `'../ui'` from sibling directories, `'../components/ui'` from route files.
- **Styling contract** — All CSS variables are defined in `styles/app.css`. Key dependencies: `--primary`, `--accent`, `--surface`, `--border`, `--radius-*`, `--text-*`, `--space-*`, `--font-*`, `--ease-*`, `--dur-*`. Animations: `bbg-spin`, `bbg-pulse`, `bbg-shimmer`.
- **No framework dependency** — Pure React 19, no TanStack, no CopilotKit, no data package imports.
