import type { SourceManifest } from './types';

/**
 * Basketball-Reference — the BBR CSV export family, landed in `raw_bref`
 * (22 tables) and staged in `stg_bref`. Authoritative for historical
 * season-level stats and the BBR player slug identity.
 */
export const brefManifest: SourceManifest = {
  sourceId: 'bref',
  name: 'Basketball-Reference',
  trustTier: 1,
  urlPattern: 'https://www.basketball-reference.com/players/{key}.html',
  license: 'BBR terms of use (personal/research)',
  cadence: 'season',
  crosswalkAuthority: 'BBR',
  description:
    'Basketball-Reference CSV export family (advanced, per_game, per_36, per_100, ' +
    'totals, shooting, play-by-play, award shares, team summaries, draft). ' +
    'Authoritative for season aggregates and BBR player-slug identity.',
  entities: [
    {
      entity: 'player',
      grain: 'one row per BBR player (career-level identity)',
      rawSchema: 'raw_bref',
      rawTable: 'player_career_info',
      naturalKey: ['player_id'],
      blockingKey: ['player', 'birth_date'],
      sourceIdColumn: 'player_id',
    },
    {
      entity: 'team_season',
      grain: 'one row per team-season',
      rawSchema: 'raw_bref',
      rawTable: 'team_abbrev',
      naturalKey: ['season', 'abbreviation'],
      blockingKey: ['season', 'abbreviation'],
      sourceIdColumn: 'abbreviation',
    },
  ],
};
