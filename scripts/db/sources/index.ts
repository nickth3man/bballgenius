import { brefManifest } from './bref.manifest';
import { espnManifest } from './espn.manifest';
import { nbaApiSqliteManifest } from './nba_api_sqlite.manifest';
import { nbaStatsManifest } from './nba_stats.manifest';
import type { SourceManifest } from './types';

/**
 * Registry of all known source manifests. To onboard a new source, add its
 * manifest module and append it here, then run `build-source-registry.ts`.
 */
export const SOURCE_MANIFESTS: SourceManifest[] = [
  brefManifest,
  nbaApiSqliteManifest,
  nbaStatsManifest,
  espnManifest,
];

export type { SourceManifest } from './types';
