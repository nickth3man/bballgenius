/**
 * verify-cross-table.ts — Phase 1 cross-table reconciliation.
 *
 * Internal-consistency checks that span more than one table — the things
 * verify-dq.ts (single-table) cannot see:
 *   1. Box-score summation: player box scores must sum to the team box score.
 *   2. Aggregate continuity: regular-season game logs must sum to the season totals.
 *   3. Record & schedule: wins/losses derived from game results must match standings.
 *
 * Each check writes a one-row summary to audit.dq_results (via dq-core) AND the
 * offending keys to audit.cross_table_discrepancy so a failure can be drilled into.
 *
 *   bun run scripts/db/verify-cross-table.ts                 # run all, persist, gate on CRITICAL
 *   bun run scripts/db/verify-cross-table.ts --dry-run       # print only, do not write
 *   bun run scripts/db/verify-cross-table.ts --gate=HIGH     # also fail on HIGH violations
 *   bun run scripts/db/verify-cross-table.ts --filter=record # subset by check-name substring
 *
 * Notes on table choices (verified against the live warehouse before writing):
 *   - Team box scores: nbadb.fact_team_game (no minutes column; same source as PGT).
 *   - Season totals:   unified_star.fact_player_season_stats — its totals match the
 *     game-log sums exactly; nbadb.agg_player_season.total_* columns are corrupt
 *     (inflated vs avg_*×gp in ~45% of rows), so that defect gets its own check
 *     (agg_season_total_consistency) instead of being used as the truth side.
 *   - Records: nbadb.fact_game_result exposes only wl_home, so the visitor result is
 *     derived as the complement. nbadb.fact_standings is modern-era only (~892
 *     regular-season team-seasons); older team-seasons fall back to
 *     main.fact_bref_team_season_summary (matched on season-end year).
 */
import { DuckDBInstance } from '@duckdb/node-api';

import {
  applyGate,
  DB_PATH,
  type Dimension,
  newRunId,
  type Outcome,
  parseStandardArgs,
  persistResults,
  printReport,
  type Severity,
} from './dq-core.js';

const DETAIL_TABLE = 'audit.cross_table_discrepancy';

type CrossCheck = {
  name: string;
  table: string;
  severity: Severity;
  dimension: Dimension;
  rule: string;
  /**
   * SQL returning one row per offending key with exactly these columns:
   *   season_year VARCHAR, game_id VARCHAR, team_id BIGINT, player_id BIGINT,
   *   metric VARCHAR, expected DOUBLE, actual DOUBLE, delta DOUBLE
   */
  selectSql: string;
};

// ── Shared sub-queries ───────────────────────────────────────────────────────

/** Regular-season team W/L/games derived from game results (visitor = complement of wl_home). */
const RESULTS_RECORD = `
  SELECT season_year, team_id,
    count(*) FILTER (WHERE win)     AS w,
    count(*) FILTER (WHERE NOT win) AS l,
    count(*)                        AS gp
  FROM (
    SELECT season_year, home_team_id    AS team_id, wl_home = 'W' AS win
      FROM nbadb.fact_game_result WHERE season_type = 'Regular' AND wl_home IS NOT NULL
    UNION ALL
    SELECT season_year, visitor_team_id AS team_id, wl_home = 'L' AS win
      FROM nbadb.fact_game_result WHERE season_type = 'Regular' AND wl_home IS NOT NULL
  )
  GROUP BY season_year, team_id`;

// ── agg_player_season internal consistency (total_* vs avg_*×gp) ──────────────
const AGG_METRICS = ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'min'] as const;

function aggConsistencySql(): string {
  return AGG_METRICS.map(
    (m) => `
    SELECT season_year, NULL::VARCHAR AS game_id, team_id, player_id, '${m}' AS metric,
      (avg_${m} * gp)::DOUBLE AS expected, total_${m}::DOUBLE AS actual,
      (total_${m} - avg_${m} * gp)::DOUBLE AS delta
    FROM nbadb.agg_player_season
    WHERE gp > 0 AND total_${m} IS NOT NULL AND avg_${m} IS NOT NULL
      AND abs(total_${m} - avg_${m} * gp) > 1.0`,
  ).join('\n    UNION ALL');
}

