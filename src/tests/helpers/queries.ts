import { query } from '../../db.js';
import type { BoxScoreRow, GameShotRow } from '../../queries/gameCenter.js';

// ---------------------------------------------------------------------------
// Production queries — single source of truth.
// Tests import these directly; if the production SQL changes, tests follow.
// ---------------------------------------------------------------------------
export {
  loadBoxScoreWithTeamDedup,
  loadGameShots,
  loadRecentGames,
} from '../../queries/gameCenter.js';

export {
  findTeam,
  loadCareerStats,
  loadPlayerAwards,
  loadTeamRoster,
  loadTeamSeasonStats,
} from '../../queries/timeMachine.js';

// ---------------------------------------------------------------------------
// Mutation-test broken variants (test-only).
// These intentionally diverge from production to prove regression sensitivity.
// ---------------------------------------------------------------------------

/** Buggy variant: join dim_team without dedup — triggers duplicate player rows. */
export async function loadBoxScoreWithoutTeamDedup(gameId: string): Promise<BoxScoreRow[]> {
  return query<BoxScoreRow>(
    `
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
    JOIN dim_team t ON b.team_id = t.team_id
    WHERE b.game_id = $1
    ORDER BY b.team_id, b.points DESC
  `,
    [gameId],
  );
}

/** Broken variant: missing is_field_goal filter — includes non-shot events. */
export async function loadGameShotsBrokenFilter(gameId: string): Promise<GameShotRow[]> {
  return query<GameShotRow>(
    `
    SELECT player_id, team_id, action_type, shot_result, x, y
    FROM fact_pbp_events
    WHERE game_id = $1
      AND x IS NOT NULL AND y IS NOT NULL
      -- intentionally omits: AND is_field_goal = true
    ORDER BY period, action_number
    `,
    [gameId],
  );
}

/** Broken variant that references the non-existent award_name column. */
export async function loadPlayerAwardsBrokenColumn(playerId: string) {
  return query(
    `
    SELECT award_name, season_year, count(*) as count
    FROM fact_player_awards
    WHERE player_id = $1
    GROUP BY award_name, season_year
    ORDER BY season_year DESC, award_name ASC
    LIMIT 5
  `,
    [playerId],
  );
}
