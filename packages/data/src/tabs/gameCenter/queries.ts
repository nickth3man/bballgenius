import { query } from '../../core/db.js';

export interface RecentGameRow {
  game_id: string;
  game_date: string;
  season_year: string;
  home_team: string;
  away_team: string;
  home_name: string;
  away_name: string;
}

export interface BoxScoreRow {
  player_id: string;
  full_name: string;
  team_id: string;
  team_abbrev: string;
  is_home: boolean;
  min: number | string;
  points: number | string;
  fgm: number | string;
  fga: number | string;
  fg_pct: number | string;
  fg3m: number | string;
  fg3a: number | string;
  fg3_pct: number | string;
  ftm: number | string;
  fta: number | string;
  ft_pct: number | string;
  oreb: number | string;
  dreb: number | string;
  reb: number | string;
  assists: number | string;
  steals: number | string;
  blocks: number | string;
  turnovers: number | string;
  fouls_personal: number | string;
  plus_minus: number | string;
}

export interface GameShotRow {
  player_id: string;
  team_id: string;
  action_type: string;
  shot_result: string;
  x: number;
  y: number;
}

/**
 * Loads recent games with deduplicated team abbreviations.
 *
 * Uses a DISTINCT ON CTE to collapse historic franchise renames
 * (e.g. Minneapolis Lakers → LA Lakers) to the most-recent name.
 *
 * Single source of truth: used by GameCenterTab.init() and test helpers.
 */
export async function loadRecentGames(limit = 40): Promise<RecentGameRow[]> {
  return query<RecentGameRow>(`
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
export async function loadBoxScoreWithTeamDedup(gameId: string): Promise<BoxScoreRow[]> {
  return query<BoxScoreRow>(
    `
    WITH team_dedup AS (
      SELECT DISTINCT ON (team_id) team_id, team_abbrev
      FROM dim_team
      ORDER BY team_id, season_active_till DESC
    )
    SELECT
      b.player_id,
      p.full_name,
      b.team_id,
      t.team_abbrev,
      b.is_home,
      b.min,
      b.points,
      b.fgm, b.fga, b.fg_pct,
      b.fg3m, b.fg3a, b.fg3_pct,
      b.ftm, b.fta, b.ft_pct,
      b.oreb, b.dreb, b.reb,
      b.assists,
      b.steals,
      b.blocks,
      b.turnovers,
      b.fouls_personal,
      b.plus_minus
    FROM fact_player_game_boxscore b
    JOIN dim_player p ON b.player_id = p.player_id
    JOIN team_dedup t ON b.team_id = t.team_id
    WHERE b.game_id = $1
    ORDER BY b.is_home, b.points DESC
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
export async function loadGameShots(gameId: string): Promise<GameShotRow[]> {
  return query<GameShotRow>(
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

export interface TeamTotals {
  min: number;
  points: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  reb: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls_personal: number;
}

/**
 * Computes aggregate team totals from an array of box-score rows.
 * Used by TeamBoxScoreTable in the web UI.
 */
export function computeTeamTotals(rows: BoxScoreRow[]): TeamTotals {
  return rows.reduce(
    (acc, r) => ({
      min: acc.min + Number(r.min ?? 0),
      points: acc.points + Number(r.points ?? 0),
      fgm: acc.fgm + Number(r.fgm ?? 0),
      fga: acc.fga + Number(r.fga ?? 0),
      fg3m: acc.fg3m + Number(r.fg3m ?? 0),
      fg3a: acc.fg3a + Number(r.fg3a ?? 0),
      ftm: acc.ftm + Number(r.ftm ?? 0),
      fta: acc.fta + Number(r.fta ?? 0),
      oreb: acc.oreb + Number(r.oreb ?? 0),
      dreb: acc.dreb + Number(r.dreb ?? 0),
      reb: acc.reb + Number(r.reb ?? 0),
      assists: acc.assists + Number(r.assists ?? 0),
      steals: acc.steals + Number(r.steals ?? 0),
      blocks: acc.blocks + Number(r.blocks ?? 0),
      turnovers: acc.turnovers + Number(r.turnovers ?? 0),
      fouls_personal: acc.fouls_personal + Number(r.fouls_personal ?? 0),
    }),
    {
      min: 0,
      points: 0,
      fgm: 0,
      fga: 0,
      fg3m: 0,
      fg3a: 0,
      ftm: 0,
      fta: 0,
      oreb: 0,
      dreb: 0,
      reb: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      fouls_personal: 0,
    },
  );
}
