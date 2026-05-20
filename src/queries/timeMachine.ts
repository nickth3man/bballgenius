import { query } from '../db.js';

/**
 * Loads the most recent awards for a player, grouped by award and season.
 *
 * Uses the 'award' column — not 'award_name', which does not exist in
 * fact_player_awards and would trigger a DuckDB Binder Error.
 *
 * Single source of truth: used by TimeMachineTab.loadPlayerDetails() and test helpers.
 */
export async function loadPlayerAwards(playerId: string): Promise<any[]> {
  return query(
    `
    SELECT award, season_year, count(*) as count
    FROM fact_player_awards
    WHERE player_id = $1
    GROUP BY award, season_year
    ORDER BY season_year DESC, award ASC
    LIMIT 5
  `,
    [playerId]
  );
}

/**
 * Loads career season-by-season statistics for a player.
 *
 * Returns one row per (season_year, is_playoffs) combination, ordered
 * newest-first with playoff rows before regular-season rows.
 *
 * Single source of truth: used by TimeMachineTab.loadPlayerDetails() and test helpers.
 */
export async function loadCareerStats(playerId: string): Promise<any[]> {
  return query(
    `
    SELECT
      season_year,
      is_playoffs,
      gp,
      gs,
      min,
      pts,
      ast,
      reb,
      stl,
      blk,
      ts_pct,
      per,
      bpm,
      vorp
    FROM fact_player_season_stats
    WHERE player_id = $1
    ORDER BY season_year DESC, is_playoffs DESC
  `,
    [playerId]
  );
}
