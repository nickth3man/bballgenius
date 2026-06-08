# `packages/web/src/components/timeMachine/`

## Responsibility

Top-level Time Machine UI components — the player search interface and loading/empty states for the Career Time-Machine tab. Contains the search panel (combobox with player suggestion dropdown), empty state with featured players grid, and a dossier loading skeleton. These are the outer-shell components that surround the player dossier (in `dossier/`) on the `/time-machine` route.

## Design

### Three components:

### `TimeMachineSearchPanel` (`search-panel.tsx`)

A full-featured player search combobox with ARIA accessibility.

**Props:**
```ts
interface TimeMachineSearchPanelProps {
  onSearch: (query: string) => Promise<PlayerResult[]>;
  onSelectPlayer: (player: PlayerResult) => void;
  selectedPlayerId?: string | null;
}
```

**Features:**
- **Debounced auto-search** — `useEffect` with 300ms `setTimeout` on the `search` state. Cancels on cleanup.
- **Keyboard navigation** — `ArrowDown`/`ArrowUp` cycles through dropdown options. `Enter` selects highlighted option. `Escape` closes dropdown. Without dropdown, `Enter` triggers manual search.
- **Accessibility** — `role="combobox"` with `aria-autocomplete="list"`, `aria-controls`, `aria-expanded`, `aria-activedescendant` pointing at the highlighted option. Screen-reader status via `<output id="time-machine-player-search-status">`.
- **Outside-click close** — `mousedown` listener on `document` checks if click is outside `searchRef`.
- **States:**
  - Empty input → no dropdown.
  - Typing → spinner indicator (`absolute right-2`).
  - Results → dropdown `listbox` with player cards (name, position badge, year range, active indicator).
  - No results → "No match" warning badge.
  - Error → red error banner.
- **Loading spinner** — CSS border-spin animation inside the input field.
- **Scrollable dropdown** — `max-h-64 overflow-auto` with up to 25 results.
- **Selected-player indicator** — Blue left border on the currently selected player.

### `FeaturedPlayersEmptyState` (`empty-state.tsx`)

Initial empty-state view when no player is selected. Shows a search icon, instructional text ("Search for a player..."), and a grid of featured player cards.

**Props:**
```ts
interface FeaturedPlayersEmptyStateProps {
  onSelect: (p: PlayerResult) => void;
  loader: () => Promise<PlayerResult[]>;
}
```

**Features:**
- **Async loading** — `useEffect` with cancellation flag loads featured players on mount.
- **Loading state** — 8 skeleton cards in a `grid-cols-2 sm:grid-cols-4` layout.
- **Player cards** — Each card shows full name, position badge, and year range. Hover effects via `hover:border-primary/60 hover:bg-surface-alt/60`.
- **Empty data** — "No featured players available" fallback text.

### `DossierSkeleton` (`dossier-skeleton.tsx`)

Full-page loading skeleton mimicking the dossier layout while player data loads.

**Structure:**
- `HeaderSkeleton` — 1 `Card` with a title skeleton, 6 info rows, and 9 stat-card skeletons.
- `CardSkeleton` × 5 — Each has a section header skeleton and a `Card` with 3–7 row skeletons.
- Total: 6 skeleton sections that fill the viewport with shimmer animations.

**Implementation:**
- Local `Skeleton` wrapper maps Tailwind `h-{n}`/`w-{n}` class strings to pixel values for the `ui/Skeleton` component.
- Uses `Array.from({ length: n })` for static decorative skeletons (Biome `noArrayIndexKey` suppressed).

## Flow

```
/time-machine route
  │
  ├─ Initial state (no player selected):
  │   └─ <FeaturedPlayersEmptyState
  │        onSelect={loadPlayerData}
  │        loader={loadFeaturedPlayersFn}
  │      />
  │
  ├─ Player selected, dossier loading:
  │   └─ <DossierSkeleton />
  │
  └─ Persistent sidebar:
      └─ <TimeMachineSearchPanel
           onSearch={handleSearch}
           onSelectPlayer={loadPlayerData}
           selectedPlayerId={selectedPlayer?.player_id}
         />
```

## Integration

- **Consumers** — `routes/time-machine.tsx` renders all three components.
- **Data flow** — `onSearch` and `loader` props are server functions (`searchPlayersFn`, `loadFeaturedPlayersFn`) defined in `routes/time-machine/server-fns.ts`. They execute DuckDB queries via the data package.
- **Shared types** — `PlayerResult` from `../../routes/time-machine/server-fns.js`.
- **UI primitives** — Uses `Badge` from `../ui` (active player badge, no-match badge), `Skeleton` from `../ui` (featured players loading), `Card` from `../ui` (dossier skeleton).
- **No direct dossier dependency** — These components are independent of the dossier internals. They delegate player selection to the parent route's `loadPlayerData` callback.
