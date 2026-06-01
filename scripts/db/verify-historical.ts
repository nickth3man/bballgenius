/**
 * verify-historical.ts — Phase 3 historical edge-case boundary scan.
 *
 * Single-table constraint checks for NBA rule timelines and player bio sanity.
 * Count-style (one row per check → audit.dq_results); shares dq-core's runner.
 *
 * Rule timelines (over nbadb.fact_player_game_traditional; season start year via
 * CAST(substr(season_year,1,4) AS INT)):
 *   - The 3-point line arrived in 1979-80, so no pre-1979 row may carry fg3a/fg3m.
 *   - Blocks/steals were first tracked in 1973-74. The warehouse stores 0 (not NULL)
 *     for untracked pre-1973 rows, so the corruption check is "blk>0 OR stl>0"
 *     (must be zero), and the 0-vs-NULL convention is reported separately as INFO.
 *
 * Bio sanity (over main.dim_player, which exposes height_inches/body_weight_lbs as
 * parsed SMALLINTs and birth_date as DATE):
 *   - draft_year uses -1/-22 sentinels for undrafted, so the age check is scoped to
 *     draft_year >= 1947 (first NBA draft); impossible ages (<16 or >40) are real
 *     bad birth_date/draft_year rows.
 *   - Height/weight bounds are inclusive of the real extremes (Bogues 5'3"=63",
 *     Bol 7'7"=91"; 130–375 lb); out-of-bounds is corruption, missing is a separate
 *     completeness signal.
 *
 *   bun run scripts/db/verify-historical.ts                 # all, persist, gate CRITICAL
 *   bun run scripts/db/verify-historical.ts --dry-run       # print only
 *   bun run scripts/db/verify-historical.ts --filter=bio    # subset by check-name substring
 */
import { DuckDBInstance } from '@duckdb/node-api';

import {
  applyGate,
  type CheckSpec,
  DB_PATH,
  newRunId,
  parseStandardArgs,
  persistResults,
  printReport,
  runCountChecks,
  violations,
} from './dq-core.js';

const PGT = 'nbadb.fact_player_game_traditional';
const DP = 'main.dim_player';
const SEASON_START = 'CAST(substr(season_year, 1, 4) AS INT)';

const CHECKS: CheckSpec[] = [
  // ── NBA rule timelines ──────────────────────────────────────────────────
  {
    name: 'hist_3pt_pre_1979',
    table: PGT,
    severity: 'HIGH',
    dimension: 'consistency',
    rule: 'no three-point attempts/makes before the 1979-80 season',
    countSql: violations(
      PGT,
      `${SEASON_START} < 1979 AND (fg3a > 0 OR fg3m > 0)`,
      'pre-1979 three-point stats',
    ),
  },
  {
    name: 'hist_blk_stl_pre_1973_positive',
    table: PGT,
    severity: 'HIGH',
    dimension: 'consistency',
    rule: 'no positive blocks/steals before the 1973-74 season (untracked era)',
    countSql: violations(
      PGT,
      `${SEASON_START} < 1973 AND (blk > 0 OR stl > 0)`,
      'pre-1973 positive blk/stl',
    ),
  },
  {
    name: 'hist_blk_stl_pre_1973_zero_not_null',
    table: PGT,
    severity: 'INFO',
    dimension: 'completeness',
    // Untracked-era blk/stl are stored as 0 rather than NULL — record the count so
    // downstream consumers know not to treat e.g. Bill Russell as a "0 blocks" player.
    rule: 'pre-1973 blk/stl are stored as 0 instead of NULL (informational)',
    countSql: violations(
      PGT,
      `${SEASON_START} < 1973 AND (blk IS NOT NULL OR stl IS NOT NULL)`,
      'pre-1973 rows with non-null (zero) blk/stl',
    ),
  },

  // ── Player bio sanity ───────────────────────────────────────────────────
  {
    name: 'bio_draft_age_impossible',
    table: DP,
    severity: 'MEDIUM',
    dimension: 'validity',
    rule: 'draft age (draft_year − birth year) is within 16–40 for drafted players',
    countSql: violations(
      DP,
      `draft_year >= 1947 AND birth_date IS NOT NULL
         AND (draft_year - year(birth_date) < 16 OR draft_year - year(birth_date) > 40)`,
      'impossible draft age',
    ),
  },
  {
    name: 'bio_height_out_of_bounds',
    table: DP,
    severity: 'MEDIUM',
    dimension: 'validity',
    rule: 'height within 5\'3"–7\'7" (63–91 inches) when populated',
    countSql: violations(
      DP,
      'height_inches IS NOT NULL AND (height_inches < 63 OR height_inches > 91)',
      'height out of bounds',
    ),
  },
  {
    name: 'bio_weight_out_of_bounds',
    table: DP,
    severity: 'MEDIUM',
    dimension: 'validity',
    rule: 'weight within 130–375 lbs when populated',
    countSql: violations(
      DP,
      'body_weight_lbs IS NOT NULL AND (body_weight_lbs < 130 OR body_weight_lbs > 375)',
      'weight out of bounds',
    ),
  },
  {
    name: 'bio_missing_height_weight',
    table: DP,
    severity: 'LOW',
    dimension: 'completeness',
    rule: 'players have both height and weight populated',
    countSql: violations(
      DP,
      'height_inches IS NULL OR body_weight_lbs IS NULL',
      'missing height/weight',
    ),
  },
  {
    name: 'bio_pathway_missing_recent',
    table: DP,
    severity: 'LOW',
    dimension: 'completeness',
    // Modern pathways (G League Ignite, Overtime Elite) are captured in `school`;
    // this flags recent draftees with no pre-NBA affiliation recorded at all.
    rule: 'draftees from 2018 onward have a non-empty school/pre-NBA affiliation',
    countSql: violations(
      DP,
      "draft_year >= 2018 AND (school IS NULL OR trim(school) = '')",
      'recent draftee missing school',
    ),
  },
];

// ── Runner ─────────────────────────────────────────────────────────────────
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
  title: 'Historical & bio boundary scan (Phase 3)',
  runId,
  dryRun,
  gate,
  checkCount: selected.length,
});
applyGate(outcomes, gate);

conn.closeSync();
