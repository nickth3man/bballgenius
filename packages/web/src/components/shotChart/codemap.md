# `packages/web/src/components/shotChart/`

## Responsibility

Shot chart visualization — SVG-based half-court rendering with NBA-regulation court geometry. Converts shot coordinate data from the DuckDB `fact_pbp_events` table (0–100 normalized coordinates, full-court) into a fold-to-half-court SVG with true-to-scale court markings (three-point line, restricted area, key, free-throw circle, half-court circle, rim, backboard). Exports a single `DualShotChart` component used in the Game Center, and a standalone `HalfCourt` chart for single-team display.

## Design

### Geometry module (`courtGeometry.ts`)

Pure functions with no React dependencies. Contains:

- **`COURT`** — `const` object with all NBA regulation dimensions in feet (length, width, basket distance, rim radius, key size, three-point arc radius, restricted area radius, key mark positions). Uses the official NBA rulebook values.
- **`SVG`** — Output configuration: `width=500`, `height=470`, `scale=10` (pixels per foot).
- **`dataToCourtFeet(dataX, dataY)`** — Converts database coordinates (0–100 full-court) to court-feet coordinates (origin at basket center). Folds far-basket shots to the near side: `xHalf = dataX <= 50 ? dataX : 100 - dataX`.
- **`courtFeetToSvg(cx, cy)`** — Converts court-feet to SVG pixel space (y-axis inverted, origin at top-left).
- **`dataToSvg(dataX, dataY)`** — Convenience: `dataToCourtFeet` → `courtFeetToSvg`.
- **`threePointLinePath()`** — SVG path string for the three-point arc + straight corner lines. Uses Pythagorean theorem to find arc-start intersection.
- **`restrictedAreaPath()`** — SVG path for the restricted area semi-circle with straight lines to the backboard face.
- **`freeThrowCirclePath(half)`** — SVG arc for the free-throw circle, split into 'outer' and 'lane' halves (lane half is dashed).
- **`halfCourtCirclePath()`** — SVG full circle at center court.

All path functions return SVG path `d` attribute strings compatible with `<path d={...} />`.

### `HalfCourt` component

Renders a complete half-court SVG with:
1. **Court background** — `rect` with `fill="var(--surface-sunken)"`.
2. **Court markings** — Half-court line, half-court circle, paint/key rectangle, free-throw circle (outer solid + lane dashed), free-throw line, key marks (NBA regulation positions: 7, 8, 11, 14 ft from baseline), three-point line, restricted area, backboard line, rim circle.
3. **Shot markers** — Each `GameShotRow` rendered as a `<circle>`:
   - Made shots: filled circle (`r=3.5`, `fill="var(--made)"`)
   - Missed shots: outlined circle (`r=3`, `stroke="var(--missed)"`, `fill="none"`)
   - Hover tooltip via `<title>` showing shot result + `action_type`.

### `DualShotChart` component

Splits shot data by team and renders two `HalfCourt` side-by-side:
1. Builds a `player_id → team_id` mapping from the box score rows.
2. Filters `shots` into `homeShots`/`awayShots` using `team_id` if available, falling back to player mapping.
3. Renders a responsive grid (`grid-cols-1 lg:grid-cols-2`) with each team's `HalfCourt` and a shooting percentage summary below each.
4. Includes a legend (green filled dot = Made, red outlined dot = Missed).

### `index.ts` barrel

```ts
export { DualShotChart } from './DualShotChart.js';
export { HalfCourt } from './HalfCourt.js';
```

### Test coverage (`courtGeometry.test.ts`)

Six Bun tests covering:
- Official basket distance from baseline (5.25 ft).
- Normalized rim coordinate maps to basket center in court-feet space.
- Standard half-court rendering with baseline and basket at correct SVG positions.
- Restricted-area arc direction (arcs away from baseline, not toward it).
- Three-point arc is drawn away from baseline after vertical flip.
- SVG dimensions match `COURT.width * SVG.scale` and `COURT.halfLength * SVG.scale`.

## Flow

```
Game Center route (game-center.tsx)
  │
  ├─ loadShotsFn → createServerFn('POST') → DuckDB → GameShotRow[]
  ├─ boxScore → BoxScoreRow[]
  │
  └─ <DualShotChart
       shots={shots}
       boxScore={boxScore}
       homeAbbrev={homeAbbrev}
       awayAbbrev={awayAbbrev}
     />
       │
       ├─ Builds player→team mapping from boxScore
       ├─ Filters shots into home/away
       │
       ├─ <HalfCourt shots={awayShots} teamAbbrev={awayAbbrev} />
       │   └─ dataToSvg(shot.x, shot.y) → SVG pixel coords
       │   └─ <circle> for each shot
       │
       └─ <HalfCourt shots={homeShots} teamAbbrev={homeAbbrev} />
```

## Integration

- **Consumer** — `game-center.tsx` route (the `view === 'shotchart'` tab panel).
- **Data dependency** — `GameShotRow` and `BoxScoreRow` types from `data/tabs/game-center/queries`.
- **Theme dependency** — CSS variables `--made` (green), `--missed` (red), `--surface-sunken`, `--border-strong`, `--primary` for court markings.
- **No API calls** — All data is received via props from the parent route. The geometry module is pure computation.
- **Geometry test** — Runs with `bun test` (no DB, no DOM).
