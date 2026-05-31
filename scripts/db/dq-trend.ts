/**
 * dq-trend.ts — Data-quality violation trend analysis.
 *
 * Queries `audit.dq_results` for historical data and analyzes trends over time.
 * Shows current violations, 7-day and 30-day averages, trend direction, and
 * highlights regressions.
 *
 * Usage:
 *   bun run scripts/db/dq-trend.ts                    # last 30 days, table format
 *   bun run scripts/db/dq-trend.ts --days=60          # last 60 days
 *   bun run scripts/db/dq-trend.ts --format=csv       # CSV output
 *   bun run scripts/db/dq-trend.ts --format=json      # JSON output
 *
 * Exit code is non-zero when any CRITICAL check is degrading.
 */
import { DuckDBInstance } from '@duckdb/node-api';

const DB_PATH = process.env['NBA_DUCKDB_PATH'] ?? './data/nba.duckdb';

function parseArgs() {
  const args = process.argv.slice(2);
  const daysArg = args.find((a) => a.startsWith('--days='));
  const formatArg = args.find((a) => a.startsWith('--format='));
  const days = Number(daysArg?.split('=')[1] ?? '30');
  const format = formatArg?.split('=')[1] ?? 'table';
  if (!['table', 'csv', 'json'].includes(format)) {
    throw new Error('--format must be one of: table, csv, json');
  }
  if (days < 1 || days > 365) {
    throw new Error('--days must be between 1 and 365');
  }
  return { days, format };
}

const { days, format } = parseArgs();

const db = await DuckDBInstance.fromCache(DB_PATH);
const conn = await db.connect();

const trendQuery = `
  WITH latest AS (
    SELECT check_name, severity, row_count, checked_at,
           ROW_NUMBER() OVER (PARTITION BY check_name ORDER BY checked_at DESC) AS rn
    FROM audit.dq_results
    WHERE checked_at >= now() - INTERVAL '${days} days'
  ),
  current AS (
    SELECT check_name, severity, row_count AS current_violations, checked_at AS last_run
    FROM latest WHERE rn = 1
  ),
  avg_7d AS (
    SELECT check_name, AVG(row_count) AS avg_7d
    FROM audit.dq_results
    WHERE checked_at >= now() - INTERVAL '7 days'
    GROUP BY check_name
  ),
  avg_30d AS (
    SELECT check_name, AVG(row_count) AS avg_30d
    FROM audit.dq_results
    WHERE checked_at >= now() - INTERVAL '${days} days'
    GROUP BY check_name
  ),
  last_zero AS (
    SELECT check_name, MAX(checked_at) AS last_zero_run
    FROM audit.dq_results
    WHERE row_count = 0
    GROUP BY check_name
  )
  SELECT
    c.check_name,
    c.severity,
    c.current_violations,
    COALESCE(a7.avg_7d, 0) AS avg_7d,
    COALESCE(a30.avg_30d, 0) AS avg_30d,
    CASE
      WHEN c.current_violations < COALESCE(a7.avg_7d, 0) THEN '↓ improving'
      WHEN c.current_violations > COALESCE(a7.avg_7d, 0) THEN '↑ degrading'
      ELSE '→ stable'
    END AS trend,
    c.last_run,
    lz.last_zero_run,
    CASE
      WHEN lz.last_zero_run IS NULL THEN NULL
      ELSE EXTRACT(DAY FROM now() - lz.last_zero_run)
    END AS days_since_zero
  FROM current c
  LEFT JOIN avg_7d a7 ON a7.check_name = c.check_name
  LEFT JOIN avg_30d a30 ON a30.check_name = c.check_name
  LEFT JOIN last_zero lz ON lz.check_name = c.check_name
  ORDER BY
    CASE c.severity
      WHEN 'CRITICAL' THEN 1
      WHEN 'HIGH' THEN 2
      WHEN 'MEDIUM' THEN 3
      WHEN 'LOW' THEN 4
      ELSE 5
    END,
    c.check_name
`;

