# `packages/web/src/utils/`

## Responsibility

Pure utility functions shared across the web package — stat formatting, date/season formatting, height conversion, deterministic color generation, and player-initials extraction. These are stateless, side-effect-free functions with no React, TanStack, or data-package dependencies. Used by dossier sections, stat tables, and the dossier header.

## Design

### Two modules:

### `formatters.ts`

Exports 9 pure formatting functions, all following the same pattern: nullable input → `'\u2014'` em-dash fallback → numbered formatting → output string.

| Function | Input | Output | Example |
|----------|-------|--------|---------|
| `formatNumber(value, digits=1)` | `number \| string \| null \| undefined` | Fixed-decimal string or `—` | `27.1` |
| `formatPct(value, digits=1)` | Same | Percentage string (×100) | `45.3%` (from 0.453) |
| `formatPctValue(value, digits=1)` | Same | Direct percentage string | `6.7%` (from 6.7) |
| `formatSeason(seasonEndYear)` | Same | `{y-1}-{last2}` or `—` | `2023-24` (from 2024) |
| `formatDate(value)` | `string \| null \| undefined` | Pass-through or `—` | `2024-01-15` |
| `formatBirthDate(value)` | Same | Locale-formatted date | `Jan 15, 2000` |
| `heightInchesToFtIn(value)` | Same | Feet'inches" | `6'7"` (from 79) |
| `ageString(birthDate)` | Same | Years | `24 yrs` |

**Null-safety:** Every function handles `null`, `undefined`, `NaN`, and non-finite values by returning `'\u2014'` (em dash).

**Percentage distinction:**
- `formatPct` — Multiplies by 100 (for values like `0.453` → `45.3%`). Used for shooting percentages, advanced stat rates.
- `formatPctValue` — No multiplication (for values already in percent units like `6.7` → `6.7%`). Used for play-by-play position percentages.

### `theme.ts`

Exports 3 functions for deterministic per-player theming:

| Function | Purpose | Algorithm |
|----------|---------|-----------|
| `pickPlayerColor(id: string)` | Generate a deterministic HSL color from a player ID | DJB2 hash → `hsl(hash % 360, 55%, 45%)` |
| `adjustColor(hsl: string, amount: number)` | Lighten/darken an HSL string | Regex parse → clamp lightness |
| `getInitials(name: string)` | Extract initials from full name | First + last word initials, uppercase |

**Deterministic color:** Each player gets a consistent accent color based on their `person_id`. The hash spreads colors across the hue wheel. Used by `DossierHeader` to color the accent bar, headshot border, and background gradient.

## Integration

- **Consumers:**
  - `formatters.ts` — All section components in `sections/`, all table components in `tables/`, `PctBar` in `ui/`.
  - `theme.ts` — `DossierHeader` in `sections/dossier-header.tsx`.
- **Import paths** — All consumers import via relative path: `../../../../utils/formatters.js` or `../../../../utils/theme.js`.
- **No dependencies** — Pure TypeScript, no React, no TanStack, no data package.
