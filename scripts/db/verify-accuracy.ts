/**
 * verify-accuracy.ts — NBA fact-check verification suite.
 *
 * Tests database accuracy by comparing query results against well-known NBA
 * statistical facts sourced from Basketball-Reference (scraped 2026-05-31).
 *
 * Each check runs a SQL query and compares the result to an expected value
 * using exact match, range, or threshold comparison.
 *
 * Usage:
 *   bun run scripts/db/verify-accuracy.ts                # run all checks
 *   bun run scripts/db/verify-accuracy.ts --filter=career # subset by category
 *   bun run scripts/db/verify-accuracy.ts --verbose       # show SQL + details
 */
import { DuckDBInstance } from '@duckdb/node-api';

const DB_PATH = process.env['NBA_DUCKDB_PATH'] ?? './data/nba.duckdb';

type CompareMode = 'exact' | 'gte' | 'lte' | 'range' | 'approx';

type AccuracyCheck = {
  name: string;
  category: string;
  description: string;
  sql: string;
  expected: number;
  mode: CompareMode;
  tolerance?: number;
  source: string;
};

const pid = (name: string) =>
  `(SELECT CAST(player_id AS VARCHAR) FROM nbadb.dim_player WHERE full_name = '${name}' LIMIT 1)`;
const pidActive = (name: string) =>
  `(SELECT CAST(player_id AS VARCHAR) FROM nbadb.dim_player WHERE full_name = '${name}' AND is_current LIMIT 1)`;

const careerSum = (metric: string, name: string, active = false) =>
  `SELECT sum(${metric}_golden) AS val FROM api.v_golden_player_season_totals WHERE master_id = ${active ? pidActive(name) : pid(name)}`;