const regressionQuery = `
  WITH week_current AS (
    SELECT check_name, AVG(row_count) AS avg_current
    FROM audit.dq_results
    WHERE checked_at >= now() - INTERVAL '7 days'
    GROUP BY check_name
  ),
  week_previous AS (
    SELECT check_name, AVG(row_count) AS avg_previous
    FROM audit.dq_results
    WHERE checked_at >= now() - INTERVAL '14 days'
      AND checked_at < now() - INTERVAL '7 days'
    GROUP BY check_name
  ),
  was_passing AS (
    SELECT DISTINCT check_name
    FROM audit.dq_results
    WHERE checked_at >= now() - INTERVAL '14 days'
      AND checked_at < now() - INTERVAL '7 days'
      AND row_count = 0
  ),
  now_failing AS (
    SELECT DISTINCT check_name
    FROM audit.dq_results
    WHERE checked_at >= now() - INTERVAL '7 days'
      AND row_count > 0
  )
  SELECT
    wc.check_name,
    wc.avg_current,
    COALESCE(wp.avg_previous, 0) AS avg_previous,
    CASE
      WHEN wp.avg_previous IS NULL THEN 'new check'
      WHEN wc.avg_current > COALESCE(wp.avg_previous, 0) THEN 'week-over-week increase'
      ELSE 'stable'
    END AS regression_type
  FROM week_current wc
  LEFT JOIN week_previous wp ON wp.check_name = wc.check_name
  WHERE wc.avg_current > COALESCE(wp.avg_previous, 0)
     OR (wc.check_name IN (SELECT check_name FROM was_passing)
         AND wc.check_name IN (SELECT check_name FROM now_failing))
  ORDER BY wc.avg_current DESC
`;

type TrendRow = {
  check_name: string;
  severity: string;
  current_violations: number;
  avg_7d: number;
  avg_30d: number;
  trend: string;
  last_run: string;
  last_zero_run: string | null;
  days_since_zero: number | null;
};

type RegressionRow = {
  check_name: string;
  avg_current: number;
  avg_previous: number;
  regression_type: string;
};

const trendRes = await conn.runAndReadAll(trendQuery);
const trends = trendRes.getRowObjectsJson() as TrendRow[];

const regressionRes = await conn.runAndReadAll(regressionQuery);
const regressions = regressionRes.getRowObjectsJson() as RegressionRow[];

conn.closeSync();

if (format === 'json') {
  console.log(JSON.stringify({ trends, regressions }, null, 2));
} else if (format === 'csv') {
  console.log(
    'check_name,severity,current_violations,avg_7d,avg_30d,trend,last_run,days_since_zero',
  );
  for (const t of trends) {
    console.log(
      `${t.check_name},${t.severity},${t.current_violations},${t.avg_7d.toFixed(2)},${t.avg_30d.toFixed(2)},${t.trend},${t.last_run},${t.days_since_zero ?? ''}`,
    );
  }
} else {
  const pad = (s: string, n: number) => s.padEnd(n);
  const num = (n: number, w: number) => String(Math.round(n)).padStart(w);

  console.log(`\nDQ Trend Analysis — Last ${days} days\n`);
  console.log(
    `${pad('SEVERITY', 10)}${pad('CHECK', 40)}${pad('CURRENT', 9)}${pad('7D AVG', 9)}${pad('30D AVG', 9)}${pad('TREND', 14)}DAYS SINCE ZERO`,
  );
  console.log('─'.repeat(120));

  for (const t of trends) {
    const daysStr = t.days_since_zero !== null ? String(Math.round(t.days_since_zero)) : 'never';
    console.log(
      `${pad(t.severity, 10)}${pad(t.check_name, 40)}${num(t.current_violations, 9)}${num(t.avg_7d, 9)}${num(t.avg_30d, 9)}${pad(t.trend, 14)}${daysStr}`,
    );
  }

  if (regressions.length > 0) {
    console.log('\n⚠ Regressions detected:\n');
    for (const r of regressions) {
      console.log(
        `  - ${r.check_name}: ${r.regression_type} (current: ${Math.round(r.avg_current)}, previous: ${Math.round(r.avg_previous)})`,
      );
    }
  }
}

const criticalDegrading = trends.filter(
  (t) => t.severity === 'CRITICAL' && t.trend === '↑ degrading',
);

if (criticalDegrading.length > 0) {
  if (format === 'table') {
    console.log('\n✗ CRITICAL checks are degrading:');
    for (const c of criticalDegrading) {
      console.log(`  - ${c.check_name}: ${c.current_violations} violations (trend: ${c.trend})`);
    }
  }
  process.exitCode = 1;
}