// ── Check registry ────────────────────────────────────────────────────────────
const CHECKS: CrossCheck[] = [
  {
    name: 'box_score_summation',
    table: 'nbadb.fact_team_game',
    severity: 'HIGH',
    dimension: 'consistency',
    rule: 'sum of player box scores per (game,team) equals the team box score',
    selectSql: `
      WITH ps AS (
        SELECT game_id, team_id,
          sum(pts) pts, sum(reb) reb, sum(ast) ast, sum(fgm) fgm, sum(fga) fga,
          sum(fg3m) fg3m, sum(fg3a) fg3a, sum(ftm) ftm, sum(fta) fta
        FROM nbadb.fact_player_game_traditional
        GROUP BY game_id, team_id
      ),
      psu AS (
        UNPIVOT ps ON pts, reb, ast, fgm, fga, fg3m, fg3a, ftm, fta
        INTO NAME metric VALUE actual
      ),
      tgu AS (
        UNPIVOT (
          SELECT game_id, team_id, pts, reb, ast, fgm, fga, fg3m, fg3a, ftm, fta
          FROM nbadb.fact_team_game
        ) ON pts, reb, ast, fgm, fga, fg3m, fg3a, ftm, fta
        INTO NAME metric VALUE expected
      ),
      cmp AS (
        SELECT psu.game_id, psu.team_id, psu.metric,
          tgu.expected::DOUBLE AS expected, psu.actual::DOUBLE AS actual,
          (psu.actual - tgu.expected)::DOUBLE AS delta
        FROM psu JOIN tgu USING (game_id, team_id, metric)
        WHERE psu.actual IS DISTINCT FROM tgu.expected
      )
      SELECT dg.season_year, cmp.game_id, cmp.team_id, NULL::BIGINT AS player_id,
        cmp.metric, cmp.expected, cmp.actual, cmp.delta
      FROM cmp LEFT JOIN nbadb.dim_game dg USING (game_id)`,
  },
  {
    name: 'aggregate_continuity',
    table: 'unified_star.fact_player_season_stats',
    severity: 'MEDIUM',
    dimension: 'consistency',
    rule: 'regular-season game-log totals equal the season-totals row (per player-season)',
    selectSql: `
      WITH pg AS (
        SELECT p.player_id, p.season_year,
          sum(p.pts) pts, sum(p.reb) reb, sum(p.ast) ast, sum(p.stl) stl, sum(p.blk) blk
        FROM nbadb.fact_player_game_traditional p
        JOIN nbadb.fact_game_result g ON g.game_id = p.game_id AND g.season_type = 'Regular'
        GROUP BY p.player_id, p.season_year
      ),
      pgu AS (UNPIVOT pg ON pts, reb, ast, stl, blk INTO NAME metric VALUE actual),
      u AS (
        SELECT player_id, season_year, pts, reb, ast, stl, blk
        FROM unified_star.fact_player_season_stats WHERE is_playoffs = false
      ),
      uu AS (UNPIVOT u ON pts, reb, ast, stl, blk INTO NAME metric VALUE expected)
      SELECT pgu.season_year, NULL::VARCHAR AS game_id, NULL::BIGINT AS team_id,
        pgu.player_id, pgu.metric, uu.expected::DOUBLE AS expected,
        pgu.actual::DOUBLE AS actual, (pgu.actual - uu.expected)::DOUBLE AS delta
      FROM pgu JOIN uu USING (player_id, season_year, metric)
      WHERE pgu.actual IS DISTINCT FROM uu.expected`,
  },
  {
    name: 'agg_season_total_consistency',
    table: 'nbadb.agg_player_season',
    severity: 'HIGH',
    dimension: 'consistency',
    rule: 'agg_player_season total_<stat> equals avg_<stat> × gp (within 1)',
    selectSql: aggConsistencySql(),
  },
  {
    name: 'record_vs_standings',
    table: 'nbadb.fact_standings',
    severity: 'HIGH',
    dimension: 'consistency',
    rule: 'regular-season wins/losses from game results match fact_standings',
    selectSql: `
      WITH ra AS (${RESULTS_RECORD}),
      st AS (
        SELECT season_year, team_id, wins, losses
        FROM nbadb.fact_standings WHERE season_type = 'Regular'
      )
      SELECT season_year, NULL::VARCHAR AS game_id, team_id, NULL::BIGINT AS player_id,
        'wins' AS metric, st.wins::DOUBLE AS expected, ra.w::DOUBLE AS actual,
        (ra.w - st.wins)::DOUBLE AS delta
      FROM ra JOIN st USING (season_year, team_id) WHERE ra.w <> st.wins
      UNION ALL
      SELECT season_year, NULL, team_id, NULL,
        'losses', st.losses::DOUBLE, ra.l::DOUBLE, (ra.l - st.losses)::DOUBLE
      FROM ra JOIN st USING (season_year, team_id) WHERE ra.l <> st.losses`,
  },
  {
    name: 'record_schedule_games',
    table: 'nbadb.fact_standings',
    severity: 'MEDIUM',
    dimension: 'completeness',
    rule: 'game rows per team-season equal the standings games played (wins+losses)',
    selectSql: `
      WITH ra AS (${RESULTS_RECORD}),
      st AS (
        SELECT season_year, team_id, wins, losses
        FROM nbadb.fact_standings WHERE season_type = 'Regular'
      )
      SELECT season_year, NULL::VARCHAR AS game_id, team_id, NULL::BIGINT AS player_id,
        'games' AS metric, (st.wins + st.losses)::DOUBLE AS expected, ra.gp::DOUBLE AS actual,
        (ra.gp - (st.wins + st.losses))::DOUBLE AS delta
      FROM ra JOIN st USING (season_year, team_id)
      WHERE ra.gp <> st.wins + st.losses`,
  },
  {
    name: 'record_vs_bref',
    table: 'main.fact_bref_team_season_summary',
    severity: 'MEDIUM',
    dimension: 'consistency',
    rule: 'wins/losses for team-seasons absent from standings match the BBR season summary',
    selectSql: `
      WITH ra AS (${RESULTS_RECORD}),
      st AS (SELECT DISTINCT season_year, team_id FROM nbadb.fact_standings WHERE season_type = 'Regular'),
      bref AS (
        SELECT season_end_year AS end_year, team_id, max(w) AS w, max(l) AS l
        FROM main.fact_bref_team_season_summary
        WHERE is_playoffs = false AND lg = 'NBA' AND team_id IS NOT NULL
        GROUP BY season_end_year, team_id
      ),
      missing AS (
        SELECT ra.season_year, ra.team_id, ra.w, ra.l,
          CAST(substr(ra.season_year, 1, 4) AS INT) + 1 AS end_year
        FROM ra LEFT JOIN st USING (season_year, team_id)
        WHERE st.team_id IS NULL
      )
      SELECT m.season_year, NULL::VARCHAR AS game_id, m.team_id, NULL::BIGINT AS player_id,
        'wins' AS metric, b.w::DOUBLE AS expected, m.w::DOUBLE AS actual, (m.w - b.w)::DOUBLE AS delta
      FROM missing m JOIN bref b USING (end_year, team_id) WHERE m.w <> b.w
      UNION ALL
      SELECT m.season_year, NULL, m.team_id, NULL,
        'losses', b.l::DOUBLE, m.l::DOUBLE, (m.l - b.l)::DOUBLE
      FROM missing m JOIN bref b USING (end_year, team_id) WHERE m.l <> b.l`,
  },
];

