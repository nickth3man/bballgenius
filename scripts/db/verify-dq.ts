/**
 * verify-dq.ts — Data-quality verification suite (Phase 2: internal consistency).
 *
 * Runs a declarative registry of checks against the curated `nbadb` star tier and
 * writes one row per check to `audit.dq_results`
 *   (check_name, table_name, severity, row_count, details, checked_at).
 *
 * Each check counts *violating* rows. row_count = 0 means the check passed.
 * Results are appended (history is retained for trend tracking); a single run
 * shares one `checked_at` timestamp so "latest run" is queryable.
 *
 * Severity ladder: CRITICAL > HIGH > MEDIUM > LOW > INFO.
 *   CRITICAL = physically impossible / breaks the grain (must be zero).
 *   HIGH     = strong correctness signal, almost always a genuine defect.
 *   MEDIUM   = likely defect or completeness gap; triage + justify residual.
 *   LOW/INFO = cosmetic / informational.
 *
 * Usage:
 *   bun run scripts/db/verify-dq.ts                 # run all, write results, gate on CRITICAL
 *   bun run scripts/db/verify-dq.ts --dry-run       # print only, do not write
 *   bun run scripts/db/verify-dq.ts --gate=HIGH     # also fail the process on HIGH violations
 *   bun run scripts/db/verify-dq.ts --filter=orphan # run only checks whose name contains "orphan"
 *
 * Exit code is non-zero when any check at or above the gate severity has violations,
 * so this doubles as a CI gate.
 *
 * NOTE: accuracy vs. reality (cross-source reconciliation) lives separately in the
 * audit.metric_discrepancy / player_identity_bridge pipeline — see build-canonical-merge.ts.
 * This file covers internal consistency, validity, completeness, uniqueness and
 * referential integrity, which are fully provable from the DB alone.
 */
import { DuckDBInstance } from '@duckdb/node-api';

import {
  applyGate,
  type CheckSpec,
  DB_PATH,
  duplicateGrain,
  newRunId,
  orphans,
  parseStandardArgs,
  persistResults,
  printReport,
  requiredColumns,
  runCountChecks,
  violations,
} from './dq-core.js';

// ── Table short-hands ────────────────────────────────────────────────────────
const PGT = 'nbadb.fact_player_game_traditional';
const TG = 'nbadb.fact_team_game';
const GR = 'nbadb.fact_game_result';
const DG = 'nbadb.dim_game';
const DP = 'nbadb.dim_player';
const DT = 'nbadb.dim_team';
const CURRENT_TEAM_SQL = `(
  SELECT * EXCLUDE (rn)
  FROM (
    SELECT t.*,
           row_number() OVER (
             PARTITION BY team_id
             ORDER BY
               CASE
                 WHEN state = 'Special Event' THEN 0
                 WHEN abbreviation IN ('ATL','BKN','CHA','DET','GSW','HOU','LAC','LAL','MEM','NOP','OKC','SAC','UTA','WAS') THEN 0
                 ELSE 1
               END,
               year_founded DESC NULLS LAST,
               abbreviation DESC
           ) AS rn
    FROM ${DT} t
  )
  WHERE rn = 1
)`;
const DTC_LABEL = 'nbadb.v_dim_team_current';

const SEASON_TYPES = "('Cup','Preseason','Playoffs','Regular')";

