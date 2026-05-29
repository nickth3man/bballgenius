export const DETAILED_COLUMN_LIMIT = 24;

export const SCHEMA_PRIORITY = ['main', 'stg_bref', 'unified_star', 'nbadb', 'api', 'audit'];

export function normalizeMainTableName(tableName: string): string {
  return tableName.includes('.') ? tableName : `main.${tableName}`;
}

export const CORE_TABLE_PATTERNS = [
  'dim_player',
  'dim_bref_player',
  'bridge_player_source_id',
  'fact_game',
  'fact_player_game_stats',
  'fact_team_game_stats',
  'fact_play_by_play',
  'fact_bref_player_season_totals',
  'fact_bref_player_season_per_game',
  'fact_bref_team_season_summary',
  'fact_player_award_vote',
  'fact_player_honor',
  'v_player_honors_full',
  'v_team_current',
  'player_totals',
  'player_per_game',
  'advanced',
  'player_season_info',
  'player_shooting',
  'team_summaries',
  'team_totals',
  'player_award_shares',
  'draft_pick_history',
  'fact_shot_chart',
  'fact_player_game_log',
  'v_shot_chart',
  'player_identity_bridge',
  'dq_results',
];
