import type { SourceManifest } from './types';

/**
 * ESPN — onboarded as the Phase 6 "add any source" acceptance test. A small but
 * real sample of athlete ids + names (scraped from ESPN rosters) is landed in
 * `raw_espn.player` by `onboard-espn-sample.ts`, then matched to master player
 * identity by `resolve-entities.ts`. ESPN ids do NOT share the NBA/BBR key
 * space, so this exercises the resolver rather than the deterministic seed.
 *
 * Full historical ESPN ingest is the documented follow-up; this proves the
 * config-only onboarding path end to end.
 */
export const espnManifest: SourceManifest = {
  sourceId: 'espn',
  name: 'ESPN',
  trustTier: 3,
  urlPattern: 'https://www.espn.com/nba/player/_/id/{key}',
  license: 'ESPN terms (personal/research)',
  cadence: 'point-in-time',
  description:
    'ESPN athlete identity sample (rosters). Distinct id space resolved to ' +
    'master players via name (+ birth date when available).',
  entities: [
    {
      entity: 'player',
      grain: 'one row per ESPN athlete',
      rawSchema: 'raw_espn',
      rawTable: 'player',
      naturalKey: ['espn_id'],
      blockingKey: ['full_name'],
      sourceIdColumn: 'espn_id',
    },
  ],
};
