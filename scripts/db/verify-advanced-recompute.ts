/**
 * verify-advanced-recompute.ts — Phase 2 advanced-stat recomputation.
 *
 * Recomputes the advanced shooting/usage metrics directly from the raw box score
 * in main.fact_player_game_stats (1.67M rows) and compares them to the stored
 * columns. Per-row mismatches land in audit.advanced_stat_recompute; one summary
 * row per metric lands in audit.dq_results.
 *
 *   eFG% = (FGM + 0.5·FG3M) / FGA
 *   TS%  = PTS / (2·(FGA + 0.44·FTA))
 *   USG% = (FGA + 0.44·FTA + TOV)·(TmMP/5) / (MP·(TmFGA + 0.44·TmFTA + TmTOV))
 *
 * Team aggregates (TmMP/TmFGA/TmFTA/TmTOV) are derived by windowing the same
 * table over (game_id, team_id) — no cross-model join, so the ~109K-row coverage
 * gap to fact_player_game_traditional cannot leak in.
 *
 * Scale + tolerance (verified against the live warehouse): stored ts_pct/efg_pct/
 * usg_pct are 0–1 fractions, so the recompute is left unscaled. TS%/eFG% reproduce
 * the stored values *exactly* (≈300 genuine outliers each across 1.67M rows at
 * tol 0.005 → real defects, MEDIUM). USG% is an estimate whose stored (NBA.com)
 * value uses a different possession model than this BBR formula, so it diverges on
 * ~7% of rows regardless of tolerance → treated as LOW estimate-divergence, looser
 * default tolerance.
 *
 *   bun run scripts/db/verify-advanced-recompute.ts                 # all metrics, persist
 *   bun run scripts/db/verify-advanced-recompute.ts --dry-run       # print only
 *   bun run scripts/db/verify-advanced-recompute.ts --filter=ts     # one metric
 *   bun run scripts/db/verify-advanced-recompute.ts --tol=0.01      # override all tolerances
 *   bun run scripts/db/verify-advanced-recompute.ts --tol-usg=0.05  # override one metric
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

const SOURCE_TABLE = 'main.fact_player_game_stats';
const DETAIL_TABLE = 'audit.advanced_stat_recompute';

type MetricSpec = {
  key: 'efg' | 'ts' | 'usg';
  stored: string; // stored column in the recompute temp table
  computed: string; // computed column in the recompute temp table
  severity: Severity;
  dimension: Dimension;
  rule: string;
  defaultTol: number;
};

const METRICS: MetricSpec[] = [
  {
    key: 'efg',
    stored: 'efg_pct',
    computed: 'efg_calc',
    severity: 'MEDIUM',
    dimension: 'consistency',
    rule: 'stored efg_pct equals (FGM + 0.5·FG3M)/FGA',
    defaultTol: 0.005,
  },
  {
    key: 'ts',
    stored: 'ts_pct',
    computed: 'ts_calc',
    severity: 'MEDIUM',
    dimension: 'consistency',
    rule: 'stored ts_pct equals PTS/(2·(FGA + 0.44·FTA))',
    defaultTol: 0.005,
  },
  {
    key: 'usg',
    stored: 'usg_pct',
    computed: 'usg_calc',
    severity: 'LOW',
    dimension: 'consistency',
    rule: 'stored usg_pct ≈ possession-based recompute (estimate; divergence expected)',
    defaultTol: 0.03,
  },
];

// Recompute view: raw stats + windowed team aggregates + season_year, all metrics in one pass.
const RECOMPUTE_SQL = `
  WITH base AS (
    SELECT s.game_id, s.person_id, s.team_id, s.num_minutes AS mp,
      s.points, s.fga, s.fgm, s.fg3m, s.fta, s.turnovers,
      s.ts_pct, s.efg_pct, s.usg_pct,
      sum(s.num_minutes) OVER w AS tm_mp,
      sum(s.fga)         OVER w AS tm_fga,
      sum(s.fta)         OVER w AS tm_fta,
      sum(s.turnovers)   OVER w AS tm_tov
    FROM ${SOURCE_TABLE} s
    WINDOW w AS (PARTITION BY s.game_id, s.team_id)
  )
  SELECT b.game_id, b.person_id, b.team_id, dg.season_year,
    b.efg_pct, b.ts_pct, b.usg_pct,
    CASE WHEN b.fga > 0 THEN (b.fgm + 0.5 * b.fg3m)::DOUBLE / b.fga END AS efg_calc,
    CASE WHEN (b.fga + 0.44 * b.fta) > 0
      THEN b.points::DOUBLE / (2 * (b.fga + 0.44 * b.fta)) END AS ts_calc,
    -- USG% is mathematically unstable for garbage-time cameos (tiny MP in the
    -- denominator), so it is only recomputed for >= 5 minutes played.
    CASE WHEN b.mp >= 5 AND (b.tm_fga + 0.44 * b.tm_fta + b.tm_tov) > 0
      THEN ((b.fga + 0.44 * b.fta + b.turnovers) * (b.tm_mp / 5.0))
           / (b.mp * (b.tm_fga + 0.44 * b.tm_fta + b.tm_tov)) END AS usg_calc
  FROM base b
  LEFT JOIN nbadb.dim_game dg USING (game_id)`;

/** Resolve a metric's tolerance: --tol-<key> wins, then --tol (all), else its default. */
function resolveTolerance(argv: string[], metric: MetricSpec): number {
  const args = argv.slice(2);
  const get = (name: string): number | null => {
    const hit = args.find((a) => a.startsWith(`${name}=`));
    if (!hit) return null;
    const value = Number(hit.split('=')[1]);
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`${name} must be a non-negative number`);
    return value;
  };
  return get(`--tol-${metric.key}`) ?? get('--tol') ?? metric.defaultTol;
}

