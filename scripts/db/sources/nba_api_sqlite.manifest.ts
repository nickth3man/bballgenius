import type { SourceManifest } from './types';

/**
 * Kaggle "NBA Database" (wyattowalsh/basketball) SQLite dump, sourced from
 * stats.nba.com. Landed in `raw_sqlite.nba__*` (16 tables) and staged in
 * `stg_nba_api_sqlite`. Authoritative for NBA PERSON_ID / TEAM_ID / GAME_ID
 * identity and box scores / play-by-play.
 */
export const nbaApiSqliteManifest: SourceManifest = {
  sourceId: 'nba_api_sqlite',
  name: 'Kaggle Walsh SQLite (stats.nba.com)',
  trustTier: 1,
  urlPattern: 'https://www.nba.com/player/{key}',
  license: 'CC BY-SA 4.0',
  cadence: 'daily',
  crosswalkAuthority: 'NBA.com',
  description:
    'Kaggle wyattowalsh/basketball SQLite (daily-updated, stats.nba.com origin). ' +
    'Authoritative for NBA numeric ids (PERSON_ID/TEAM_ID/GAME_ID), box scores, ' +
    'play-by-play, officials, draft.',
  entities: [
    {
      entity: 'player',
      grain: 'one row per NBA player (common player info)',
      rawSchema: 'raw_sqlite',
      rawTable: 'nba__common_player_info',
      naturalKey: ['person_id'],
      blockingKey: ['display_first_last', 'birthdate'],
      sourceIdColumn: 'person_id',
    },
    {
      entity: 'team',
      grain: 'one row per NBA franchise',
      rawSchema: 'raw_sqlite',
      rawTable: 'nba__team',
      naturalKey: ['id'],
      blockingKey: ['abbreviation'],
      sourceIdColumn: 'id',
    },
    {
      entity: 'game',
      grain: 'one row per team-side of a game',
      rawSchema: 'raw_sqlite',
      rawTable: 'nba__game',
      naturalKey: ['game_id', 'team_id_home'],
      blockingKey: ['game_date', 'team_id_home', 'team_id_away'],
      sourceIdColumn: 'game_id',
    },
    {
      entity: 'official',
      grain: 'one row per official per game',
      rawSchema: 'raw_sqlite',
      rawTable: 'nba__officials',
      naturalKey: ['official_id'],
      blockingKey: ['first_name', 'last_name'],
      sourceIdColumn: 'official_id',
    },
  ],
};
