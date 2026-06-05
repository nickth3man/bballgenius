import { query } from '../../core/db.js';
import { isHonorsDbConfigured, queryHonors } from '../../core/dbHonors.js';
import type { DbRow } from '../../core/types.js';
// Pure (non-DB) helpers re-exported from their canonical home so existing
// server-side imports keep working. The canonical module is intentionally free
// of `core/db.js` imports, which lets client bundles import it without pulling
// the CJS native `@duckdb/node-api` module into the browser graph.
//
// `import type` is required so the names are available in this file's local
// scope for type annotations below (a bare `export type { X } from 'y'` does
// NOT bring `X` into local scope — it only re-exports).
import type { GroupedAward, PlayerAwardRow } from './groupAwards.js';
import { dedupeCareerStats } from './utils/careerStats.js';
import { seasonEndYearToNbaLabel } from './utils/seasonYear.js';

export { groupAwardsByCategory } from './groupAwards.js';
export type { GroupedAward, PlayerAwardRow };

export interface PlayerSuggestion {
  player_id: string;
  full_name: string;
  from_year: number | string;
  to_year: number | string;
  is_active: boolean;
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

/* ───────────────────────────────────────────────
   Dossier types
   ─────────────────────────────────────────────── */

export interface PlayerMetaRow {
  person_id: string;
  full_name: string;
  bref_player_id: string | null;
  primary_position: string | null;
  height_inches: number | null;
  body_weight_lbs: number | null;
  birth_date: string | null;
  school: string | null;
  country: string | null;
  draft_year: number | null;
  draft_round: number | null;
  draft_number: number | null;
  from_year: number | null;
  to_year: number | null;
  is_hall_of_fame: boolean | null;
}

export interface PlayerCareerTotalsRow {
  player_id: string;
  full_name: string;
  position: string;
  career_gp: number | string;
  career_min: number | null;
  career_pts: number | null;
  career_ppg: number | null;
  career_rpg: number | null;
  career_apg: number | null;
  career_spg: number | null;
  career_bpg: number | null;
  career_fg_pct: number | null;
  career_fg3_pct: number | null;
  career_ft_pct: number | null;
  first_season: string;
  last_season: string;
  seasons_played: number | string;
}

export interface PlayerDraftRow {
  season_end_year: number;
  overall_pick: number;
  round: number;
  team: string;
  bref_player_id: string;
  player_name: string;
}

export interface PlayerCombineRow {
  season: string;
  player_id: string;
  player_name: string;
  position: string;
  height_wo_shoes: number | null;
  height_w_shoes: number | null;
  weight: number | null;
  wingspan: number | null;
  standing_reach: number | null;
  body_fat_pct: number | null;
  hand_length: number | null;
  hand_width: number | null;
  standing_vertical_leap: number | null;
  max_vertical_leap: number | null;
  lane_agility_time: number | null;
  modified_lane_agility_time: number | null;
  three_quarter_sprint: number | null;
  bench_press: number | null;
}

export interface PlayerAllStarRow {
  season_end_year: number;
  player_name: string;
  team: string;
  replaced: boolean;
}

export interface PlayerAwardVoteRow {
  season_end_year: number;
  award: string;
  age: number | null;
  first: number | null;
  pts_won: number | null;
  pts_max: number | null;
  share: number | null;
  winner: boolean;
}

export interface PlayerPerGameRow {
  season_end_year: number;
  age: number | null;
  team: string;
  pos: string;
  g: number | null;
  gs: number | null;
  mp_per_game: number | null;
  fg_per_game: number | null;
  fga_per_game: number | null;
  fg_percent: number | null;
  x3p_per_game: number | null;
  x3pa_per_game: number | null;
  x3p_percent: number | null;
  ft_per_game: number | null;
  fta_per_game: number | null;
  ft_percent: number | null;
  orb_per_game: number | null;
  drb_per_game: number | null;
  trb_per_game: number | null;
  ast_per_game: number | null;
  stl_per_game: number | null;
  blk_per_game: number | null;
  tov_per_game: number | null;
  pf_per_game: number | null;
  pts_per_game: number | null;
}

export interface PlayerTotalsRow {
  season_end_year: number;
  age: number | null;
  team: string;
  pos: string;
  g: number | null;
  gs: number | null;
  mp: number | null;
  fg: number | null;
  fga: number | null;
  fg_percent: number | null;
  x3p: number | null;
  x3pa: number | null;
  x3p_percent: number | null;
  ft: number | null;
  fta: number | null;
  ft_percent: number | null;
  orb: number | null;
  drb: number | null;
  trb: number | null;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  tov: number | null;
  pf: number | null;
  pts: number | null;
  trp_dbl: number | null;
}

export interface PlayerPer36Row {
  season_end_year: number;
  age: number | null;
  team: string;
  pos: string;
  g: number | null;
  gs: number | null;
  mp: number | null;
  fg_per_36_min: number | null;
  fga_per_36_min: number | null;
  fg_percent: number | null;
  x3p_per_36_min: number | null;
  x3pa_per_36_min: number | null;
  x3p_percent: number | null;
  ft_per_36_min: number | null;
  fta_per_36_min: number | null;
  ft_percent: number | null;
  orb_per_36_min: number | null;
  drb_per_36_min: number | null;
  trb_per_36_min: number | null;
  ast_per_36_min: number | null;
  stl_per_36_min: number | null;
  blk_per_36_min: number | null;
  tov_per_36_min: number | null;
  pf_per_36_min: number | null;
  pts_per_36_min: number | null;
}

export interface PlayerAdvancedRow {
  season_end_year: number;
  age: number | null;
  team: string;
  pos: string;
  g: number | null;
  gs: number | null;
  mp: number | null;
  per: number | null;
  ts_percent: number | null;
  x3p_ar: number | null;
  f_tr: number | null;
  orb_percent: number | null;
  drb_percent: number | null;
  trb_percent: number | null;
  ast_percent: number | null;
  stl_percent: number | null;
  blk_percent: number | null;
  tov_percent: number | null;
  usg_percent: number | null;
  ows: number | null;
  dws: number | null;
  ws: number | null;
  ws_48: number | null;
  obpm: number | null;
  dbpm: number | null;
  bpm: number | null;
  vorp: number | null;
}

export interface PlayerShootingRow {
  season_end_year: number;
  age: number | null;
  team: string;
  pos: string;
  g: number | null;
  gs: number | null;
  mp: number | null;
  fg_percent: number | null;
  avg_dist_fga: number | null;
  percent_fga_from_x2p_range: number | null;
  percent_fga_from_x0_3_range: number | null;
  percent_fga_from_x3_10_range: number | null;
  percent_fga_from_x10_16_range: number | null;
  percent_fga_from_x16_3p_range: number | null;
  percent_fga_from_x3p_range: number | null;
  fg_percent_from_x2p_range: number | null;
  fg_percent_from_x0_3_range: number | null;
  fg_percent_from_x3_10_range: number | null;
  fg_percent_from_x10_16_range: number | null;
  fg_percent_from_x16_3p_range: number | null;
  fg_percent_from_x3p_range: number | null;
  percent_assisted_x2p_fg: number | null;
  percent_assisted_x3p_fg: number | null;
  percent_dunks_of_fga: number | null;
  num_of_dunks: number | null;
  percent_corner_3s_of_3pa: number | string | null;
  corner_3_point_percent: number | null;
  num_heaves_attempted: number | null;
  num_heaves_made: number | null;
}

export interface PlayerPlayByPlayRow {
  season_end_year: number;
  age: number | null;
  team: string;
  pos: string;
  g: number | null;
  gs: number | null;
  mp: number | null;
  pg_percent: number | null;
  sg_percent: number | null;
  sf_percent: number | null;
  pf_percent: number | null;
  c_percent: number | null;
  on_court_plus_minus_per_100_poss: number | null;
  net_plus_minus_per_100_poss: number | null;
  bad_pass_turnover: number | string | null;
  lost_ball_turnover: number | string | null;
  shooting_foul_committed: number | string | null;
  offensive_foul_committed: number | string | null;
  shooting_foul_drawn: number | string | null;
  offensive_foul_drawn: number | string | null;
  points_generated_by_assists: number | null;
  and1: number | string | null;
  fga_blocked: number | null;
}

export interface PlayerGameLogRow {
  game_date: string;
  matchup: string;
  wl: string;
  min: number | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  plus_minus: number | null;
  fgm: number | null;
  fga: number | null;
  fg_pct: number | null;
  fg3m: number | null;
  fg3a: number | null;
  fg3_pct: number | null;
  ftm: number | null;
  fta: number | null;
  ft_pct: number | null;
  oreb: number | null;
  dreb: number | null;
  tov: number | null;
  pf: number | null;
}

export interface PlayerFranchiseStandingRow {
  category: 'PTS' | 'REB' | 'AST' | 'STL' | 'BLK';
  team: string;
  value: number;
}

export interface PlayerShotZoneRow {
  zone: string;
  fga: number;
  fgm: number;
  fg_pct: number;
}

/* ───────────────────────────────────────────────
   Dossier bundle type
   ─────────────────────────────────────────────── */

export interface PlayerDossier {
  meta: PlayerMetaRow | null;
  totals: PlayerCareerTotalsRow | null;
  draft: PlayerDraftRow | null;
  combine: PlayerCombineRow | null;
  awards: PlayerAwardRow[];
  allStar: PlayerAllStarRow[];
  votes: PlayerAwardVoteRow[];
  perGame: PlayerPerGameRow[];
  totalsSeason: PlayerTotalsRow[];
  per36: PlayerPer36Row[];
  advanced: PlayerAdvancedRow[];
  shooting: PlayerShootingRow[];
  playByPlay: PlayerPlayByPlayRow[];
  gameLog: PlayerGameLogRow[];
  franchise: PlayerFranchiseStandingRow[];
  shotZones: PlayerShotZoneRow[];
}

/* ───────────────────────────────────────────────
   Helpers
   ─────────────────────────────────────────────── */

interface HonorsRow {
  award: string;
  season_year: number | string;
  count: number | string;
}

function mapAwardRows(rows: HonorsRow[]): PlayerAwardRow[] {
  return rows.map((row) => ({
    award: String(row.award),
    season_year: seasonEndYearToNbaLabel(row.season_year),
    count: row.count,
  }));
}

/* ───────────────────────────────────────────────
   Existing public API
   ─────────────────────────────────────────────── */

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

/* ───────────────────────────────────────────────
   Dossier queries
   ─────────────────────────────────────────────── */

/**
 * Enriched player meta row joining main.dim_player, the source-id bridge,
 * and main.dim_bref_player for BBR-specific attributes.
 */
export async function loadPlayerMeta(playerId: string): Promise<PlayerMetaRow | null> {
  const rows = await query<PlayerMetaRow>(
    `
    SELECT
      CAST(p.person_id AS VARCHAR) AS person_id,
      p.first_name || ' ' || p.last_name AS full_name,
      src.source_player_id AS bref_player_id,
      bp.primary_position AS primary_position,
      COALESCE(bp.height_inches, p.height_inches) AS height_inches,
      COALESCE(bp.body_weight_lbs, p.body_weight_lbs) AS body_weight_lbs,
      CAST(COALESCE(bp.birth_date, p.birth_date) AS VARCHAR) AS birth_date,
      p.school AS school,
      p.country AS country,
      p.draft_year AS draft_year,
      p.draft_round AS draft_round,
      p.draft_number AS draft_number,
      p.from_year AS from_year,
      p.to_year AS to_year,
      bp.is_hall_of_fame AS is_hall_of_fame
    FROM main.dim_player p
    LEFT JOIN main.bridge_player_source_id src
      ON src.person_id = p.person_id
      AND src.source_system = 'basketball_reference'
    LEFT JOIN main.dim_bref_player bp
      ON bp.bref_player_id = src.source_player_id
    WHERE p.person_id = CAST($1 AS INTEGER)
    LIMIT 1
  `,
    [playerId],
  );
  return rows[0] ?? null;
}

/** Career totals from the aggregate view. */
export async function loadPlayerCareerTotals(
  playerId: string,
): Promise<PlayerCareerTotalsRow | null> {
  const rows = await query<PlayerCareerTotalsRow>(
    `
    SELECT
      CAST(player_id AS VARCHAR) AS player_id,
      full_name,
      position,
      career_gp,
      career_min,
      career_pts,
      career_ppg,
      career_rpg,
      career_apg,
      career_spg,
      career_bpg,
      career_fg_pct,
      career_fg3_pct,
      career_ft_pct,
      first_season,
      last_season,
      seasons_played
    FROM api.v_player_career
    WHERE player_id = CAST($1 AS INTEGER)
    LIMIT 1
  `,
    [playerId],
  );
  return rows[0] ?? null;
}

/** Draft pick info resolved via the BBR bridge. */
export async function loadPlayerDraft(playerId: string): Promise<PlayerDraftRow | null> {
  const rows = await query<PlayerDraftRow>(
    `
    SELECT
      d.season_end_year,
      d.overall_pick,
      d.round,
      d.tm AS team,
      d.bref_player_id,
      d.player_name
    FROM main.bridge_player_source_id src
    JOIN main.fact_draft_pick_bref d
      ON d.bref_player_id = src.source_player_id
    WHERE src.person_id = CAST($1 AS INTEGER)
      AND src.source_system = 'basketball_reference'
    LIMIT 1
  `,
    [playerId],
  );
  return rows[0] ?? null;
}

/** Draft combine measurements. */
export async function loadPlayerCombine(playerId: string): Promise<PlayerCombineRow | null> {
  const rows = await query<PlayerCombineRow>(
    `
    SELECT
      season,
      CAST(player_id AS VARCHAR) AS player_id,
      player_name,
      position,
      height_wo_shoes,
      height_w_shoes,
      weight,
      wingspan,
      standing_reach,
      body_fat_pct,
      hand_length,
      hand_width,
      standing_vertical_leap,
      max_vertical_leap,
      lane_agility_time,
      modified_lane_agility_time,
      three_quarter_sprint,
      bench_press
    FROM api.v_draft_combine
    WHERE player_id = CAST($1 AS INTEGER)
    LIMIT 1
  `,
    [playerId],
  );
  return rows[0] ?? null;
}

/** All-Star selections. */
export async function loadPlayerAllStarSelections(playerId: string): Promise<PlayerAllStarRow[]> {
  return query<PlayerAllStarRow>(
    `
    SELECT
      season_end_year,
      player_name,
      team,
      replaced
    FROM main.fact_all_star_selection
    WHERE person_id = CAST($1 AS INTEGER)
    ORDER BY season_end_year ASC
  `,
    [playerId],
  );
}

/** Award vote rows (MVP, ROY, DPOY, etc.). */
export async function loadPlayerAwardVotes(playerId: string): Promise<PlayerAwardVoteRow[]> {
  return query<PlayerAwardVoteRow>(
    `
    SELECT
      season_end_year,
      award,
      age,
      first,
      pts_won,
      pts_max,
      share,
      winner
    FROM main.fact_player_award_vote
    WHERE person_id = CAST($1 AS INTEGER)
    ORDER BY season_end_year DESC, award ASC
  `,
    [playerId],
  );
}

/** Per-game averages by season. */
export async function loadPlayerPerGame(playerId: string): Promise<PlayerPerGameRow[]> {
  return query<PlayerPerGameRow>(
    `
    SELECT
      season_end_year,
      age,
      team,
      pos,
      g,
      gs,
      mp_per_game,
      fg_per_game,
      fga_per_game,
      fg_percent,
      x3p_per_game,
      x3pa_per_game,
      x3p_percent,
      ft_per_game,
      fta_per_game,
      ft_percent,
      orb_per_game,
      drb_per_game,
      trb_per_game,
      ast_per_game,
      stl_per_game,
      blk_per_game,
      tov_per_game,
      pf_per_game,
      pts_per_game
    FROM main.fact_bref_player_season_per_game
    WHERE person_id = CAST($1 AS INTEGER)
    ORDER BY season_end_year ASC
  `,
    [playerId],
  );
}

/** Season totals. */
export async function loadPlayerTotals(playerId: string): Promise<PlayerTotalsRow[]> {
  return query<PlayerTotalsRow>(
    `
    SELECT
      season_end_year,
      age,
      team,
      pos,
      g,
      gs,
      mp,
      fg,
      fga,
      fg_percent,
      x3p,
      x3pa,
      x3p_percent,
      ft,
      fta,
      ft_percent,
      orb,
      drb,
      trb,
      ast,
      stl,
      blk,
      tov,
      pf,
      pts,
      trp_dbl
    FROM main.fact_bref_player_season_totals
    WHERE person_id = CAST($1 AS INTEGER)
    ORDER BY season_end_year ASC
  `,
    [playerId],
  );
}

/** Per-36-minute stats. */
export async function loadPlayerPer36(playerId: string): Promise<PlayerPer36Row[]> {
  return query<PlayerPer36Row>(
    `
    SELECT
      season_end_year,
      age,
      team,
      pos,
      g,
      gs,
      mp,
      fg_per_36_min,
      fga_per_36_min,
      fg_percent,
      x3p_per_36_min,
      x3pa_per_36_min,
      x3p_percent,
      ft_per_36_min,
      fta_per_36_min,
      ft_percent,
      orb_per_36_min,
      drb_per_36_min,
      trb_per_36_min,
      ast_per_36_min,
      stl_per_36_min,
      blk_per_36_min,
      tov_per_36_min,
      pf_per_36_min,
      pts_per_36_min
    FROM main.fact_bref_player_season_per36
    WHERE person_id = CAST($1 AS INTEGER)
    ORDER BY season_end_year ASC
  `,
    [playerId],
  );
}

/** Advanced stats (PER, WS, BPM, VORP, etc.) — casts per from VARCHAR to DOUBLE. */
export async function loadPlayerAdvanced(playerId: string): Promise<PlayerAdvancedRow[]> {
  return query<PlayerAdvancedRow>(
    `
    SELECT
      season_end_year,
      age,
      team,
      pos,
      g,
      gs,
      mp,
      CAST(per AS DOUBLE) AS per,
      ts_percent,
      x3p_ar,
      f_tr,
      orb_percent,
      drb_percent,
      trb_percent,
      ast_percent,
      stl_percent,
      blk_percent,
      tov_percent,
      usg_percent,
      ows,
      dws,
      ws,
      ws_48,
      obpm,
      dbpm,
      bpm,
      vorp
    FROM main.fact_bref_player_season_advanced
    WHERE person_id = CAST($1 AS INTEGER)
    ORDER BY season_end_year ASC
  `,
    [playerId],
  );
}

/** Shooting breakdowns (post-2000). */
export async function loadPlayerShooting(playerId: string): Promise<PlayerShootingRow[]> {
  return query<PlayerShootingRow>(
    `
    SELECT
      season_end_year,
      age,
      team,
      pos,
      g,
      gs,
      mp,
      fg_percent,
      avg_dist_fga,
      percent_fga_from_x2p_range,
      percent_fga_from_x0_3_range,
      percent_fga_from_x3_10_range,
      percent_fga_from_x10_16_range,
      percent_fga_from_x16_3p_range,
      percent_fga_from_x3p_range,
      fg_percent_from_x2p_range,
      fg_percent_from_x0_3_range,
      fg_percent_from_x3_10_range,
      fg_percent_from_x10_16_range,
      fg_percent_from_x16_3p_range,
      fg_percent_from_x3p_range,
      percent_assisted_x2p_fg,
      percent_assisted_x3p_fg,
      percent_dunks_of_fga,
      num_of_dunks,
      percent_corner_3s_of_3pa,
      corner_3_point_percent,
      num_heaves_attempted,
      num_heaves_made
    FROM main.fact_bref_player_season_shooting
    WHERE person_id = CAST($1 AS INTEGER)
    ORDER BY season_end_year ASC
  `,
    [playerId],
  );
}

/** Play-by-play derived stats (position percentages, plus-minus, etc.). */
export async function loadPlayerPlayByPlay(playerId: string): Promise<PlayerPlayByPlayRow[]> {
  return query<PlayerPlayByPlayRow>(
    `
    SELECT
      season_end_year,
      age,
      team,
      pos,
      g,
      gs,
      mp,
      pg_percent,
      sg_percent,
      sf_percent,
      pf_percent,
      c_percent,
      on_court_plus_minus_per_100_poss,
      net_plus_minus_per_100_poss,
      bad_pass_turnover,
      lost_ball_turnover,
      shooting_foul_committed,
      offensive_foul_committed,
      shooting_foul_drawn,
      offensive_foul_drawn,
      points_generated_by_assists,
      and1,
      fga_blocked
    FROM main.fact_bref_player_season_play_by_play
    WHERE person_id = CAST($1 AS INTEGER)
    ORDER BY season_end_year ASC
  `,
    [playerId],
  );
}

/** Game log (nbadb schema). Default limit 25, newest first. */
export async function loadPlayerGameLog(
  playerId: string,
  limit: number = 25,
): Promise<PlayerGameLogRow[]> {
  return query<PlayerGameLogRow>(
    `
    SELECT
      game_date,
      matchup,
      wl,
      min,
      pts,
      reb,
      ast,
      stl,
      blk,
      plus_minus,
      fgm,
      fga,
      fg_pct,
      fg3m,
      fg3a,
      fg3_pct,
      ftm,
      fta,
      ft_pct,
      oreb,
      dreb,
      tov,
      pf
    FROM nbadb.fact_player_game_log
    WHERE player_id = CAST($1 AS INTEGER)
    ORDER BY game_date DESC
    LIMIT $2
  `,
    [playerId, limit],
  );
}

/**
 * Franchise standing rows — scans all 5 `*_person_id` columns in
 * api.v_franchise_leaders for a match and returns the category label.
 *
 * v_franchise_leaders may have multiple rows per (team, season) combination
 * with inconsistent `team` string formats, so we dedupe to one row per
 * category — keeping the highest value seen across all rows — to avoid
 * listing the same leader record several times for the same player.
 */
export async function loadPlayerFranchiseStanding(
  playerId: string,
): Promise<PlayerFranchiseStandingRow[]> {
  const pid = Number(playerId);
  const all = await query<DbRow>('SELECT * FROM api.v_franchise_leaders');
  const dedupe = new Map<PlayerFranchiseStandingRow['category'], PlayerFranchiseStandingRow>();

  for (const row of all) {
    const cats: [string, string, string][] = [
      ['PTS', 'pts_person_id', 'pts'],
      ['REB', 'reb_person_id', 'reb'],
      ['AST', 'ast_person_id', 'ast'],
      ['STL', 'stl_person_id', 'stl'],
      ['BLK', 'blk_person_id', 'blk'],
    ];
    for (const [category, idCol, valCol] of cats) {
      if (String(row[idCol]) === String(pid)) {
        const value = Number(row[valCol]);
        const team = String(row.team);
        const cat = category as PlayerFranchiseStandingRow['category'];
        const existing = dedupe.get(cat);
        if (!existing || value > existing.value) {
          dedupe.set(cat, { category: cat, team, value });
        }
      }
    }
  }

  return Array.from(dedupe.values());
}

/**
 * Shot-zone aggregation — looks up the player name from unified_star.dim_player,
 * then groups api.v_shot_chart by shot_zone_basic.
 */
export async function loadPlayerShotZones(playerId: string): Promise<PlayerShotZoneRow[]> {
  const nameRows = await query<DbRow>(
    'SELECT full_name FROM unified_star.dim_player WHERE player_id = CAST($1 AS INTEGER) LIMIT 1',
    [playerId],
  );
  const name = nameRows[0]?.full_name;
  if (!name) return [];

  const raw = await query<DbRow>(
    `
    SELECT
      shot_zone_basic,
      COUNT(*) AS fga,
      SUM(CASE WHEN shot_made_flag = 1 THEN 1 ELSE 0 END) AS fgm
    FROM api.v_shot_chart
    WHERE player_name = $1
    GROUP BY shot_zone_basic
    ORDER BY fga DESC
  `,
    [String(name)],
  );

  return raw.map((r) => ({
    zone: String(r.shot_zone_basic),
    fga: Number(r.fga) || 0,
    fgm: Number(r.fgm) || 0,
    fg_pct: Number(r.fga) ? Number(r.fgm) / Number(r.fga) : 0,
  }));
}

/* ───────────────────────────────────────────────
   Dossier bundle loader
   ─────────────────────────────────────────────── */

/**
 * Loads the full player dossier by calling all 13 data loaders with
 * Promise.allSettled so a missing view or column doesn't crash the page.
 * Each failing loader logs a warning to stderr and returns its default value.
 */
export async function loadPlayerDossier(playerId: string): Promise<PlayerDossier> {
  const results = await Promise.allSettled([
    loadPlayerMeta(playerId),
    loadPlayerCareerTotals(playerId),
    loadPlayerDraft(playerId),
    loadPlayerCombine(playerId),
    loadPlayerAwards(playerId),
    loadPlayerAllStarSelections(playerId),
    loadPlayerAwardVotes(playerId),
    loadPlayerPerGame(playerId),
    loadPlayerTotals(playerId),
    loadPlayerPer36(playerId),
    loadPlayerAdvanced(playerId),
    loadPlayerShooting(playerId),
    loadPlayerPlayByPlay(playerId),
    loadPlayerGameLog(playerId),
    loadPlayerFranchiseStanding(playerId),
    loadPlayerShotZones(playerId),
  ]);

  const settled = <T>(r: PromiseSettledResult<T>, fallback: T): T => {
    if (r.status === 'fulfilled') return r.value;
    console.warn('[loadPlayerDossier] loader failed:', r.reason);
    return fallback;
  };

  return {
    meta: settled(results[0], null),
    totals: settled(results[1], null),
    draft: settled(results[2], null),
    combine: settled(results[3], null),
    awards: settled(results[4], []),
    allStar: settled(results[5], []),
    votes: settled(results[6], []),
    perGame: settled(results[7], []),
    totalsSeason: settled(results[8], []),
    per36: settled(results[9], []),
    advanced: settled(results[10], []),
    shooting: settled(results[11], []),
    playByPlay: settled(results[12], []),
    gameLog: settled(results[13], []),
    franchise: settled(results[14], []),
    shotZones: settled(results[15], []),
  };
}

/* ───────────────────────────────────────────────
   Legacy award loading
   ─────────────────────────────────────────────── */

async function loadPlayerAwardsFromHonorsDb(playerId: string): Promise<PlayerAwardRow[]> {
  const rows = await queryHonors<HonorsRow>(
    `
    SELECT
      CASE
        WHEN source_table = 'fact_player_honor' AND number_tm IS NOT NULL
          THEN type || ' ' || number_tm
        ELSE type
      END AS award,
      season_end_year AS season_year,
      1 AS count
    FROM v_player_honors_full
    WHERE CAST(person_id AS VARCHAR) = $1
      AND (source_table = 'fact_player_honor' OR is_winner = true)
    ORDER BY season_end_year DESC, type ASC
  `,
    [playerId],
  );

  return mapAwardRows(rows);
}

async function loadPlayerAwardsFromPrimaryHonorsView(playerId: string): Promise<PlayerAwardRow[]> {
  const rows = await query<HonorsRow>(
    `
    SELECT
      CASE
        WHEN source_table = 'fact_player_honor' AND number_tm IS NOT NULL
          THEN type || ' ' || number_tm
        ELSE type
      END AS award,
      season_end_year AS season_year,
      1 AS count
    FROM main.v_player_honors_full
    WHERE CAST(person_id AS VARCHAR) = $1
      AND (source_table = 'fact_player_honor' OR is_winner = true)
    ORDER BY season_end_year DESC, type ASC
  `,
    [playerId],
  );

  return mapAwardRows(rows);
}

async function loadPlayerAwardsFromPrimaryDb(playerId: string): Promise<PlayerAwardRow[]> {
  return query<PlayerAwardRow>(
    `
    SELECT award, season_year, count(*) as count
    FROM fact_player_awards
    WHERE player_id = $1
      AND is_winner = true
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
 * from `v_player_honors_full`. Otherwise prefers the primary database's honors view so
 * team honors (All-NBA, All-Rookie) are displayed and award-share vote rows are only
 * shown when they are actual winners. Legacy databases fall back to `fact_player_awards`.
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

  try {
    const primaryHonorRows = await loadPlayerAwardsFromPrimaryHonorsView(playerId);
    if (primaryHonorRows.length > 0) {
      return primaryHonorRows;
    }
  } catch {
    // Fall back to the legacy unified_star fact table when the honors view is unavailable.
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

/* ───────────────────────────────────────────────
   Team queries
   ─────────────────────────────────────────────── */

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
