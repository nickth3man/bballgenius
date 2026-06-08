# `packages/web/src/routes/time-machine/`

## Responsibility

Server functions for the Career Time-Machine route — the only directory within `routes/` that contains a non-route module (`server-fns.ts`). All 5 server functions that power the `/time-machine` page are defined here: player search (ILIKE query), full dossier loader, default player loader, featured players loader, and player-by-ID lookup. The route page itself lives at `routes/time-machine.tsx` (parent directory).

## Design

### `server-fns.ts` — 5 server functions

| Function | Method | Input | Output | SQL/Data Source |
|----------|--------|-------|--------|-----------------|
| `searchPlayersFn` | POST | `{ search: string }` | `PlayerResult[]` | `main.dim_player` ILIKE search, joins `bridge_player_source_id` + `dim_bref_player` for primary position. Limit 25. |
| `loadPlayerDossierFn` | POST | `{ playerId: string }` | `PlayerDossier` | Delegates to `data/tabs/time-machine/queries.loadPlayerDossier()` — the canonical full dossier query spanning 12+ tables. |
| `loadDefaultPlayerFn` | GET | none | `PlayerResult \| null` | Delegates to `data/tabs/time-machine/queries.loadDefaultPlayer()` — returns LeBron James (or configured default). |
| `loadFeaturedPlayersFn` | GET | none | `PlayerResult[]` | Delegates to `data/tabs/time-machine/queries.loadFeaturedPlayers()` — returns a curated list of notable players. |
| `loadPlayerByIdFn` | POST | `{ playerId: string }` | `PlayerResult \| null` | Direct query on `main.dim_player` by `person_id`. |

### `PlayerResult` interface

Shared type returned by all player-search functions:
```ts
export interface PlayerResult {
  player_id: string;
  full_name: string;
  from_year: string;
  to_year: string;
  is_active: boolean;
  position?: string | null;  // Only returned by searchPlayersFn and loadFeaturedPlayersFn
}
```

### Search SQL detail

```sql
SELECT DISTINCT
  p.person_id AS player_id,
  p.first_name || ' ' || p.last_name AS full_name,
  p.from_year::VARCHAR,
  p.to_year::VARCHAR,
  p.to_year >= 2025 AS is_active,
  (SELECT bp.primary_position
     FROM main.bridge_player_source_id src
     JOIN main.dim_bref_player bp ON bp.bref_player_id = src.source_player_id
    WHERE src.person_id = p.person_id
      AND src.source_system = 'basketball_reference'
    LIMIT 1) AS primary_position
FROM main.dim_player p
WHERE p.first_name || ' ' || p.last_name ILIKE $1
ORDER BY p.first_name, p.last_name
LIMIT 25
```

Key details:
- Uses `ILIKE` for case-insensitive partial matching.
- Position comes from Basketball-Reference crosswalk (`bridge_player_source_id` + `dim_bref_player`).
- Active status: `to_year >= 2025`.
- `DISTINCT` handles multiple source IDs per player.

### Dynamic import pattern

All server functions use `import('data')` or `import('data/tabs/time-machine/queries')` inside `.handler()` to avoid bundling the data package's DuckDB bindings in the client bundle. This is the same pattern used across all routes.

## Integration

- **Consumers** — `routes/time-machine.tsx` imports and uses all 5 server functions.
- **Data deps** — `data` package's `query()` for raw SQL, `data/tabs/time-machine/queries` for schema-aware dossier loader.
- **Type sharing** — `PlayerResult` is imported by `components/timeMachine/search-panel.tsx` and `components/timeMachine/empty-state.tsx` for prop typing.
- **Route search params** — The `/time-machine` route validates search params with `zod`: `{ pid?, tab?, phase?, sort?, dir? }`. `pid` drives initial player load, `tab`/`phase` control the season stats view, `sort`/`dir` control table sorting (all synced via URL).
- **No shared state** — Each server function is independent; the route component orchestrates them.
