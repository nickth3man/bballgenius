# `packages/web/src/styles/`

## Responsibility

Global CSS — the sole stylesheet for the BBallGenius web app. Contains Tailwind CSS v4 initialization (`@import 'tailwindcss'`) plus a comprehensive BBallGenius broadcast design token system defined as CSS custom properties. No other stylesheets exist in the web package. Font preconnects/stylesheet links are also loaded here (Google Fonts: Saira, Archivo, JetBrains Mono).

## Design

### Tailwind v4 setup

Uses Tailwind CSS v4's `@import 'tailwindcss'` directive (not the traditional `@tailwind` directives) with a `@theme inline` block that maps custom CSS variables to Tailwind utility classes:

```css
@import "tailwindcss";

@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-fg: var(--text-primary);
  --color-primary: var(--primary);
  --color-accent: var(--accent);
  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
  --font-display: var(--font-display);
}
```

This means Tailwind classes like `bg-surface`, `text-fg`, `border-primary`, `font-display` resolve to the custom property values. The Tailwind v4 Vite plugin (`@tailwindcss/vite`) processes this file.

### Design token system

~200 CSS custom properties organized into groups:

| Category | Properties | Example Values |
|----------|------------|----------------|
| **Ink palette** (backgrounds) | `--ink-950` through `--ink-400` | Dark navy: `#06090f`, `#0a0f18`, ... `#46587a` |
| **Paper palette** (text) | `--paper-50` through `--paper-600` | Light: `#f4f7fc`, `#e8edf6`, ... `#566175` |
| **Accent colors** | `--blue-*`, `--orange-*`, `--gold-*`, `--green-*`, `--red-*`, `--cyan-*`, `--violet-*` | `--blue-500: #2f7bf6`, `--orange-500: #ff6b2c` |
| **Surface tokens** | `--bg`, `--surface`, `--surface-alt`, `--surface-elevated`, `--surface-sunken` | Dark mode surface hierarchy |
| **Border tokens** | `--border`, `--border-subtle`, `--border-strong` | 3-tier border opacity |
| **Text tokens** | `--text-primary`, `--text-secondary`, `--text-muted`, `--text-inverse` | Readability-optimized |
| **Brand tokens** | `--primary`, `--accent`, `--made`, `--missed`, `--success`, `--danger`, `--warning`, `--info`, `--award` | Semantically named |
| **Interaction tokens** | `--primary-hover`, `--primary-press`, `--primary-fg`, `--primary-soft`, `--primary-soft-border` | Hover/press/filled/soft states |
| **Delta tokens** | `--delta-up`, `--delta-down` | Green/red for stat changes |
| **Typography** | `--font-display`, `--font-sans`, `--font-mono` + size/weight/leading/tracking scales | Athletic data-dashboard typography |
| **Spacing** | `--space-0` through `--space-20` | 4px base unit |
| **Layout** | `--rail-sidebar`, `--rail-schema`, `--header-h`, `--footer-h`, `--content-max` | App chrome dimensions |
| **Radii** | `--radius-xs` through `--radius-pill` | 4px → 999px |
| **Shadows** | `--shadow-xs` through `--shadow-lg`, `--glow-primary`, `--glow-accent`, `--ring` | Multi-layer shadows |
| **Motion** | `--ease-out`, `--ease-in-out`, `--ease-spring`, `--dur-*` | Cubic-bezier curves + durations |
| **Transition** | `--transition-colors`, `--transition-transform` | Composed transition shorthand |

### Dark-only color scheme

```css
:root {
  color-scheme: dark;
  /* ... all tokens in dark-mode values ... */
}
```

There is no light mode — the app is designed as a dark-themed only dashboard. The `color-scheme: dark` property ensures native UI elements (scrollbars, form controls) render in dark mode.

### Base element styles

- `*, *::before, *::after` — `box-sizing: border-box`.
- `html, body` — `margin: 0; height: 100%`.
- `body` — Dark background (`var(--bg)`), light text (`var(--text-primary)`), Archivo font, antialiased.
- `.tabular, .font-mono, table` — `font-variant-numeric: tabular-nums` for aligned numbers.
- `:focus-visible` — Blue outline for keyboard navigation.
- `:focus:not(:focus-visible)` — No outline for mouse clicks.
- `::selection` — Blue-tinted highlight.
- **Scrollbar styling** — Thin, dark-themed scrollbars (both Firefox `scrollbar-width: thin` and WebKit pseudo-elements).

### Keyframe animations

| Name | Purpose | Used by |
|------|---------|---------|
| `bbg-spin` | 360° rotation | `Button` loading spinner |
| `bbg-pulse` | Expanding ring pulse | `Badge` live indicator |
| `bbg-shimmer` | Horizontal gradient sweep | `Skeleton` loading shimmer |

## Integration

- **Imported via** — `routes/__root.tsx` imports `appCss` via `import appCss from '../styles/app.css?url'` and adds it as a `<link rel="stylesheet">` in the document `<head>`.
- **Consumed by** — Every component in the web package reads from the CSS custom properties defined here, via inline `style={{}}` objects or Tailwind classes mapped in the `@theme` block.
- **No data package dependency** — Pure CSS, no imports from `packages/data`.
- **Font loading** — Google Fonts preconnect + stylesheet links are also in `__root.tsx`, not in the CSS file.
