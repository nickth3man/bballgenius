import type { SourceManifest } from './types';

/**
 * Supplementary stats.nba.com feeds landed in `raw_sqlite.nba_stats__*`
 * (game odds, games index/schedule, player & team box scores, play-by-play).
 * Shares the NBA numeric id space with `nba_api_sqlite`; used to extend
 * coverage (odds, schedule) and cross-check box scores.
 */
export const nbaStatsManifest: SourceManifest = {
  sourceId: 'nba_stats',
  name: 'stats.nba.com supplementary feeds',
  trustTier: 2,
  urlPattern: 'https://www.nba.com/game/{key}',
  license: 'stats.nba.com terms (personal/research)',
  cadence: 'daily',
  crosswalkAuthority: 'NBA.com',
  description:
    'stats.nba.com supplementary feeds: game odds, games index/schedule, ' +
    'player/team box scores, play-by-play. Shares NBA numeric id space with ' +
    'nba_api_sqlite.',
  entities: [
    {
      entity: 'game',
      grain: 'one row per game (schedule)',
      rawSchema: 'raw_sqlite',
      rawTable: 'nba_stats__games_schedule',
      naturalKey: ['game_id'],
      blockingKey: ['game_date', 'team_id_home', 'team_id_away'],
      sourceIdColumn: 'game_id',
    },
    {
      entity: 'player',
      grain: 'one row per player per game (box score)',
      rawSchema: 'raw_sqlite',
      rawTable: 'nba_stats__player_boxscores',
      naturalKey: ['player_id', 'game_id'],
      blockingKey: ['player_id'],
      sourceIdColumn: 'player_id',
    },
  ],
};