// ── Runner ─────────────────────────────────────────────────────────────────
const { dryRun, gate, filter } = parseStandardArgs(process.argv);
const runId = newRunId();
const selected = filter ? CHECKS.filter((c) => c.name.includes(filter)) : CHECKS;

const db = await DuckDBInstance.fromCache(DB_PATH);
const conn = await db.connect();

await conn.run('CREATE SCHEMA IF NOT EXISTS audit');
await conn.run(`CREATE TABLE IF NOT EXISTS ${DETAIL_TABLE} (
  check_name  VARCHAR,
  season_year VARCHAR,
  game_id     VARCHAR,
  team_id     BIGINT,
  player_id   BIGINT,
  metric      VARCHAR,
  expected    DOUBLE,
  actual      DOUBLE,
  delta       DOUBLE,
  checked_at  TIMESTAMP
)`);

const outcomes: Outcome[] = [];
for (const check of selected) {
  try {
    const res = await conn.runAndReadAll(`SELECT count(*) AS n FROM (${check.selectSql}) t`);
    const count = Number(res.getRowObjectsJson()[0]?.['n'] ?? 0);
    const detail = count > 0 ? `${count} discrepant keys (see ${DETAIL_TABLE})` : null;
    if (!dryRun && count > 0) {
      await conn.run(
        `INSERT INTO ${DETAIL_TABLE}
           (check_name, season_year, game_id, team_id, player_id, metric, expected, actual, delta, checked_at)
         SELECT '${check.name}', season_year, game_id, team_id, player_id, metric, expected, actual, delta,
                TIMESTAMP '${runId}'
         FROM (${check.selectSql}) t`,
      );
    }
    outcomes.push({ ...check, countSql: '', count, detail, error: null });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    outcomes.push({ ...check, countSql: '', count: -1, detail: null, error: message });
  }
}

if (!dryRun) {
  await persistResults(conn, outcomes, runId); // writes dq_results summary + CHECKPOINT
}

printReport(outcomes, {
  title: 'Cross-table reconciliation (Phase 1)',
  runId,
  dryRun,
  gate,
  checkCount: selected.length,
});
applyGate(outcomes, gate);

conn.closeSync();