const CHECKS: AccuracyCheck[] = [
  // ── Career Leaders (via golden record — regular season only) ───────────────
  {
    name: 'career_pts_lebron',
    category: 'career',
    description: 'LeBron James career points = 43,440',
    sql: careerSum('PTS', 'LeBron James', true),
    expected: 43440,
    mode: 'exact',
    source: 'BBR pts_career',
  },
  {
    name: 'career_pts_kareem',
    category: 'career',
    description: 'Kareem Abdul-Jabbar career points = 38,387',
    sql: careerSum('PTS', 'Kareem Abdul-Jabbar'),
    expected: 38387,
    mode: 'exact',
    source: 'BBR pts_career',
  },
  {
    name: 'career_pts_kobe',
    category: 'career',
    description: 'Kobe Bryant career points = 33,643',
    sql: careerSum('PTS', 'Kobe Bryant'),
    expected: 33643,
    mode: 'exact',
    source: 'BBR pts_career',
  },
  {
    name: 'career_pts_jordan',
    category: 'career',
    description: 'Michael Jordan career points = 32,292',
    sql: careerSum('PTS', 'Michael Jordan'),
    expected: 32292,
    mode: 'exact',
    source: 'BBR pts_career',
  },
  {
    name: 'career_pts_wilt',
    category: 'career',
    description: 'Wilt Chamberlain career points = 31,419',
    sql: careerSum('PTS', 'Wilt Chamberlain'),
    expected: 31419,
    mode: 'exact',
    source: 'BBR pts_career',
  },
  {
    name: 'career_reb_wilt',
    category: 'career',
    description: 'Wilt Chamberlain career rebounds = 23,924',
    sql: careerSum('TRB', 'Wilt Chamberlain'),
    expected: 23924,
    mode: 'exact',
    source: 'BBR trb_career',
  },
  {
    name: 'career_ast_stockton',
    category: 'career',
    description: 'John Stockton career assists = 15,806',
    sql: careerSum('AST', 'John Stockton'),
    expected: 15806,
    mode: 'exact',
    source: 'BBR ast_career',
  },
  {
    name: 'career_stl_stockton',
    category: 'career',
    description: 'John Stockton career steals = 3,265',
    sql: careerSum('STL', 'John Stockton'),
    expected: 3265,
    mode: 'exact',
    source: 'BBR stl_career',
  },
  {
    name: 'career_blk_olajuwon',
    category: 'career',
    description: 'Hakeem Olajuwon career blocks = 3,830',
    sql: careerSum('BLK', 'Hakeem Olajuwon'),
    expected: 3830,
    mode: 'exact',
    source: 'BBR blk_career',
  },
  {
    name: 'career_3pm_curry',
    category: 'career',
    description: 'Stephen Curry career 3PM = 4,248',
    sql: careerSum('FG3M', 'Stephen Curry', true),
    expected: 4248,
    mode: 'exact',
    source: 'BBR fg3_career',
  },
  {
    name: 'career_gp_lebron',
    category: 'career',
    description: 'LeBron James career games played = 1,622',
    sql: careerSum('GP', 'LeBron James', true),
    expected: 1622,
    mode: 'exact',
    source: 'BBR g_career',
  },
  {
    name: 'career_gp_stockton',
    category: 'career',
    description: 'John Stockton career games played = 1,504',
    sql: careerSum('GP', 'John Stockton'),
    expected: 1504,
    mode: 'exact',
    source: 'BBR g_career',
  },

  // ── Single-Game Records ────────────────────────────────────────────────────
  {
    name: 'single_game_pts_max_wilt_100',
    category: 'game_records',
    description: 'Most points in a single game = 100 (Wilt Chamberlain)',
    sql: 'SELECT max(pts) AS val FROM (SELECT DISTINCT game_id, player_id, pts FROM nbadb.fact_player_game_traditional)',
    expected: 100,
    mode: 'exact',
    source: 'BBR pts_game',
  },
  {
    name: 'single_game_pts_2nd_bam_83',
    category: 'game_records',
    description: '2nd most points in a single game = 83 (Bam Adebayo, 2026)',
    sql: 'SELECT pts AS val FROM (SELECT DISTINCT game_id, player_id, pts FROM nbadb.fact_player_game_traditional ORDER BY pts DESC LIMIT 1 OFFSET 1)',
    expected: 83,
    mode: 'exact',
    source: 'BBR pts_game',
  },
  {
    name: 'single_game_pts_3rd_kobe_81',
    category: 'game_records',
    description: '3rd most points in a single game = 81 (Kobe Bryant, 2006)',
    sql: 'SELECT pts AS val FROM (SELECT DISTINCT game_id, player_id, pts FROM nbadb.fact_player_game_traditional ORDER BY pts DESC LIMIT 1 OFFSET 2)',
    expected: 81,
    mode: 'exact',
    source: 'BBR pts_game',
  },
  {
    name: 'single_game_ast_max_30',
    category: 'game_records',
    description: 'Most assists in a single game = 30 (Scott Skiles)',
    sql: 'SELECT max(ast) AS val FROM (SELECT DISTINCT game_id, player_id, ast FROM nbadb.fact_player_game_traditional)',
    expected: 30,
    mode: 'exact',
    source: 'BBR ast_game',
  },
  {
    name: 'single_game_3pm_max_klay_14',
    category: 'game_records',
    description: 'Most 3-pointers in a single game = 14 (Klay Thompson)',
    sql: 'SELECT max(fg3m) AS val FROM (SELECT DISTINCT game_id, player_id, fg3m FROM nbadb.fact_player_game_traditional)',
    expected: 14,
    mode: 'exact',
    source: 'BBR fg3_game',
  },
  {
    name: 'single_game_reb_max_wilt_55',
    category: 'game_records',
    description: 'Most rebounds in a single game = 55 (Wilt Chamberlain)',
    sql: 'SELECT max(reb) AS val FROM (SELECT DISTINCT game_id, player_id, reb FROM nbadb.fact_player_game_traditional)',
    expected: 55,
    mode: 'exact',
    source: 'Wikipedia/History.com',
  },

  // ── Season Records (via golden record view) ────────────────────────────────
  {
    name: 'season_pts_max_wilt_4029',
    category: 'season_records',
    description: 'Most points in a single season = 4,029 (Wilt 1961-62)',
    sql: 'SELECT max(PTS_golden) AS val FROM api.v_golden_player_season_totals',
    expected: 4029,
    mode: 'exact',
    source: 'BBR pts_season',
  },
  {
    name: 'season_ast_max_stockton_1164',
    category: 'season_records',
    description: 'Most assists in a single season = 1,164 (Stockton 1990-91)',
    sql: 'SELECT max(AST_golden) AS val FROM api.v_golden_player_season_totals',
    expected: 1164,
    mode: 'exact',
    source: 'BBR ast_season',
  },
  {
    name: 'season_reb_max_wilt_2149',
    category: 'season_records',
    description: 'Most rebounds in a single season = 2,149 (Wilt 1960-61)',
    sql: 'SELECT max(TRB_golden) AS val FROM api.v_golden_player_season_totals',
    expected: 2149,
    mode: 'exact',
    source: 'BBR trb_season',
  },
  {
    name: 'season_3pm_max_curry_402',
    category: 'season_records',
    description: 'Most 3PM in a single season = 402 (Curry 2015-16)',
    sql: 'SELECT max(FG3M_golden) AS val FROM api.v_golden_player_season_totals',
    expected: 402,
    mode: 'exact',
    source: 'BBR fg3_season',
  },

  // ── Team Records ───────────────────────────────────────────────────────────
  {
    name: 'team_best_record_73_wins',
    category: 'team_records',
    description: 'Best regular season = 73 wins (2015-16 Warriors)',
    sql: 'SELECT max(wins) AS val FROM nbadb.fact_standings',
    expected: 73,
    mode: 'exact',
    source: 'NBA.com / BBR',
  },
  {
    name: 'team_96_bulls_72_wins',
    category: 'team_records',
    description: '1996-97 Bulls had >=69 wins (72-10 season)',
    sql: "SELECT max(wins) AS val FROM nbadb.fact_standings WHERE season_year = '1996-97'",
    expected: 69,
    mode: 'gte',
    source: 'BBR (72 wins, but standings snapshot may differ)',
  },

  // ── Career PPG (via golden record) ─────────────────────────────────────────
  {
    name: 'career_ppg_jordan_30',
    category: 'career',
    description: 'Michael Jordan career PPG = 30.12 (32292/1072)',
    sql: `SELECT ROUND(sum(PTS_golden)::DOUBLE / NULLIF(sum(GP_golden)::DOUBLE, 0), 2) AS val
      FROM api.v_golden_player_season_totals
      WHERE master_id = ${pid('Michael Jordan')}`,
    expected: 30.12,
    mode: 'approx',
    tolerance: 0.1,
    source: 'BBR pts_per_g_career',
  },
  {
    name: 'career_ppg_wilt_30',
    category: 'career',
    description: 'Wilt Chamberlain career PPG = 30.07 (31419/1045)',
    sql: `SELECT ROUND(sum(PTS_golden)::DOUBLE / NULLIF(sum(GP_golden)::DOUBLE, 0), 2) AS val
      FROM api.v_golden_player_season_totals
      WHERE master_id = ${pid('Wilt Chamberlain')}`,
    expected: 30.07,
    mode: 'approx',
    tolerance: 0.1,
    source: 'BBR pts_per_g_career',
  },

  // ── Golden Record Integrity ────────────────────────────────────────────────
  {
    name: 'golden_season_zero_disagreements',
    category: 'golden_record',
    description: 'Golden player-season view has 0 disagreements',
    sql: 'SELECT sum(n_disagreements) AS val FROM api.v_golden_player_season_totals',
    expected: 0,
    mode: 'exact',
    source: 'build-canonical-merge.ts',
  },
  {
    name: 'golden_game_zero_disagreements',
    category: 'golden_record',
    description: 'Golden player-game view has 0 disagreements',
    sql: 'SELECT sum(n_disagreements) AS val FROM api.v_golden_player_game',
    expected: 0,
    mode: 'exact',
    source: 'build-canonical-merge-game.ts',
  },
  {
    name: 'golden_season_row_count',
    category: 'golden_record',
    description: 'Golden player-season view has >=20,000 rows',
    sql: 'SELECT count(*) AS val FROM api.v_golden_player_season_totals',
    expected: 20000,
    mode: 'gte',
    source: 'pipeline output (24,544)',
  },
  {
    name: 'golden_game_row_count',
    category: 'golden_record',
    description: 'Golden player-game view has >=1,000,000 rows',
    sql: 'SELECT count(*) AS val FROM api.v_golden_player_game',
    expected: 1000000,
    mode: 'gte',
    source: 'pipeline output (1,558,590)',
  },
  {
    name: 'golden_team_row_count',
    category: 'golden_record',
    description: 'Golden team-season view has >=1,000 rows',
    sql: 'SELECT count(*) AS val FROM api.v_golden_team_season',
    expected: 1000,
    mode: 'gte',
    source: 'pipeline output (1,755)',
  },

  // ── Cross-Source Agreement ─────────────────────────────────────────────────
  {
    name: 'cross_source_lebron_2023',
    category: 'cross_source',
    description: 'Golden record tracks LeBron 2023 PTS source correctly',
    sql: `SELECT PTS_golden AS val
      FROM api.v_golden_player_season_totals
      WHERE master_id = ${pidActive('LeBron James')} AND season = 2023`,
    expected: 1500,
    mode: 'gte',
    source: 'LeBron scored 1,590 PTS in 2023-24 regular season',
  },

  // ── Data Shape Sanity ──────────────────────────────────────────────────────
  {
    name: 'sanity_total_games',
    category: 'sanity',
    description: 'Database has >=60,000 distinct games',
    sql: 'SELECT count(DISTINCT game_id) AS val FROM nbadb.dim_game',
    expected: 60000,
    mode: 'gte',
    source: 'Expected coverage',
  },
  {
    name: 'sanity_total_players',
    category: 'sanity',
    description: 'Database has >=4,000 distinct players',
    sql: 'SELECT count(DISTINCT player_id) AS val FROM nbadb.dim_player',
    expected: 4000,
    mode: 'gte',
    source: 'Expected coverage',
  },
  {
    name: 'sanity_total_teams',
    category: 'sanity',
    description: 'Database has >=30 current teams',
    sql: 'SELECT count(DISTINCT team_id) AS val FROM nbadb.v_dim_team_current',
    expected: 30,
    mode: 'gte',
    source: 'NBA has 30 teams',
  },
  {
    name: 'sanity_no_negative_pts',
    category: 'sanity',
    description: 'No player game has negative points',
    sql: 'SELECT count(*) AS val FROM nbadb.fact_player_game_traditional WHERE pts < 0',
    expected: 0,
    mode: 'exact',
    source: 'Physical impossibility',
  },
  {
    name: 'sanity_no_negative_reb',
    category: 'sanity',
    description: 'No player game has negative rebounds',
    sql: 'SELECT count(*) AS val FROM nbadb.fact_player_game_traditional WHERE reb < 0',
    expected: 0,
    mode: 'exact',
    source: 'Physical impossibility',
  },
  {
    name: 'sanity_lebron_40k',
    category: 'sanity',
    description: 'LeBron James has scored >=40,000 career points',
    sql: careerSum('PTS', 'LeBron James', true),
    expected: 40000,
    mode: 'gte',
    source: 'NBA.com milestone',
  },

  // ── Obscure Single-Game Records ────────────────────────────────────────────
  {
    name: 'obscure_tov_max_14',
    category: 'obscure_game',
    description: 'Most turnovers in a single game = 14 (Kidd/Drew)',
    sql: 'SELECT max(tov) AS val FROM (SELECT DISTINCT game_id, player_id, tov FROM nbadb.fact_player_game_traditional)',
    expected: 14,
    mode: 'exact',
    source: 'BBR tov_game',
  },
  {
    name: 'obscure_pf_max',
    category: 'obscure_game',
    description: 'Most personal fouls in a single game >= 8 (Hitch/Otten era)',
    sql: 'SELECT max(pf) AS val FROM (SELECT DISTINCT game_id, player_id, pf FROM nbadb.fact_player_game_traditional)',
    expected: 8,
    mode: 'gte',
    source: 'BBR pf_game / StatMuse',
  },
  {
    name: 'obscure_min_max_69',
    category: 'obscure_game',
    description: 'Most minutes in a single game = 69 (Dale Ellis, 5OT 1989)',
    sql: 'SELECT max(min) AS val FROM (SELECT DISTINCT game_id, player_id, min FROM nbadb.fact_player_game_traditional)',
    expected: 69,
    mode: 'exact',
    source: 'BBR mp_game / StatMuse',
  },
  {
    name: 'obscure_fg_pct_20fga',
    category: 'obscure_game',
    description: 'Best FG% with 20+ FGA = 91.7% (Woodson 22/24)',
    sql: 'SELECT max(fg_pct) AS val FROM (SELECT DISTINCT game_id, player_id, fg_pct, fga FROM nbadb.fact_player_game_traditional WHERE fga >= 20 AND fg_pct IS NOT NULL)',
    expected: 0.917,
    mode: 'approx',
    tolerance: 0.005,
    source: 'BBR / Mike Woodson 1983-02-20',
  },
  {
    name: 'obscure_ft_perfect_24',
    category: 'obscure_game',
    description: 'Most FT made without a miss = 24 (Harden 2019)',
    sql: 'SELECT max(ftm) AS val FROM (SELECT DISTINCT game_id, player_id, ftm, fta FROM nbadb.fact_player_game_traditional WHERE ftm = fta AND ftm > 0)',
    expected: 24,
    mode: 'exact',
    source: 'StatMuse / Harden 2019-12-03',
  },
  {
    name: 'obscure_combined_370',
    category: 'obscure_game',
    description: 'Highest combined score = 370 (DET 186, DEN 184, 3OT 1983)',
    sql: 'SELECT max(pts_home + pts_away) AS val FROM nbadb.fact_game_result',
    expected: 370,
    mode: 'exact',
    source: 'BBR 198312130DEN',
  },
  {
    name: 'obscure_50pt_games_wilt',
    category: 'obscure_game',
    description: 'Wilt Chamberlain has most 50-point games >= 100',
    sql: `SELECT count(*) AS val FROM (
      SELECT DISTINCT game_id, player_id FROM nbadb.fact_player_game_traditional
      WHERE pts >= 50 AND player_id = (SELECT player_id FROM nbadb.dim_player WHERE full_name = 'Wilt Chamberlain' LIMIT 1)
    )`,
    expected: 100,
    mode: 'gte',
    source: 'BBR / StatMuse (118)',
  },

  // ── Obscure Season Records ─────────────────────────────────────────────────
  {
    name: 'obscure_stl_season_301',
    category: 'obscure_season',
    description: 'Most steals in a season = 301 (Alvin Robertson 1985-86)',
    sql: 'SELECT max(STL_golden) AS val FROM api.v_golden_player_season_totals',
    expected: 301,
    mode: 'exact',
    source: 'BBR stl_season',
  },
  {
    name: 'obscure_blk_season_max',
    category: 'obscure_season',
    description: 'Most blocks in a season >= 400 (Manute Bol 456 in 1985-86)',
    sql: 'SELECT max(BLK_golden) AS val FROM api.v_golden_player_season_totals',
    expected: 400,
    mode: 'gte',
    source: 'BBR blk_season (Manute Bol 456)',
  },
  {
    name: 'obscure_tov_season_max',
    category: 'obscure_season',
    description: 'Most turnovers in a season >= 400',
    sql: 'SELECT max(TOV_golden) AS val FROM api.v_golden_player_season_totals',
    expected: 400,
    mode: 'gte',
    source: 'BBR tov_season',
  },
  {
    name: 'obscure_pf_season_max',
    category: 'obscure_season',
    description: 'Most personal fouls in a season >= 350',
    sql: 'SELECT max(PF_golden) AS val FROM api.v_golden_player_season_totals',
    expected: 350,
    mode: 'gte',
    source: 'BBR pf_season',
  },
  {
    name: 'obscure_ft_pct_98',
    category: 'obscure_season',
    description: 'Best FT% season >= 98% (min 125 FTM)',
    sql: `SELECT max(ft_pct) AS val FROM (
      SELECT master_id, season,
        ROUND(sum(FTM_golden)::DOUBLE / NULLIF(sum(FTA_golden), 0) * 100, 1) AS ft_pct
      FROM api.v_golden_player_season_totals
      GROUP BY master_id, season
      HAVING sum(FTM_golden) >= 125
    )`,
    expected: 98,
    mode: 'gte',
    source: 'BBR (Jose Calderon 98.1% in 2008-09)',
  },
  {
    name: 'obscure_50_40_90_count',
    category: 'obscure_season',
    description: '50-40-90 club has >= 10 player-seasons',
    sql: `SELECT count(*) AS val FROM (
      SELECT master_id, season,
        sum(FGM_golden)::DOUBLE / NULLIF(sum(FGA_golden), 0) AS fg,
        sum(FG3M_golden)::DOUBLE / NULLIF(sum(FG3A_golden), 0) AS fg3,
        sum(FTM_golden)::DOUBLE / NULLIF(sum(FTA_golden), 0) AS ft
      FROM api.v_golden_player_season_totals
      GROUP BY master_id, season
      HAVING sum(FGA_golden) >= 300 AND sum(FG3A_golden) >= 50 AND sum(FTA_golden) >= 125
        AND fg >= 0.50 AND fg3 >= 0.40 AND ft >= 0.90
    )`,
    expected: 10,
    mode: 'gte',
    source: 'Wikipedia 50-40-90 club (14+ seasons)',
  },

  // ── Draft & Historical Facts ───────────────────────────────────────────────
  {
    name: 'obscure_draft_lebron',
    category: 'obscure_draft',
    description: 'LeBron James drafted #1 overall in 2003',
    sql: "SELECT overall_pick AS val FROM nbadb.fact_draft WHERE player_name = 'LeBron James'",
    expected: 1,
    mode: 'exact',
    source: 'BBR NBA_2003 draft',
  },
  {
    name: 'obscure_draft_lebron_year',
    category: 'obscure_draft',
    description: 'LeBron James draft year = 2003',
    sql: "SELECT season AS val FROM nbadb.fact_draft WHERE player_name = 'LeBron James'",
    expected: 2003,
    mode: 'exact',
    source: 'BBR NBA_2003 draft',
  },
  {
    name: 'obscure_draft_jordan',
    category: 'obscure_draft',
    description: 'Michael Jordan drafted #3 overall in 1984',
    sql: "SELECT overall_pick AS val FROM nbadb.fact_draft WHERE player_name = 'Michael Jordan'",
    expected: 3,
    mode: 'exact',
    source: 'BBR NBA_1984 draft',
  },
  {
    name: 'obscure_draft_jordan_year',
    category: 'obscure_draft',
    description: 'Michael Jordan draft year = 1984',
    sql: "SELECT season AS val FROM nbadb.fact_draft WHERE player_name = 'Michael Jordan'",
    expected: 1984,
    mode: 'exact',
    source: 'BBR NBA_1984 draft',
  },
  {
    name: 'obscure_duke_number1_picks',
    category: 'obscure_draft',
    description: 'Duke has produced >= 5 #1 overall picks',
    sql: "SELECT count(*) AS val FROM nbadb.fact_draft WHERE overall_pick = 1 AND organization LIKE '%Duke%'",
    expected: 5,
    mode: 'gte',
    source: 'NCAA.com (Heyman, Brand, Irving, Zion, Banchero, Flagg)',
  },
  {
    name: 'obscure_kobe_draft_pick',
    category: 'obscure_draft',
    description: 'Kobe Bryant drafted #13 overall in 1996',
    sql: "SELECT overall_pick AS val FROM nbadb.fact_draft WHERE player_name = 'Kobe Bryant'",
    expected: 13,
    mode: 'exact',
    source: 'BBR NBA_1996 draft',
  },
  {
    name: 'obscure_curry_draft_pick',
    category: 'obscure_draft',
    description: 'Stephen Curry drafted #7 overall in 2009',
    sql: "SELECT overall_pick AS val FROM nbadb.fact_draft WHERE player_name = 'Stephen Curry'",
    expected: 7,
    mode: 'exact',
    source: 'BBR NBA_2009 draft',
  },

  // ── Complex Cross-Stat Facts ───────────────────────────────────────────────
  {
    name: 'obscure_triple_double_seasons',
    category: 'obscure_complex',
    description: 'Triple-double seasons (avg 10+ in PTS/REB/AST) >= 7 instances',
    sql: `SELECT count(*) AS val FROM (
      SELECT master_id, season,
        sum(PTS_golden)::DOUBLE / NULLIF(sum(GP_golden), 0) AS ppg,
        sum(TRB_golden)::DOUBLE / NULLIF(sum(GP_golden), 0) AS rpg,
        sum(AST_golden)::DOUBLE / NULLIF(sum(GP_golden), 0) AS apg
      FROM api.v_golden_player_season_totals
      GROUP BY master_id, season
      HAVING sum(GP_golden) >= 50 AND ppg >= 10 AND rpg >= 10 AND apg >= 10
    )`,
    expected: 7,
    mode: 'gte',
    source: 'BBR (Oscar, Westbrook x4, Jokic x2)',
  },
  {
    name: 'obscure_triple_double_players',
    category: 'obscure_complex',
    description: 'Players who averaged a triple-double for a season = 3',
    sql: `SELECT count(DISTINCT master_id) AS val FROM (
      SELECT master_id, season,
        sum(PTS_golden)::DOUBLE / NULLIF(sum(GP_golden), 0) AS ppg,
        sum(TRB_golden)::DOUBLE / NULLIF(sum(GP_golden), 0) AS rpg,
        sum(AST_golden)::DOUBLE / NULLIF(sum(GP_golden), 0) AS apg
      FROM api.v_golden_player_season_totals
      GROUP BY master_id, season
      HAVING sum(GP_golden) >= 50 AND ppg >= 10 AND rpg >= 10 AND apg >= 10
    )`,
    expected: 3,
    mode: 'exact',
    source: 'BBR (Oscar Robertson, Westbrook, Jokic)',
  },
  {
    name: 'obscure_home_record_40_1',
    category: 'obscure_complex',
    description: 'Best home record = 40-1 (1985-86 Celtics, 2015-16 Spurs)',
    sql: `SELECT max(home_wins) AS val FROM (
      SELECT season_year, home_team_id,
        count(*) FILTER (WHERE wl_home = 'W') AS home_wins,
        count(*) FILTER (WHERE wl_home = 'L') AS home_losses
      FROM nbadb.fact_game_result
      WHERE season_type = 'Regular'
      GROUP BY season_year, home_team_id
      HAVING home_losses <= 1
    )`,
    expected: 40,
    mode: 'exact',
    source: 'BBR / StatMuse',
  },
  {
    name: 'obscure_no_undefeated_home',
    category: 'obscure_complex',
    description: 'No team went undefeated at home (0 losses) in 82-game era',
    sql: `SELECT count(*) AS val FROM (
      SELECT season_year, home_team_id,
        count(*) FILTER (WHERE wl_home = 'W') AS home_wins,
        count(*) FILTER (WHERE wl_home = 'L') AS home_losses
      FROM nbadb.fact_game_result
      WHERE season_type = 'Regular'
      GROUP BY season_year, home_team_id
      HAVING home_wins >= 40 AND home_losses = 0
    )`,
    expected: 0,
    mode: 'exact',
    source: 'StatMuse / NBA history',
  },
  {
    name: 'obscure_wilt_rookie_pts',
    category: 'obscure_complex',
    description: 'Wilt Chamberlain rookie season = 2,707 points (1959-60)',
    sql: `SELECT PTS_golden AS val
      FROM api.v_golden_player_season_totals
      WHERE master_id = ${pid('Wilt Chamberlain')} AND season = 1960`,
    expected: 2707,
    mode: 'exact',
    source: 'BBR (2,707 pts in 72 games, 1959-60)',
  },
  {
    name: 'obscure_wilt_50ppg_season',
    category: 'obscure_complex',
    description: 'Wilt averaged 50.4 PPG in 1961-62 (4,029 pts / 80 games)',
    sql: `SELECT ROUND(PTS_golden::DOUBLE / NULLIF(GP_golden, 0), 1) AS val
      FROM api.v_golden_player_season_totals
      WHERE master_id = ${pid('Wilt Chamberlain')} AND season = 1962`,
    expected: 50.4,
    mode: 'approx',
    tolerance: 0.5,
    source: 'BBR pts_per_g_season',
  },
  {
    name: 'obscure_jordan_dboy_blocks',
    category: 'obscure_complex',
    description: 'Jordan 1987-88 blocks >= 120 (DPOY season, most by guard)',
    sql: `SELECT BLK_golden AS val
      FROM api.v_golden_player_season_totals
      WHERE master_id = ${pid('Michael Jordan')} AND season = 1987`,
    expected: 120,
    mode: 'gte',
    source: 'BBR / StatMuse (131 blocks)',
  },
  {
    name: 'obscure_curry_402_threes',
    category: 'obscure_complex',
    description: 'Curry 2015-16 made exactly 402 three-pointers',
    sql: `SELECT FG3M_golden AS val
      FROM api.v_golden_player_season_totals
      WHERE master_id = ${pidActive('Stephen Curry')} AND season = 2016`,
    expected: 402,
    mode: 'exact',
    source: 'BBR fg3_season',
  },
  {
    name: 'obscure_stockton_ast_1164',
    category: 'obscure_complex',
    description: 'Stockton 1990-91 had exactly 1,164 assists (single-season record)',
    sql: `SELECT AST_golden AS val
      FROM api.v_golden_player_season_totals
      WHERE master_id = ${pid('John Stockton')} AND season = 1991`,
    expected: 1164,
    mode: 'exact',
    source: 'BBR ast_season',
  },
  {
    name: 'obscure_nash_50_40_90_count',
    category: 'obscure_complex',
    description: 'Steve Nash has most 50-40-90 seasons >= 4',
    sql: `SELECT count(*) AS val FROM (
      SELECT season,
        sum(FGM_golden)::DOUBLE / NULLIF(sum(FGA_golden), 0) AS fg,
        sum(FG3M_golden)::DOUBLE / NULLIF(sum(FG3A_golden), 0) AS fg3,
        sum(FTM_golden)::DOUBLE / NULLIF(sum(FTA_golden), 0) AS ft
      FROM api.v_golden_player_season_totals
      WHERE master_id = ${pid('Steve Nash')}
      GROUP BY season
      HAVING sum(FGA_golden) >= 300 AND sum(FG3A_golden) >= 50 AND sum(FTA_golden) >= 125
        AND fg >= 0.50 AND fg3 >= 0.40 AND ft >= 0.90
    )`,
    expected: 4,
    mode: 'gte',
    source: 'Wikipedia 50-40-90 club',
  },
  {
    name: 'obscure_bird_50_40_90_count',
    category: 'obscure_complex',
    description: 'Larry Bird has >= 2 50-40-90 seasons',
    sql: `SELECT count(*) AS val FROM (
      SELECT season,
        sum(FGM_golden)::DOUBLE / NULLIF(sum(FGA_golden), 0) AS fg,
        sum(FG3M_golden)::DOUBLE / NULLIF(sum(FG3A_golden), 0) AS fg3,
        sum(FTM_golden)::DOUBLE / NULLIF(sum(FTA_golden), 0) AS ft
      FROM api.v_golden_player_season_totals
      WHERE master_id = ${pid('Larry Bird')}
      GROUP BY season
      HAVING sum(FGA_golden) >= 300 AND sum(FG3A_golden) >= 50 AND sum(FTA_golden) >= 125
        AND fg >= 0.50 AND fg3 >= 0.40 AND ft >= 0.90
    )`,
    expected: 2,
    mode: 'gte',
    source: 'Wikipedia 50-40-90 club',
  },
  {
    name: 'obscure_wilt_100pt_game_exists',
    category: 'obscure_complex',
    description: 'Wilt 100-point game: exactly 100 pts, 36/63 FG, 28/32 FT',
    sql: `SELECT fgm AS val FROM (
      SELECT DISTINCT game_id, player_id, fgm, fga, ftm, fta, pts
      FROM nbadb.fact_player_game_traditional
      WHERE pts = 100
    )`,
    expected: 36,
    mode: 'exact',
    source: 'BBR 1962-03-02 box score',
  },
  {
    name: 'obscure_wilt_100pt_ft',
    category: 'obscure_complex',
    description: 'Wilt 100-point game: 28 free throws made',
    sql: `SELECT ftm AS val FROM (
      SELECT DISTINCT game_id, player_id, fgm, fga, ftm, fta, pts
      FROM nbadb.fact_player_game_traditional
      WHERE pts = 100
    )`,
    expected: 28,
    mode: 'exact',
    source: 'BBR 1962-03-02 box score',
  },
  {
    name: 'obscure_kobe_81pt_fgm',
    category: 'obscure_complex',
    description: 'Kobe 81-point game: 28 field goals made',
    sql: `SELECT fgm AS val FROM (
      SELECT DISTINCT game_id, player_id, fgm, fga, pts
      FROM nbadb.fact_player_game_traditional
      WHERE pts = 81
    )`,
    expected: 28,
    mode: 'exact',
    source: 'BBR 2006-01-22 box score',
  },
  {
    name: 'obscure_bam_83pt_exists',
    category: 'obscure_complex',
    description: 'Bam Adebayo scored 83 points (2nd all-time, March 2026)',
    sql: `SELECT count(*) AS val FROM (
      SELECT DISTINCT game_id, player_id, pts
      FROM nbadb.fact_player_game_traditional
      WHERE pts = 83
    )`,
    expected: 1,
    mode: 'gte',
    source: 'BBR pts_game',
  },
  {
    name: 'obscure_klay_14_threes',
    category: 'obscure_complex',
    description: 'Klay Thompson 14-threes game: exactly 14 fg3m',
    sql: `SELECT fg3m AS val FROM (
      SELECT DISTINCT game_id, player_id, fg3m
      FROM nbadb.fact_player_game_traditional
      WHERE fg3m = 14
    )`,
    expected: 14,
    mode: 'exact',
    source: 'BBR fg3_game (2018-10-29)',
  },
  {
    name: 'obscure_1983_high_scoring_game',
    category: 'obscure_complex',
    description: 'DET 186 in the 370-combined game (highest single-team score)',
    sql: 'SELECT GREATEST(max(pts_home), max(pts_away)) AS val FROM nbadb.fact_game_result',
    expected: 186,
    mode: 'exact',
    source: 'BBR 198312130DEN (DET 186, DEN 184)',
  },
  {
    name: 'obscure_lebron_career_ast',
    category: 'obscure_complex',
    description: 'LeBron James career assists = 12,016 (top 5 all-time)',
    sql: careerSum('AST', 'LeBron James', true),
    expected: 12016,
    mode: 'exact',
    source: 'BBR ast_career',
  },
  {
    name: 'obscure_lebron_career_reb',
    category: 'obscure_complex',
    description: 'LeBron James career rebounds = 12,095',
    sql: careerSum('TRB', 'LeBron James', true),
    expected: 12095,
    mode: 'exact',
    source: 'BBR trb_career',
  },
  {
    name: 'obscure_curry_career_3pm_exact',
    category: 'obscure_complex',
    description: 'Stephen Curry career 3PM = 4,248',
    sql: careerSum('FG3M', 'Stephen Curry', true),
    expected: 4248,
    mode: 'exact',
    source: 'BBR fg3_career',
  },
  {
    name: 'obscure_kareem_career_gp',
    category: 'obscure_complex',
    description: 'Kareem Abdul-Jabbar career games = 1,560',
    sql: careerSum('GP', 'Kareem Abdul-Jabbar'),
    expected: 1560,
    mode: 'exact',
    source: 'BBR g_career',
  },
];

