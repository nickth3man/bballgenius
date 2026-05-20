import { query } from '../db.js';

/**
 * Loads recent games with deduplicated team abbreviations.
 *
 * Uses a DISTINCT ON CTE to collapse historic franchise renames
 * (e.g. Minneapolis Lakers → LA Lakers) to the most-recent name.
 *
 * Single source of truth: used by GameCenterTab.init() and test helpers.
 */
export async function loadRecentGames(limit = 40): Promise<any[]> {
  return query(`
    WITH team_dedup AS (
      SELECT DISTINCT ON (team_id) team_id, team_abbrev, team_name
      FROM dim_team
      ORDER BY team_id, season_active_till DESC
    )
    SELECT
      g.game_id,
      g.game_date,
      g.season_year,
      t_home.team_abbrev AS home_team,
      t_away.team_abbrev AS away_team,
      t_home.team_name AS home_name,
      t_away.team_name AS away_name
    FROM dim_game g
    JOIN team_dedup t_home ON g.home_team_id = t_home.team_id
    JOIN team_dedup t_away ON g.away_team_id = t_away.team_id
    ORDER BY g.game_date DESC
    LIMIT ${limit}
  `);
}

/**
 * Loads the box score for a single game with deduplicated team abbreviations.
 *
 * Uses the same team_dedup CTE to prevent duplicate player rows from
 * multi-season team entries (the Minneapolis/LA Lakers problem).
 *
 * Single source of truth: used by GameCenterTab.loadGameDetails() and test helpers.
 */
export async function loadBoxScoreWithTeamDedup(gameId: string): Promise<any[]> {
  return query(
    `
    WITH team_dedup AS (
      SELECT DISTINCT ON (team_id) team_id, team_abbrev
      FROM dim_team
      ORDER BY team_id, season_active_till DESC
    )
    SELECT
      b.player_id,
      p.full_name,
      t.team_abbrev,
      b.points,
      b.assists,
      b.reb,
      b.steals,
      b.blocks,
      b.min
    FROM fact_player_game_boxscore b
    JOIN dim_player p ON b.player_id = p.player_id
    JOIN team_dedup t ON b.team_id = t.team_id
    WHERE b.game_id = $1
    ORDER BY b.team_id, b.points DESC
  `,
    [gameId],
  );
}

/**
 * Loads field-goal shot coordinate events for a game.
 *
 * Filters to play-by-play events where is_field_goal = true and
 * x/y coordinates are present. Used for shot-chart rendering.
 *
 * Single source of truth: used by GameCenterTab.loadGameDetails() and test helpers.
 */
export async function loadGameShots(gameId: string): Promise<any[]> {
  return query(
    `
    SELECT
      player_id,
      team_id,
      action_type,
      shot_result,
      x,
      y
    FROM fact_pbp_events
    WHERE game_id = $1
      AND is_field_goal = true
      AND x IS NOT NULL
      AND y IS NOT NULL
  `,
    [gameId],
  );
}
