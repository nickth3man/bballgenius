import { getColumns, getTableRefs } from '../db.js';

const DETAILED_COLUMN_LIMIT = 24;

const SCHEMA_PRIORITY = ['main', 'stg_bref', 'unified_star', 'nbadb', 'api', 'audit'];

const INTENT_TABLE_MAP: Record<string, string[]> = {
  career_leaders: ['fact_bref_player_season_totals', 'player_totals', 'dim_player'],
  season_leaders: ['fact_bref_player_season_per_game', 'player_per_game', 'dim_player'],
  awards: ['fact_player_award_vote', 'fact_player_honor', 'v_player_honors_full', 'dim_player'],
  team_seasons: ['fact_bref_team_season_summary', 'team_summaries', 'dim_team', 'v_team_current'],
  games: ['fact_game', 'fact_player_game_stats', 'fact_team_game_stats'],
  shot_charts: ['fact_shot_chart', 'v_shot_chart'],
  play_by_play: ['fact_play_by_play'],
  identity: ['bridge_player_source_id', 'player_identity_bridge', 'dim_player', 'dim_bref_player'],
  draft: ['draft_pick_history', 'dim_player'],
  data_quality: ['dq_results'],
};

const INTENT_SQL_TEMPLATES: Record<string, string[]> = {
  career_leaders: [
    "-- Career total for stat across players: SELECT player_name, SUM({stat}) as total FROM main.fact_bref_player_season_totals WHERE team NOT LIKE '%TM%' AND is_playoffs = false GROUP BY player_name ORDER BY total DESC LIMIT {n}",
    "-- Career total for a player: SELECT SUM({stat}) as total FROM main.fact_bref_player_season_totals WHERE player_name = '{name}' AND team NOT LIKE '%TM%' AND is_playoffs = false",
    "-- Career triple-doubles: SELECT COUNT(*) as count FROM main.fact_player_game_stats WHERE person_id IN (SELECT person_id FROM main.dim_player WHERE player_name = '{name}') AND points >= 10 AND reb >= 10 AND ast >= 10",
    "-- Second/Nth place on career list: SELECT player_name, SUM({stat}) as total FROM main.fact_bref_player_season_totals WHERE team NOT LIKE '%TM%' AND is_playoffs = false GROUP BY player_name ORDER BY total DESC LIMIT 1 OFFSET {n_minus_1}",
  ],
  season_leaders: [
    '-- Season leader: SELECT player_name, {stat} as value FROM main.fact_bref_player_season_per_game WHERE season_end_year = {season_int} ORDER BY value DESC LIMIT {n}',
    "-- Season avg for player: SELECT {stat} FROM main.fact_bref_player_season_per_game WHERE player_name = '{name}' AND season_end_year = {season_int}",
  ],
  awards: [
    "-- Award winner: SELECT player_name FROM main.fact_player_award_vote WHERE lower(award) = '{award}' AND winner = true AND season_end_year = {season_int}",
    "-- Award votes: SELECT player_name, vote_points_share FROM main.fact_player_award_vote WHERE lower(award) = '{award}' AND season_end_year = {season_int} ORDER BY vote_points_share DESC",
    "-- Award count per player: SELECT player_name, COUNT(*) as wins FROM main.fact_player_award_vote WHERE lower(award) = '{award}' AND winner = true GROUP BY player_name HAVING COUNT(*) >= {n} ORDER BY wins DESC",
    "-- Honors: SELECT player_name, honor FROM main.fact_player_honor WHERE honor = '{honor}' AND season_end_year = {season_int}",
  ],
  team_seasons: [
    "-- Team record: SELECT team_name, wins, losses, srs FROM main.fact_bref_team_season_summary WHERE season_end_year = {season_int} AND team_name = '{team}'",
    '-- Season standings: SELECT team_name, wins, losses, win_loss_pct FROM main.fact_bref_team_season_summary WHERE season_end_year = {season_int} ORDER BY wins DESC',
  ],
  games: [
    "-- Box score: SELECT player_name, points, reb, assists, steals, blocks, num_minutes FROM main.fact_player_game_stats WHERE game_id = '{game_id}'",
    "-- Final score: SELECT team_id, SUM(points) as team_score FROM main.fact_player_game_stats WHERE game_id = '{game_id}' GROUP BY team_id",
    "-- Playoff career total for a player: SELECT SUM(p.points) as total FROM main.fact_player_game_stats p JOIN main.fact_game g ON p.game_id = g.game_id WHERE g.season_type = 'Playoffs' AND p.person_id = (SELECT person_id FROM main.dim_player WHERE player_name = '{name}')",
    "-- Playoff scoring leaders: SELECT dp.player_name, SUM(p.points) as total FROM main.fact_player_game_stats p JOIN main.fact_game g ON p.game_id = g.game_id JOIN main.dim_player dp ON p.person_id = dp.person_id WHERE g.season_type = 'Playoffs' GROUP BY dp.player_name ORDER BY total DESC LIMIT {n}",
  ],
  shot_charts: [
    "-- Shot chart: SELECT x, y, shot_made, shot_type, shot_zone FROM main.fact_shot_chart WHERE player_name = '{name}'",
    "-- Shot distribution: SELECT shot_zone, COUNT(*) as attempts, SUM(CASE WHEN shot_made THEN 1 ELSE 0 END) as made FROM main.fact_shot_chart WHERE player_name = '{name}' GROUP BY shot_zone",
  ],
  play_by_play: [
    "-- Play-by-play: SELECT period, time_remaining, event_type, description FROM main.fact_play_by_play WHERE game_id = '{game_id}' ORDER BY period, time_remaining",
  ],
  identity: [
    '-- Bridge lookup: SELECT person_id, basketball_reference_id, nba_api_person_id FROM main.bridge_player_source_id WHERE {condition}',
  ],
  draft: [
    '-- Draft picks: SELECT player_name, draft_year, draft_round, draft_pick, team_name FROM main.draft_pick_history ORDER BY draft_year DESC, draft_pick ASC LIMIT {n}',
  ],
  data_quality: ['-- Row count: SELECT COUNT(*) as row_count FROM {table}'],
};