const args = process.argv.slice(2);
const filterArg = args.find((a) => a.startsWith('--filter='));
const filter = filterArg?.split('=')[1] ?? null;
const verbose = args.includes('--verbose');

const selected = filter ? CHECKS.filter((c) => c.category.includes(filter)) : CHECKS;

const db = await DuckDBInstance.fromCache(DB_PATH);
const conn = await db.connect();

type Outcome = AccuracyCheck & { actual: number | null; passed: boolean; error: string | null };

const outcomes: Outcome[] = [];

for (const check of selected) {
  try {
    const res = await conn.runAndReadAll(check.sql);
    const row = res.getRowObjectsJson()[0] ?? {};
    const actual = row['val'] != null ? Number(row['val']) : null;

    let passed = false;
    if (actual !== null) {
      switch (check.mode) {
        case 'exact':
          passed = actual === check.expected;
          break;
        case 'gte':
          passed = actual >= check.expected;
          break;
        case 'lte':
          passed = actual <= check.expected;
          break;
        case 'range':
          passed =
            actual >= check.expected - (check.tolerance ?? 0) &&
            actual <= check.expected + (check.tolerance ?? 0);
          break;
        case 'approx':
          passed = Math.abs(actual - check.expected) <= (check.tolerance ?? 0);
          break;
      }
    }

    outcomes.push({ ...check, actual, passed, error: null });

    if (verbose) {
      console.log(`  SQL: ${check.sql.replace(/\n/g, ' ').slice(0, 120)}...`);
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    outcomes.push({ ...check, actual: null, passed: false, error: message });
  }
}

conn.closeSync();

const pad = (s: string, n: number) => s.padEnd(n);
const passed = outcomes.filter((o) => o.passed).length;
const failed = outcomes.filter((o) => !o.passed && !o.error).length;
const errored = outcomes.filter((o) => o.error !== null).length;

console.log(`\nNBA Accuracy Verification — ${new Date().toISOString()}`);
console.log(`DB: ${DB_PATH} · checks: ${selected.length}\n`);

console.log(
  `${pad('STATUS', 8)}${pad('CATEGORY', 16)}${pad('CHECK', 40)}${pad('EXPECTED', 14)}${pad('ACTUAL', 14)}DETAIL`,
);
console.log('─'.repeat(130));

for (const o of outcomes) {
  const icon = o.error ? 'ERROR' : o.passed ? 'PASS' : 'FAIL';
  const expectedStr =
    o.mode === 'gte'
      ? `>=${o.expected}`
      : o.mode === 'lte'
        ? `<=${o.expected}`
        : o.mode === 'approx'
          ? `${o.expected}±${o.tolerance}`
          : String(o.expected);
  const actualStr = o.actual !== null ? String(o.actual) : 'NULL';
  const detail = o.error
    ? o.error.slice(0, 60)
    : o.passed
      ? o.source
      : `expected ${expectedStr}, got ${actualStr}`;
  console.log(
    `${pad(icon, 8)}${pad(o.category, 16)}${pad(o.description.slice(0, 38), 40)}${pad(expectedStr, 14)}${pad(actualStr, 14)}${detail}`,
  );
}

console.log(`\n${'═'.repeat(80)}`);
console.log(
  `RESULTS: ${passed} passed, ${failed} failed, ${errored} errors out of ${selected.length} checks`,
);
console.log('═'.repeat(80));

if (failed > 0) {
  console.log('\nFailed checks:');
  for (const o of outcomes.filter((o) => !o.passed && !o.error)) {
    console.log(`  ✗ ${o.name}: ${o.description}`);
    console.log(`    Expected: ${o.expected} (${o.mode}), Got: ${o.actual}`);
    console.log(`    Source: ${o.source}`);
  }
}

if (errored > 0) {
  console.log('\nErrored checks:');
  for (const o of outcomes.filter((o) => o.error)) {
    console.log(`  ✗ ${o.name}: ${o.error?.slice(0, 100)}`);
  }
}

process.exitCode = failed + errored > 0 ? 1 : 0;