// ── Check registry ───────────────────────────────────────────────────────────
const CHECKS: CheckSpec[] = [
  // ── Uniqueness / grain ──────────────────────────────────────────────────
  {
    name: 'pgt_dup_grain',
    table: PGT,
    severity: 'CRITICAL',
    dimension: 'uniqueness',
    rule: 'exactly one row per (game_id, player_id)',
    countSql: duplicateGrain(PGT, ['game_id', 'player_id']),
  },
  {
    name: 'team_game_dup_grain',
    table: TG,
    severity: 'CRITICAL',
    dimension: 'uniqueness',
    rule: 'exactly one row per (game_id, team_id)',
    countSql: duplicateGrain(TG, ['game_id', 'team_id']),
  },
  {
    name: 'game_result_dup_grain',
    table: GR,
    severity: 'CRITICAL',
    dimension: 'uniqueness',
    rule: 'exactly one row per game_id',
    countSql: duplicateGrain(GR, ['game_id']),
  },
  {
    name: 'dim_game_dup_pk',
    table: DG,
    severity: 'CRITICAL',
    dimension: 'uniqueness',
    rule: 'game_id is unique in dim_game',
    countSql: duplicateGrain(DG, ['game_id']),
  },
  {
    name: 'dim_player_dup_master',
    table: DP,
    severity: 'CRITICAL',
    dimension: 'uniqueness',
    rule: 'at most one current (is_current) row per player_id',
    countSql: `SELECT count(*) AS n,
      CASE WHEN count(*) > 0 THEN 'players with >1 current master row: ' || count(*) END AS details
      FROM (SELECT player_id FROM ${DP} WHERE is_current GROUP BY player_id HAVING count(*) > 1)`,
  },
  {
    name: 'dim_team_current_dup_pk',
    table: DTC_LABEL,
    severity: 'CRITICAL',
    dimension: 'uniqueness',
    rule: 'current-team/franchise view has one row per team_id',
    countSql: duplicateGrain(CURRENT_TEAM_SQL, ['team_id']),
  },

  // ── Referential integrity ──────────────────────────────────────────────
  {
    name: 'pgt_orphan_game',
    table: PGT,
    severity: 'CRITICAL',
    dimension: 'referential',
    rule: 'every player-game game_id exists in dim_game',
    countSql: orphans(PGT, 'game_id', DG, 'game_id'),
  },
  {
    name: 'pgt_orphan_player',
    table: PGT,
    severity: 'HIGH',
    dimension: 'referential',
    rule: 'every player-game player_id exists in dim_player',
    countSql: orphans(PGT, 'player_id', DP, 'player_id', true),
  },
  {
    name: 'pgt_orphan_team',
    table: PGT,
    severity: 'HIGH',
    dimension: 'referential',
    rule: 'every player-game team_id exists in dim_team',
    countSql: orphans(PGT, 'team_id', DT, 'team_id', true),
  },
  {
    name: 'team_game_orphan_game',
    table: TG,
    severity: 'CRITICAL',
    dimension: 'referential',
    rule: 'every team-game game_id exists in dim_game',
    countSql: orphans(TG, 'game_id', DG, 'game_id'),
  },
  {
    name: 'team_game_orphan_team',
    table: TG,
    severity: 'HIGH',
    dimension: 'referential',
    rule: 'every team-game team_id exists in dim_team',
    countSql: orphans(TG, 'team_id', DT, 'team_id', true),
  },
  {
    name: 'game_result_orphan_game',
    table: GR,
    severity: 'HIGH',
    dimension: 'referential',
    rule: 'every game result game_id exists in dim_game',
    countSql: orphans(GR, 'game_id', DG, 'game_id'),
  },
  {
    name: 'game_result_orphan_home_team',
    table: GR,
    severity: 'HIGH',
    dimension: 'referential',
    rule: 'home_team_id exists in dim_team',
    countSql: orphans(GR, 'home_team_id', DT, 'team_id', true),
  },
  {
    name: 'game_result_orphan_visitor_team',
    table: GR,
    severity: 'HIGH',
    dimension: 'referential',
    rule: 'visitor_team_id exists in dim_team',
    countSql: orphans(GR, 'visitor_team_id', DT, 'team_id', true),
  },
  {
    name: 'dim_game_orphan_home_team',
    table: DG,
    severity: 'HIGH',
    dimension: 'referential',
    rule: 'dim_game home_team_id exists in dim_team',
    countSql: orphans(DG, 'home_team_id', DT, 'team_id', true),
  },
  {
    name: 'dim_game_orphan_visitor_team',
    table: DG,
    severity: 'HIGH',
    dimension: 'referential',
    rule: 'dim_game visitor_team_id exists in dim_team',
    countSql: orphans(DG, 'visitor_team_id', DT, 'team_id', true),
  },
  {
    name: 'dim_player_orphan_team',
    table: DP,
    severity: 'MEDIUM',
    dimension: 'referential',
    rule: 'dim_player current team_id exists in dim_team when populated',
    countSql: orphans(DP, 'team_id', DT, 'team_id', true),
  },

  // ── Unified star referential integrity ──────────────────────────────────
  {
    name: 'unified_fact_player_season_orphan_player',
    table: 'unified_star.fact_player_season_stats',
    severity: 'HIGH',
    dimension: 'referential',
    rule: 'every player_id exists in unified_star.dim_player',
    countSql: orphans(
      'unified_star.fact_player_season_stats',
      'player_id',
      'unified_star.dim_player',
      'player_id',
      true,
    ),
  },
  {
    name: 'unified_fact_player_season_orphan_team',
    table: 'unified_star.fact_player_season_stats',
    severity: 'HIGH',
    dimension: 'referential',
    rule: 'every team_id exists in unified_star.dim_team',
    countSql: orphans(
      'unified_star.fact_player_season_stats',
      'team_id',
      'unified_star.dim_team',
      'team_id',
      true,
    ),
  },
  // ── Consistency (physically impossible = CRITICAL) ──────────────────────
  {
    name: 'pgt_fg_consistency',
    table: PGT,
    severity: 'CRITICAL',
    dimension: 'consistency',
    rule: 'made shots never exceed attempts (fgm<=fga, fg3m<=fg3a, ftm<=fta)',
    countSql: violations(PGT, 'fgm > fga OR fg3m > fg3a OR ftm > fta', 'made > attempted'),
  },
  {
    name: 'pgt_3p_subset',
    table: PGT,
    severity: 'CRITICAL',
    dimension: 'consistency',
    rule: 'three-pointers are a subset of field goals (fg3m<=fgm, fg3a<=fga)',
    countSql: violations(PGT, 'fg3m > fgm OR fg3a > fga', '3PT exceeds total FG'),
  },
  {
    name: 'pgt_negative_stats',
    table: PGT,
    severity: 'CRITICAL',
    dimension: 'consistency',
    rule: 'counting stats are non-negative',
    countSql: violations(
      PGT,
      'pts < 0 OR reb < 0 OR ast < 0 OR stl < 0 OR blk < 0 OR tov < 0 OR pf < 0 OR fgm < 0 OR fga < 0 OR ftm < 0 OR fta < 0 OR oreb < 0 OR dreb < 0',
      'negative counting stat',
    ),
  },
  {
    name: 'pgt_pct_range',
    table: PGT,
    severity: 'CRITICAL',
    dimension: 'validity',
    rule: 'shooting percentages are within [0,1]',
    countSql: violations(
      PGT,
      'fg_pct < 0 OR fg_pct > 1 OR fg3_pct < 0 OR fg3_pct > 1 OR ft_pct < 0 OR ft_pct > 1',
      'percentage outside [0,1]',
    ),
  },
  {
    name: 'pgt_min_impossible',
    table: PGT,
    severity: 'CRITICAL',
    dimension: 'validity',
    // Physical max = longest game ever played: 6 OT = 48 + 6*5 = 78 min
    // (Jan 6 1951, IND-ROC). Anything above 78 is impossible.
    rule: 'a single player cannot exceed the longest game ever played (78 min, 6 OT)',
    countSql: violations(PGT, 'min < 0 OR min > 78', 'minutes outside 0-78 (6-OT physical max)'),
  },
  {
    name: 'pgt_min_range',
    table: PGT,
    severity: 'MEDIUM',
    dimension: 'validity',
    // Soft tripwire above the 5-OT envelope (73 min). The single-game record is
    // 69 (Dale Ellis, Nov 9 1989, 5 OT), so 0-73 must NOT flag; >73 needs 6 OT.
    rule: 'minutes within the realistic multi-OT envelope (0-73); >73 warrants review',
    countSql: violations(PGT, 'min < 0 OR min > 73', 'minutes beyond 5-OT envelope (>73)'),
  },
  {
    name: 'pgt_reb_consistency',
    table: PGT,
    severity: 'HIGH',
    dimension: 'consistency',
    rule: 'oreb + dreb = reb when all three are present',
    countSql: violations(
      PGT,
      'oreb IS NOT NULL AND dreb IS NOT NULL AND reb IS NOT NULL AND oreb + dreb <> reb',
      'oreb+dreb <> reb',
    ),
  },
  {
    name: 'pgt_pct_recompute',
    table: PGT,
    severity: 'MEDIUM',
    dimension: 'consistency',
    rule: 'stored fg_pct matches fgm/fga within 0.011',
    countSql: violations(
      PGT,
      'fga > 0 AND fg_pct IS NOT NULL AND abs(fg_pct - (fgm * 1.0 / fga)) > 0.011',
      'fg_pct disagrees with fgm/fga',
    ),
  },
  {
    name: 'pgt_pts_formula',
    table: PGT,
    severity: 'MEDIUM',
    dimension: 'consistency',
    // The points identity is definitional and must hold EXACTLY in the modern era.
    // All known violations are pre-1965 digitized-box-score reconstruction artifacts
    // (inconsistent source values we cannot authoritatively correct), so the check is
    // scoped to season_year >= '1983-84'; a modern violation is a genuine defect.
    rule: 'points match 2FG + 3FG + FT (modern era >= 1983-84; pre-1965 rows excluded as known source artifacts)',
    countSql: violations(
      PGT,
      "season_year >= '1983-84' AND pts IS NOT NULL AND fgm IS NOT NULL AND fg3m IS NOT NULL AND ftm IS NOT NULL AND pts <> ((fgm - fg3m) * 2 + fg3m * 3 + ftm)",
      'pts formula mismatch (modern era)',
    ),
  },
  {
    name: 'team_game_fg_consistency',
    table: TG,
    severity: 'CRITICAL',
    dimension: 'consistency',
    rule: 'team made shots never exceed attempts',
    countSql: violations(
      TG,
      'fgm > fga OR fg3m > fg3a OR ftm > fta OR fg3m > fgm OR fg3a > fga',
      'team made > attempted',
    ),
  },
  {
    name: 'team_game_negative_stats',
    table: TG,
    severity: 'CRITICAL',
    dimension: 'consistency',
    rule: 'team counting stats are non-negative',
    countSql: violations(
      TG,
      'pts < 0 OR reb < 0 OR ast < 0 OR stl < 0 OR blk < 0 OR tov < 0 OR pf < 0 OR fgm < 0 OR fga < 0 OR fg3m < 0 OR fg3a < 0 OR ftm < 0 OR fta < 0 OR oreb < 0 OR dreb < 0 OR pts_qtr1 < 0 OR pts_qtr2 < 0 OR pts_qtr3 < 0 OR pts_qtr4 < 0',
      'negative team counting stat',
    ),
  },
  {
    name: 'team_game_pct_range',
    table: TG,
    severity: 'CRITICAL',
    dimension: 'validity',
    rule: 'team shooting percentages are within [0,1]',
    countSql: violations(
      TG,
      'fg_pct < 0 OR fg_pct > 1 OR fg3_pct < 0 OR fg3_pct > 1 OR ft_pct < 0 OR ft_pct > 1',
      'team percentage outside [0,1]',
    ),
  },
  {
    name: 'team_game_reb_consistency',
    table: TG,
    severity: 'HIGH',
    dimension: 'consistency',
    rule: 'team oreb + dreb = reb when all three are present',
    countSql: violations(
      TG,
      'oreb IS NOT NULL AND dreb IS NOT NULL AND reb IS NOT NULL AND oreb + dreb <> reb',
      'team oreb+dreb <> reb',
    ),
  },
  {
    name: 'team_game_pts_formula',
    table: TG,
    severity: 'HIGH',
    dimension: 'consistency',
    rule: 'team points match 2FG + 3FG + FT when all scoring components are populated',
    countSql: violations(
      TG,
      'pts IS NOT NULL AND fgm IS NOT NULL AND fg3m IS NOT NULL AND ftm IS NOT NULL AND pts <> ((fgm - fg3m) * 2 + fg3m * 3 + ftm)',
      'team pts formula mismatch',
    ),
  },
  {
    name: 'team_game_quarter_exceeds_total',
    table: TG,
    severity: 'CRITICAL',
    dimension: 'consistency',
    // team_game has only qtr1-4 (no OT cols), so we assert quarters cannot EXCEED
    // the total (equality would false-positive on every OT game).
    rule: 'sum of quarter points never exceeds final team points',
    countSql: violations(
      TG,
      'pts_qtr1 + pts_qtr2 + pts_qtr3 + pts_qtr4 > pts',
      'quarter sum exceeds final pts',
    ),
  },
  {
    name: 'game_result_components_exceed_total',
    table: GR,
    severity: 'CRITICAL',
    dimension: 'consistency',
    // fact_game_result carries only ot1/ot2; games with 3+ OT would fail an
    // equality check, so we assert known components cannot EXCEED the final.
    rule: 'sum of quarter+OT points never exceeds final score (either side)',
    countSql: violations(
      GR,
      `coalesce(pts_qtr1_home,0)+coalesce(pts_qtr2_home,0)+coalesce(pts_qtr3_home,0)+coalesce(pts_qtr4_home,0)+coalesce(pts_ot1_home,0)+coalesce(pts_ot2_home,0) > pts_home
       OR coalesce(pts_qtr1_away,0)+coalesce(pts_qtr2_away,0)+coalesce(pts_qtr3_away,0)+coalesce(pts_qtr4_away,0)+coalesce(pts_ot1_away,0)+coalesce(pts_ot2_away,0) > pts_away`,
      'period components exceed final score',
    ),
  },
  {
    name: 'game_result_negative_scores',
    table: GR,
    severity: 'CRITICAL',
    dimension: 'consistency',
    rule: 'game scores and period components are non-negative',
    countSql: violations(
      GR,
      `pts_home < 0 OR pts_away < 0
       OR pts_qtr1_home < 0 OR pts_qtr2_home < 0 OR pts_qtr3_home < 0 OR pts_qtr4_home < 0 OR pts_ot1_home < 0 OR pts_ot2_home < 0
       OR pts_qtr1_away < 0 OR pts_qtr2_away < 0 OR pts_qtr3_away < 0 OR pts_qtr4_away < 0 OR pts_ot1_away < 0 OR pts_ot2_away < 0`,
      'negative game score component',
    ),
  },
  {
    name: 'game_result_margin_consistency',
    table: GR,
    severity: 'HIGH',
    dimension: 'consistency',
    rule: 'home/away plus-minus values sum to zero when both are present',
    countSql: violations(
      GR,
      'plus_minus_home IS NOT NULL AND plus_minus_away IS NOT NULL AND abs(plus_minus_home + plus_minus_away) > 0.001',
      'plus_minus_home + plus_minus_away != 0',
    ),
  },

  // ── Validity ────────────────────────────────────────────────────────────
  {
    name: 'game_result_season_type',
    table: GR,
    severity: 'MEDIUM',
    dimension: 'validity',
    rule: `season_type in accepted set ${SEASON_TYPES}`,
    countSql: violations(
      GR,
      `season_type IS NOT NULL AND season_type NOT IN ${SEASON_TYPES}`,
      'unexpected season_type',
    ),
  },
  {
    name: 'dim_game_season_year_format',
    table: DG,
    severity: 'LOW',
    dimension: 'validity',
    rule: "season_year matches 'YYYY-YY'",
    countSql: violations(
      DG,
      "season_year IS NOT NULL AND NOT regexp_matches(season_year, '^\\d{4}-\\d{2}$')",
      'malformed season_year',
    ),
  },
  {
    name: 'pgt_season_year_format',
    table: PGT,
    severity: 'LOW',
    dimension: 'validity',
    rule: "season_year matches 'YYYY-YY'",
    countSql: violations(
      PGT,
      "season_year IS NOT NULL AND NOT regexp_matches(season_year, '^\\d{4}-\\d{2}$')",
      'malformed season_year',
    ),
  },
  {
    name: 'team_game_season_year_format',
    table: TG,
    severity: 'LOW',
    dimension: 'validity',
    rule: "season_year matches 'YYYY-YY'",
    countSql: violations(
      TG,
      "season_year IS NOT NULL AND NOT regexp_matches(season_year, '^\\d{4}-\\d{2}$')",
      'malformed season_year',
    ),
  },
  {
    name: 'game_result_season_year_format',
    table: GR,
    severity: 'LOW',
    dimension: 'validity',
    rule: "season_year matches 'YYYY-YY'",
    countSql: violations(
      GR,
      "season_year IS NOT NULL AND NOT regexp_matches(season_year, '^\\d{4}-\\d{2}$')",
      'malformed season_year',
    ),
  },
  {
    name: 'game_result_date_validity',
    table: GR,
    severity: 'MEDIUM',
    dimension: 'validity',
    rule: 'game_date parses to a date within [1946-01-01, today+1]',
    countSql: violations(
      GR,
      "game_date IS NOT NULL AND (try_cast(game_date AS DATE) IS NULL OR try_cast(game_date AS DATE) < DATE '1946-01-01' OR try_cast(game_date AS DATE) > current_date + 1)",
      'game_date out of range / unparseable',
    ),
  },

  // ── Temporal integrity ──────────────────────────────────────────────────
  {
    name: 'dim_player_career_year_consistency',
    table: 'unified_star.dim_player',
    severity: 'HIGH',
    dimension: 'validity',
    rule: 'from_year <= to_year when both are populated',
    countSql: `SELECT count(*) AS n,
      CASE WHEN count(*) > 0 THEN 'from_year > to_year: ' || count(*) END AS details
      FROM unified_star.dim_player
      WHERE from_year IS NOT NULL AND to_year IS NOT NULL AND from_year > to_year`,
  },

  // ── Completeness ─────────────────────────────────────────────────────────
  {
    name: 'dim_game_required_keys',
    table: DG,
    severity: 'CRITICAL',
    dimension: 'completeness',
    rule: 'dim_game grain/date/season keys are populated',
    countSql: requiredColumns(DG, ['game_id', 'game_date', 'season_year'], 'missing dim_game key'),
  },
  {
    name: 'dim_player_required_keys',
    table: DP,
    severity: 'CRITICAL',
    dimension: 'completeness',
    rule: 'dim_player identity/SCD keys are populated',
    countSql: requiredColumns(
      DP,
      ['player_sk', 'player_id', 'full_name', 'valid_from', 'is_current'],
      'missing dim_player key',
    ),
  },
  {
    name: 'dim_team_required_keys',
    table: DT,
    severity: 'CRITICAL',
    dimension: 'completeness',
    rule: 'dim_team identity fields are populated',
    countSql: requiredColumns(DT, ['team_id', 'abbreviation', 'full_name'], 'missing dim_team key'),
  },
  {
    name: 'pgt_required_keys',
    table: PGT,
    severity: 'CRITICAL',
    dimension: 'completeness',
    rule: 'player-game grain keys are populated',
    countSql: requiredColumns(
      PGT,
      ['game_id', 'player_id', 'team_id', 'season_year'],
      'missing player-game key',
    ),
  },
  {
    name: 'team_game_required_keys',
    table: TG,
    severity: 'CRITICAL',
    dimension: 'completeness',
    rule: 'team-game grain keys are populated',
    countSql: requiredColumns(TG, ['game_id', 'team_id', 'season_year'], 'missing team-game key'),
  },
  {
    name: 'game_result_required_keys',
    table: GR,
    severity: 'CRITICAL',
    dimension: 'completeness',
    rule: 'game result grain/date/season keys are populated',
    countSql: requiredColumns(
      GR,
      ['game_id', 'game_date', 'season_year'],
      'missing game-result key',
    ),
  },
  {
    name: 'game_result_null_score',
    table: GR,
    severity: 'HIGH',
    dimension: 'completeness',
    rule: 'every game result has both final scores',
    countSql: violations(GR, 'pts_home IS NULL OR pts_away IS NULL', 'missing final score'),
  },
  {
    name: 'dim_player_null_name',
    table: DP,
    severity: 'HIGH',
    dimension: 'completeness',
    rule: 'every player has a non-empty full_name',
    countSql: violations(DP, "full_name IS NULL OR trim(full_name) = ''", 'missing player name'),
  },
  {
    name: 'dim_team_null_abbr',
    table: DT,
    severity: 'MEDIUM',
    dimension: 'completeness',
    rule: 'every team has a non-empty abbreviation',
    countSql: violations(
      DT,
      "abbreviation IS NULL OR trim(abbreviation) = ''",
      'missing team abbreviation',
    ),
  },
  {
    // Cross-source coverage: BBR NBA-league regular-season player-seasons that did
    // not bridge to an NBA person_id are not value-checked by the accuracy engine.
    // ABA rows are legitimately NBA-API-absent, but these are all lg='NBA' (incl.
    // 363 modern 1997+ rows), so they are a fixable identity-resolution backlog,
    // surfaced here so the gap is tracked rather than invisible.
    name: 'bref_nba_unbridged_player_seasons',
    table: 'main.fact_bref_player_season_totals',
    severity: 'MEDIUM',
    dimension: 'completeness',
    rule: 'BBR NBA regular-season player-seasons should bridge to an NBA person_id',
    countSql: violations(
      'main.fact_bref_player_season_totals',
      "is_playoffs = false AND lg = 'NBA' AND person_id IS NULL",
      'unbridged BBR NBA player-seasons',
    ),
  },
  {
    name: 'unified_dim_player_bref_coverage',
    table: 'unified_star.dim_player',
    severity: 'LOW',
    dimension: 'completeness',
    rule: 'count of dim_player rows with bref_player_id populated vs total',
    countSql: `SELECT count(*) FILTER (WHERE bref_player_id IS NULL) AS n,
      CASE WHEN count(*) > 0
        THEN 'bref_player_id coverage: ' || count(*) FILTER (WHERE bref_player_id IS NOT NULL)
          || '/' || count(*)
      END AS details
      FROM unified_star.dim_player`,
  },
];

// ── Runner ───────────────────────────────────────────────────────────────────
const { dryRun, gate, filter } = parseStandardArgs(process.argv);
const runId = newRunId();
const selected = filter ? CHECKS.filter((c) => c.name.includes(filter)) : CHECKS;

const db = await DuckDBInstance.fromCache(DB_PATH);
const conn = await db.connect();

const outcomes = await runCountChecks(conn, selected);
if (!dryRun) {
  await persistResults(conn, outcomes, runId);
}

printReport(outcomes, {
  title: 'Data-quality verification',
  runId,
  dryRun,
  gate,
  checkCount: selected.length,
});
applyGate(outcomes, gate);

conn.closeSync();