function normalizeMainTableName(tableName: string): string {
  return tableName.includes('.') ? tableName : `main.${tableName}`;
}

async function resolveBestQualifiedName(tablePattern: string): Promise<string> {
  const tables = await getTableRefs();
  const normalized = normalizeMainTableName(tablePattern);
  for (const schema of SCHEMA_PRIORITY) {
    const candidate = `${schema}.${tablePattern}`;
    if (
      tables.some(
        (t) => normalizeMainTableName(t.qualifiedName) === normalizeMainTableName(candidate),
      )
    ) {
      return candidate;
    }
  }
  if (tables.some((t) => normalizeMainTableName(t.qualifiedName) === normalized)) {
    return normalized;
  }
  return tablePattern;
}

export async function buildIntentSchemaPrompt(intentCategory: string): Promise<string | null> {
  if (intentCategory === 'general' || intentCategory === 'cross_schema') {
    return null;
  }

  const tablePatterns = INTENT_TABLE_MAP[intentCategory];
  if (!tablePatterns || tablePatterns.length === 0) {
    return null;
  }

  const sections: string[] = [
    'Focus on these tables for this question. Their columns are listed below, and SQL templates for common query patterns are provided at the bottom.',
  ];

  for (const pattern of tablePatterns) {
    const qualifiedName = await resolveBestQualifiedName(pattern);
    const columns = await getColumns(qualifiedName);
    const visibleColumns = columns.slice(0, DETAILED_COLUMN_LIMIT);
    const rows = visibleColumns.map((col) => `| ${col.name} | ${col.type} |`).join('\n');
    const more =
      columns.length > DETAILED_COLUMN_LIMIT
        ? `\n| ... | ${columns.length - DETAILED_COLUMN_LIMIT} more columns |`
        : '';
    sections.push(`## ${qualifiedName}\n| Column | Type |\n|--------|------|\n${rows}${more}`);
  }

  const templates = INTENT_SQL_TEMPLATES[intentCategory];
  if (templates && templates.length > 0) {
    sections.push('SQL templates for common patterns in this category:');
    sections.push(...templates);
  }

  sections.push(
    'Start by using these tables directly. Only call get_schema_info if you need columns not listed here.',
  );

  return sections.join('\n\n');
}
