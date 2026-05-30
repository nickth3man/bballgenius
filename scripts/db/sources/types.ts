/**
 * Source manifest types for the cross-source reconciliation registry.
 *
 * A "source" is a provider of NBA data (Basketball-Reference, the Kaggle Walsh
 * SQLite, stats.nba.com feeds, ESPN, Spotrac, ...). Onboarding a new source is
 * meant to be *configuration* — add a manifest module here and run
 * `build-source-registry.ts` — rather than schema changes. See the plan at
 * `.claude/plans/i-would-like-to-serialized-lake.md`.
 *
 * Manifests are TypeScript modules (not YAML) so they are type-checked by the
 * existing `tsc`/biome tooling and need no extra parser dependency.
 */

/** Trust tier used to break ties when sources disagree (lower wins). */
export type TrustTier = 1 | 2 | 3 | 4 | 5;

/** Canonical real-world entity an source row can describe. */
export type EntityKind =
  | 'player'
  | 'team'
  | 'team_season'
  | 'game'
  | 'official'
  | 'arena'
  | 'coach';

/** One entity grain a source provides, with the keys needed to reconcile it. */
export interface SourceEntity {
  /** Real-world entity this grain resolves to. */
  entity: EntityKind;
  /** Human description of the row grain (e.g. "one row per player-season"). */
  grain: string;
  /** Schema holding the authoritative raw rows for this entity. */
  rawSchema: string;
  /** Table holding the authoritative raw rows for this entity. */
  rawTable: string;
  /** Column(s) that uniquely identify a row within this source. */
  naturalKey: string[];
  /**
   * Columns combined to form the blocking key used during entity resolution.
   * For players the community standard is normalized-name + birth-date.
   */
  blockingKey: string[];
  /** Optional: the source-native id column promoted into the entity xref. */
  sourceIdColumn?: string;
}

/** A full source definition. */
export interface SourceManifest {
  /** Stable short slug, e.g. "bref", "nba_api_sqlite", "nba_stats". */
  sourceId: string;
  /** Human-readable name. */
  name: string;
  /** Default trust tier (entities may be more/less trusted per metric later). */
  trustTier: TrustTier;
  /** URL template for an entity page, `{key}` substituted with the natural key. */
  urlPattern?: string;
  /** Data license. */
  license: string;
  /** Refresh cadence, e.g. "daily", "season", "point-in-time". */
  cadence: string;
  /**
   * How a curated-layer `source_authority` value maps to this source, so the
   * existing `master-stat-crosswalk` can be tied into the registry without
   * re-entering 12k column rows. e.g. "BBR" for bref, "NBA.com" for nba_api.
   */
  crosswalkAuthority?: string;
  /** Notes / provenance. */
  description: string;
  /** Entity grains this source provides. */
  entities: SourceEntity[];
}