// ── Runner ─────────────────────────────────────────────────────────────────
const { dryRun, gate, filter } = parseStandardArgs(process.argv);
const runId = newRunId();
const selected = filter ? METRICS.filter((m) => m.key.includes(filter)) : METRICS;

const db = await DuckDBInstance.fromCache(DB_PATH);
const conn = await db.connect();

await conn.run('CREATE SCHEMA IF NOT EXISTS audit');
await conn.run(`CREATE TABLE IF NOT EXISTS ${DETAIL_TABLE} (
  game_id     VARCHAR,
  person_id   BIGINT,
  team_id     BIGINT,
  metric      VARCHAR,
  stored      DOUBLE,
  computed    DOUBLE,
  delta       DOUBLE,
  season_year VARCHAR,
  checked_at  TIMESTAMP
)`);

// Materialize the recompute once (one pass over 1.67M rows), then read it per metric.
await conn.run(`CREATE OR REPLACE TEMP TABLE _recompute AS ${RECOMPUTE_SQL}`);

const outcomes: Outcome[] = [];
for (const m of selected) {
  const tol = resolveTolerance(process.argv, m);
  const predicate = `${m.stored} IS NOT NULL AND ${m.computed} IS NOT NULL AND abs(${m.stored} - ${m.computed}) > ${tol}`;
  try {
    const res = await conn.runAndReadAll(`SELECT count(*) AS n FROM _recompute WHERE ${predicate}`);
    const count = Number(res.getRowObjectsJson()[0]?.['n'] ?? 0);
    const detail = count > 0 ? `${count} rows exceed tol ${tol} (see ${DETAIL_TABLE})` : null;
    if (!dryRun && count > 0) {
      await conn.run(
        `INSERT INTO ${DETAIL_TABLE}
           (game_id, person_id, team_id, metric, stored, computed, delta, season_year, checked_at)
         SELECT game_id, person_id, team_id, '${m.key}', ${m.stored}, ${m.computed},
                (${m.computed} - ${m.stored})::DOUBLE, season_year, TIMESTAMP '${runId}'
         FROM _recompute WHERE ${predicate}`,
      );
    }
    outcomes.push({
      name: `advanced_recompute_${m.key}`,
      table: SOURCE_TABLE,
      severity: m.severity,
      dimension: m.dimension,
      rule: m.rule,
      countSql: '',
      count,
      detail,
      error: null,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    outcomes.push({
      name: `advanced_recompute_${m.key}`,
      table: SOURCE_TABLE,
      severity: m.severity,
      dimension: m.dimension,
      rule: m.rule,
      countSql: '',
      count: -1,
      detail: null,
      error: message,
    });
  }
}

if (!dryRun) {
  await persistResults(conn, outcomes, runId);
}

printReport(outcomes, {
  title: 'Advanced-stat recompute (Phase 2)',
  runId,
  dryRun,
  gate,
  checkCount: selected.length,
});
applyGate(outcomes, gate);

conn.closeSync();
