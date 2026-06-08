# `packages/web/src/components/timeMachine/dossier/internal/`

## Responsibility

Internal shared primitives for the player dossier — reusable building blocks consumed exclusively by the sibling `sections/` and `tables/` directories. Contains the data table wrapper, section card/section header layout components, empty-state hint, best/worst value highlighting utility, and a shared type definition for career-summary rows.

## Design

### Component inventory

| Component | File | Props | Purpose |
|-----------|------|-------|---------|
| `DataTable` | `data-table.tsx` | `headers: string[]`, `children: ReactNode`, `caption?: string` | Scrollable HTML table with sticky header, 4 sticky left columns with z-index layering, gradient fade scroll indicators (right and bottom edges), screen-reader accessible caption |
| `SectionCard` | `section-card.tsx` | `children: ReactNode` | Bordered card container with top gradient accent bar (`from-primary/60 to-transparent`), shadow, rounded corners |
| `SectionHeader` | `section-header.tsx` | `children: ReactNode`, `variant?: 'primary' \| 'accent'` | Uppercase label with colored accent bar (`.bg-primary/60` or `.bg-accent/60`) |
| `EmptyHint` | `empty-hint.tsx` | `children: ReactNode` | Dimmed italic placeholder text for empty data states |
| `highlight` | `highlight.ts` | `value, best, worst, higherIsBetter?` | Pure function returning Tailwind CSS class string for best/worst value highlighting |
| `types` | `types.ts` | `CareerSummaryRow` | Interface shared between `useCareerSummary` hook and `PerGameTable` |

### DataTable — sticky-column layout with scroll indicators

The `DataTable` component implements a horizontally and vertically scrollable table with **4 sticky left columns** (Season, Age, Tm, G) that remain visible during horizontal scroll. Each sticky column has explicit `z-index` and `background` values to prevent content overlap:

```css
/* Sticky columns with z-index layering */
[&_thead_th:first-child]:sticky [&_thead_th:first-child]:left-0 [&_thead_th:first-child]:z-20
[&_tbody_td:first-child]:sticky [&_tbody_td:first-child]:left-0 [&_tbody_td:first-child]:z-[5]
[&_thead_th:nth-child(2)]:sticky [&_thead_th:nth-child(2)]:left-[4.5rem] [&_thead_th:nth-child(2)]:z-20
...
```

This is achieved via Tailwind arbitrary variants (`[&_thead_th:first-child]`) — one of the few uses of Tailwind classes in the dossier. The `z-20` for header cells ensures headers scroll above body rows.

Two **gradient fade elements** (`.pointer-events-none`) overlay the right and bottom edges to hint at scrollable overflow:

```tsx
{/* Right-edge fade */}
<div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-8 bg-gradient-to-l from-surface/80 to-transparent" />
{/* Bottom-edge fade */}
<div className="pointer-events-none absolute bottom-0 left-0 z-10 h-6 w-full bg-gradient-to-t from-surface/60 to-transparent" />
```

### highlight function

Pure logic (no React) that compares a value against career best/worst:

```ts
export function highlightClass(
  value: number | string | null | undefined,
  best: number | null,
  worst: number | null,
  higherIsBetter: boolean = true,
): string {
  if (value == null || best == null || worst == null || best === worst) return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (n === best) return 'font-bold text-primary';    // Career high
  if (n === worst) return 'text-danger/70';            // Career low
  return '';
}
```

### SectionCard and SectionHeader — visual section skeleton

- **`SectionCard`** — Consistently used by all section components. Renders a `<section>` with `rounded-lg border border-border bg-surface shadow-sm`, a `h-0.5` top gradient accent bar, and `p-3` padding.
- **`SectionHeader`** — Renders `<div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-fg-muted">` with a vertical accent bar (`.inline-block h-3.5 w-0.5 rounded-full bg-primary/60`).

### CareerSummaryRow type

```ts
export interface CareerSummaryRow {
  label: string;              // e.g. "14 Yrs", "LAL (5 Yrs)"
  isBold: boolean;
  row: Partial<PlayerPerGameRow>;  // Computed averages for the label group
}
```

Used by `useCareerSummary` hook to pass career totals and per-team sub-totals to `PerGameTable` for rendering in the summary footer.

## Flow

```
sections/ and tables/ components
  │
  ├─ <SectionHeader>           → renders label + accent bar
  ├─ <SectionCard>             → renders container
  ├─ <DataTable headers={[...]}> → renders scrollable table shell
  │   └─ table body passed as children (tr elements)
  ├─ <EmptyHint>               → renders placeholder text
  └─ highlightClass()          → returns CSS class string for best/worst cells
```

## Integration

- **Consumers** — All 6 table files in `tables/` and all 7 section files in `sections/`.
- **Not exported** — These are internal-only. The `dossier/index.ts` barrel does not re-export anything from `internal/`.
- **No external dependencies** — Pure React + Tailwind. No data package imports, no UI primitives, no formatters.
