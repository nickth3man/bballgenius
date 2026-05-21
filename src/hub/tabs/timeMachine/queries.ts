import { query } from '../../core/db.js';
import { isHonorsDbConfigured, queryHonors } from '../../core/dbHonors.js';
import type { DbRow } from '../../core/types.js';
import type { PlayerSuggestion } from './types.js';
import { dedupeCareerStats } from './utils/careerStats.js';
import { seasonEndYearToNbaLabel } from './utils/seasonYear.js';

export interface PlayerAwardRow {
  award: string;
  season_year: string;
  count: number | string;
}

export interface CareerStatRow {
  season_year: string;
  is_playoffs: boolean;
  gp: number | string;
  gs: number | string | null;
  min: number | string;
  pts: number | string;
  ast: number | string;
  reb: number | string | null;
  stl: number | string | null;
  blk: number | string | null;
  ts_pct: number | null;
  per: number | null;
  bpm: number | null;
  vorp: number | null;
}

export interface TeamRow {
  team_id: string;
  team_abbrev: string;
  team_name: string;
}

export interface TeamSeasonStatsRow {
  gp: number | string;
  ppg: number | string;
  apg: number | string;
  rpg: number | string;
  spg: number | string;
  bpg: number | string;
}

export interface TeamRosterRow {
  full_name: string;
  gp: number | string;
  ppg: number | string;
  apg: number | string;
  rpg: number | string;
}

interface HonorsRow {
  award: string;
  season_year: number | string;
  count: number | string;
}

/** Loads the default startup player (LeBron James) when present in dim_player. */
export async function loadDefaultPlayer(): Promise<PlayerSuggestion | null> {
  const rows = await query<PlayerSuggestion>(`
    SELECT player_id, full_name, from_year, to_year, is_active
    FROM dim_player
    WHERE full_name = 'LeBron James'
    LIMIT 1
  `);
  return rows[0] ?? null;
}

/** Autocomplete search for players by name fragment. */
export async function searchPlayerSuggestions(q: string): Promise<PlayerSuggestion[]> {
  return query<PlayerSuggestion>(
    `
    SELECT player_id, full_name, from_year, to_year, is_active
    FROM dim_player
    WHERE lower(full_name) LIKE lower($1)
    ORDER BY to_year DESC, full_name ASC
    LIMIT 8
  `,
    [`%${q}%`],
  );
}

/** Full dim_player row for dossier rendering. */
export async function loadPlayerMeta(playerId: string): Promise<DbRow | null> {
  const rows = await query<DbRow>(
    `
    SELECT * FROM dim_player WHERE player_id = $1 LIMIT 1
  `,
    [playerId],
  );
  return rows[0] ?? null;
}

async function loadPlayerAwardsFromHonorsDb(playerId: string): Promise<PlayerAwardRow[]> {
  const rows = await queryHonors<HonorsRow>(
    `
    SELECT
      type AS award,
      season_end_year AS season_year,
      1 AS count
    FROM v_player_honors_full
    WHERE CAST(person_id AS VARCHAR) = $1
      AND is_winner = true
    ORDER BY season_end_year DESC, type ASC
  `,
    [playerId],
  );

  return rows.map((row) => ({
    award: String(row.award),
    season_year: seasonEndYearToNbaLabel(row.season_year),
    count: row.count,
  }));
}

async function loadPlayerAwardsFromPrimaryDb(playerId: string): Promise<PlayerAwardRow[]> {
  return query<PlayerAwardRow>(
    `
    SELECT award, season_year, count(*) as count
    FROM fact_player_awards
    WHERE player_id = $1
    GROUP BY award, season_year
    ORDER BY season_year DESC, award ASC
  `,
    [playerId],
  );
}

/**
 * Loads accolades for a player.
 *
 * When `NBA_HONORS_DUCKDB_PATH` points at a basketball-data DuckDB file, winners are read
 * from `v_player_honors_full` (accurate MVP counts). Otherwise uses `fact_player_awards`
 * on the primary database from `NBA_DUCKDB_PATH` / `data/nba.duckdb`.
 */
export async function loadPlayerAwards(playerId: string): Promise<PlayerAwardRow[]> {
  if (isHonorsDbConfigured()) {
    try {
      const honorsRows = await loadPlayerAwardsFromHonorsDb(playerId);
      if (honorsRows.length > 0) {
        return honorsRows;
      }
    } catch {
      // Fall back to primary schema if honors view is missing or incompatible.
    }
  }

  return loadPlayerAwardsFromPrimaryDb(playerId);
}

/**
 * Loads career season-by-season statistics for a player.
 *
 * Returns one row per (season_year, is_playoffs) combination, ordered
 * newest-first with playoff rows before regular-season rows.
 */
export async function loadCareerStats(playerId: string): Promise<CareerStatRow[]> {
  const rows = await query<CareerStatRow>(
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
    [playerId],
  );
  return dedupeCareerStats(rows);
}

/**
 * Looks up a team by its abbreviation or name.
 */
export async function findTeam(queryStr: string): Promise<TeamRow | null> {
  const rows = await query<TeamRow>(
    `
    SELECT team_id, team_abbrev, team_name
    FROM dim_team
    WHERE lower(team_abbrev) = lower($1)
       OR lower(team_name) = lower($1)
       OR lower(team_name) LIKE lower($2)
    ORDER BY season_active_till DESC
    LIMIT 1
  `,
    [queryStr, `%${queryStr}%`],
  );
  return rows[0] || null;
}

/**
 * Loads team seasonal statistics (GP, PPG, APG, RPG, SPG, BPG) for a specific team and season.
 */
export async function loadTeamSeasonStats(
  teamId: string,
  seasonYearPattern: string,
): Promise<TeamSeasonStatsRow | null> {
  const rows = await query<TeamSeasonStatsRow>(
    `
    WITH game_totals AS (
      SELECT
        g.game_id,
        sum(b.points) as pts,
        sum(b.assists) as ast,
        sum(b.reb) as reb,
        sum(b.steals) as stl,
        sum(b.blocks) as blk
      FROM fact_player_game_boxscore b
      JOIN dim_game g ON b.game_id = g.game_id
      WHERE b.team_id = $1 AND g.season_year LIKE $2
      GROUP BY g.game_id
    )
    SELECT
      count(*) as gp,
      avg(pts) as ppg,
      avg(ast) as apg,
      avg(reb) as rpg,
      avg(stl) as spg,
      avg(blk) as bpg
    FROM game_totals
  `,
    [teamId, `${seasonYearPattern}%`],
  );
  return rows[0] || null;
}

/**
 * Loads team roster with individual averages for a specific team and season.
 */
export async function loadTeamRoster(
  teamId: string,
  seasonYearPattern: string,
): Promise<TeamRosterRow[]> {
  return query<TeamRosterRow>(
    `
    SELECT
      p.full_name,
      count(b.game_id) as gp,
      avg(b.points) as ppg,
      avg(b.assists) as apg,
      avg(b.reb) as rpg
    FROM fact_player_game_boxscore b
    JOIN dim_player p ON b.player_id = p.player_id
    JOIN dim_game g ON b.game_id = g.game_id
    WHERE b.team_id = $1 AND g.season_year LIKE $2
    GROUP BY p.player_id, p.full_name
    ORDER BY ppg DESC, p.full_name ASC
    LIMIT 15
  `,
    [teamId, `${seasonYearPattern}%`],
  );
}
