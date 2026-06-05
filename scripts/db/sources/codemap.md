# scripts/db/sources/

## Responsibility

Config-only onboarding layer for NBA data sources — a **typed manifest registry** that drives cross-source entity reconciliation (`build-source-registry.ts`, `resolve-entities.ts`). Each manifest describes one source's trust tier, row grains (player/team/game/official), raw DuckDB schema+table, natural keys, blocking keys, and crosswalk authority. Adding a new source means writing one TypeScript manifest module and appending it to the registry — no schema changes.

## Design

**Manifest contract (`types.ts`)** — `SourceManifest` interface with scalar fields (sourceId, trustTier, urlPattern, license, cadence, crosswalkAuthority, description) and an `entities: SourceEntity[]` array. Each `SourceEntity` declares:

- entity kind (player / team / team_season / game / official / arena / coach)
- raw schema + table (e.g. `raw_bref.player_career_info`)
- naturalKey — source-native columns that uniquely identify a row
- blockingKey — columns used for deterministic + fuzzy matching against `unified_star.dim_player`
- sourceIdColumn — the id column promoted into `xref.player_xref`

Trust tiers (1–5, lower wins on conflict) let downstream resolution prioritize Basketball-Reference and the Walsh SQLite over ESPN or supplementary feeds.

**Registry pattern (`index.ts`)** — `SOURCE_MANIFESTS: SourceManifest[]` is a flat, ordered array that collects every manifest module. Consumers import only this single array. The order has no semantic meaning — tier is the tiebreaker.

**TypeScript-over-YAML decision** — manifests are `.ts` modules, not config files, so `tsc` and Biome validate them alongside the rest of the codebase with zero extra parser dependencies.

## Flow

```
manifest module (*.manifest.ts)
  ↓ export const
SOURCE_MANIFESTS registry (index.ts)
  ↓ import
build-source-registry.ts         resolve-entities.ts
  ↓ validate catalog               ↓ read meta.source_entity
  ↓ write meta.source               ↓ tiered match (exact → destripped → fuzzy)
  ↓ write meta.source_entity        ↓ write xref.player_xref
  ↓ derive source_column_map        ↓ write audit.match_candidates
```

1. **Build phase** (`build-source-registry.ts --apply`): validates every declared `rawSchema.rawTable` + `naturalKey`/`blockingKey`/`sourceIdColumn` against the live DuckDB information_schema; then materializes `meta.source`, `meta.source_entity`, and `meta.source_column_map` (derived by joining `meta.stat_crosswalk` on `crosswalkAuthority`). Fails fast on missing tables/columns.

2. **Resolve phase** (`resolve-entities.ts --source <id> --apply`): reads the player grain from `meta.source_entity` (the DB-resident copy, not the TS manifest), runs a three-tier match against `unified_star.dim_player`:
   - Tier 1: exact normalized name + optional birth-date agreement
   - Tier 2: suffix-stripped name + birth-date agreement
   - Tier 3: `jaro_winkler_similarity` on name, gated by birth-date + shared initial, above configurable threshold (default 0.92)
   Matches go to `xref.player_xref`; misses + near-miss candidates go to `xref.player_unresolved` and `audit.match_candidates`.

## Integration

| Script | What it does with manifests |
|--------|---------------------------|
| `scripts/db/build-source-registry.ts` | Imports `SOURCE_MANIFESTS`, validates against DuckDB catalog, writes `meta.source` + `meta.source_entity` + optionally `meta.source_column_map` |
| `scripts/db/resolve-entities.ts` | Reads `meta.source_entity` (the DB form) at runtime; uses natural/blocking keys for entity resolution |
| `scripts/db/onboard-espn-sample.ts` | References the pipeline: build registry → resolve entities |

**Onboarding checklist** (e.g. for a new source like Spotrac):

1. Create `scripts/db/sources/spotrac.manifest.ts` exporting a `SourceManifest`
2. Append to `SOURCE_MANIFESTS` in `index.ts`
3. Run `build-source-registry.ts --apply` (validates + persists)
4. Run `resolve-entities.ts --source spotrac --apply` (tiered match → xref)

**Current registry** (4 sources, 9 entity grains):

| Source | trustTier | crosswalkAuthority | entity grains |
|--------|-----------|-------------------|---------------|
| bref (Basketball-Reference) | 1 | BBR | player, team_season |
| nba_api_sqlite (Kaggle Walsh) | 1 | NBA.com | player, team, game, official |
| nba_stats (stats.nba.com supp.) | 2 | NBA.com | game, player |
| espn (ESPN sample) | 3 | — | player |

Sources sharing `crosswalkAuthority: 'NBA.com'` (nba_api_sqlite + nba_stats) merge into the same `source_column_map` rows, since they share the NBA numeric id space. The ESPN manifest has no `crosswalkAuthority`, so it contributes no column map entries — it exists purely to exercise the fuzzy resolver on a non-NBA key space.
