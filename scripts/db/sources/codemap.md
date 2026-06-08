# `scripts/db/sources/`

## Responsibility
Source Manifest Registry — a config-only onboarding system that describes every NBA data source in the warehouse. Onboarding a new source is meant to be *configuration* (add a manifest module here, register it in `index.ts`, run `build-source-registry.ts`) rather than schema changes.

## Design

### Type-Driven Architecture
- **`types.ts`**: Defines `SourceManifest` and `SourceEntity` interfaces with `TrustTier` (1–5, lower wins) and `EntityKind` (player, team, team_season, game, official, arena, coach).
- **Manifests are TypeScript modules** (not YAML/JSON) so they are type-checked by `tsc` and Biome with no extra parser dependency.

### Manifest Design
Each manifest declares:
- **`sourceId`**: Stable slug (e.g. `'bref'`, `'nba_api_sqlite'`, `'nba_stats'`, `'espn'`).
- **`trustTier`**: Precedence for cross-source reconciliation (1 = highest).
- **`crosswalkAuthority`**: Maps to `meta.stat_crosswalk.source_authority` for column-level semantic mapping.
- **`entities[]`**: One per grain this source provides, with `rawSchema`/`rawTable` references, `naturalKey` (unique within source), `blockingKey` (for entity resolution — e.g. normalized name + birth date), and `sourceIdColumn`.

### Current Manifests

| Module | Source | Trust Tier | Key Entities | ID Space |
|--------|--------|------------|--------------|----------|
| `bref.manifest.ts` | Basketball-Reference | 1 (highest) | player, team_season | BBR slug (`player_id`) |
| `nba_api_sqlite.manifest.ts` | Kaggle Walsh SQLite (stats.nba.com) | 1 | player, team, game, official | NBA numeric IDs |
| `nba_stats.manifest.ts` | stats.nba.com supplementary feeds | 2 | game, player | Shares NBA ID space |
| `espn.manifest.ts` | ESPN (Phase 6 acceptance test) | 3 | player | ESPN numeric ID |

### Registry Assembly (`index.ts`)
Exports `SOURCE_MANIFESTS: SourceManifest[]` — the flat array consumed by `scripts/db/build-source-registry.ts`. To onboard a new source, import its manifest here.

## Flow

```
sources/types.ts                    ← Type definitions
  │
  ├── bref.manifest.ts              ← BBR manifest
  ├── nba_api_sqlite.manifest.ts    ← NBA API SQLite manifest
  ├── nba_stats.manifest.ts         ← NBA Stats supplementary feeds
  └── espn.manifest.ts              ← ESPN sample (acceptance test)
  │
  └── index.ts                      ─→ SOURCE_MANIFESTS[]
                                          │
                                          ▼
                               build-source-registry.ts
                               (writes meta.source + meta.source_entity)
```

## Integration
- **Consumer**: `scripts/db/build-source-registry.ts` imports manifests, validates every declared raw table+column against the live catalog, then writes `meta.source` and `meta.source_entity` tables.
- **Entity resolution**: `scripts/db/resolve-entities.ts` reads `meta.source_entity` to determine natural keys and blocking keys for new-source matching.
- **Crosswalk linkage**: Each manifest's `crosswalkAuthority` links to `meta.stat_crosswalk.source_authority` for column-level projection mapping.
