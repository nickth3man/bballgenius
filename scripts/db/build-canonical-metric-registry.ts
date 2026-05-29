/**
 * Phase 4 of the cross-source reconciliation plan
 * (.claude/plans/i-would-like-to-serialized-lake.md).
 *
 * Promotes the flat column→concept crosswalk into a governed metric registry:
 *   - meta.canonical_metric         one row per canonical stat (family, per_mode,
 *                                   definition, is_numeric)
 *   - meta.metric_source_authority  per (metric × source): precedence + numeric
 *                                   tolerance, so the golden-record merge knows
 *                                   which source wins and when a delta is a real
 *                                   disagreement vs. rounding.
 *   - meta.canonical_metric_proposal  auto-classification of currently-unmapped
 *                                   stat columns (name matches a known concept),
 *                                   for review — NOT auto-merged into the CSV
 *                                   system-of-record.
 *
 *   bun run scripts/db/build-canonical-metric-registry.ts          # dry run
 *   bun run scripts/db/build-canonical-metric-registry.ts --apply
 */
import { DuckDBInstance } from '@duckdb/node-api';

const dryRun = !process.argv.includes('--apply');
const db = await DuckDBInstance.fromCache('./data/nba.duckdb');
const conn = await db.connect();
const q = async (sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJson();

// Families whose authoritative source is the NBA tracking pipeline rather than BBR.
const NBA_FIRST = ['tracking', 'hustle', 'synergy', 'video', 'coordinate', 'odds'];
// Non-numeric families: precedence still applies, tolerance is meaningless.
const NON_NUMERIC = ['identity', 'dimension', 'temporal', 'text', 'flag', 'organization'];

console.log(`${dryRun ? '[DRY RUN] ' : ''}Building canonical metric registry...\n`);

// ---- meta.canonical_metric --------------------------------------------------
const canonicalMetricSQL = `
CREATE OR REPLACE TABLE meta.canonical_metric AS
WITH fam AS (
  SELECT canonical_stat, family,
         any_value(per_mode) AS per_mode, any_value(definition) AS definition,
         count(*) AS n
  FROM meta.stat_crosswalk
  WHERE canonical_stat IS NOT NULL AND canonical_stat <> ''
  GROUP BY canonical_stat, family
),
ranked AS (
  SELECT canonical_stat, family, per_mode, definition,
         row_number() OVER (PARTITION BY canonical_stat ORDER BY n DESC, family) AS rn
  FROM fam
)
SELECT
  canonical_stat,
  family,
  per_mode AS representative_per_mode,
  definition,
  NOT list_contains(${sqlList(NON_NUMERIC)}, family) AS is_numeric
FROM ranked WHERE rn = 1;`;

// ---- meta.metric_source_authority ------------------------------------------
// Precedence: BBR first for historical/box families, NBA first for tracking
// families. Tolerance: 0.5 for numeric metrics (absorbs rounding/per-mode
// rounding), NULL for non-numeric.
const authoritySQL = `
CREATE OR REPLACE TABLE meta.metric_source_authority AS
WITH metric AS (SELECT canonical_stat, family, is_numeric FROM meta.canonical_metric),
src AS (SELECT source_id, trust_tier FROM meta.source),
base AS (
  SELECT m.canonical_stat, m.family, m.is_numeric, s.source_id, s.trust_tier,
         list_contains(${sqlList(NBA_FIRST)}, m.family) AS nba_first,
         CASE WHEN s.source_id = 'bref' THEN 0 ELSE 1 END AS is_bref
  FROM metric m CROSS JOIN src s
)
SELECT
  canonical_stat,
  source_id,
  -- ordering key: when nba_first, bref sinks to the bottom; else bref floats up
  row_number() OVER (
    PARTITION BY canonical_stat
    ORDER BY CASE WHEN nba_first THEN (1 - is_bref) ELSE is_bref END, trust_tier, source_id
  ) AS precedence,
  CASE WHEN is_numeric THEN 0.5 ELSE NULL END AS tolerance
FROM base;`;

// ---- meta.canonical_metric_proposal (auto-classify unmapped stat columns) ---
const proposalSQL = `
CREATE OR REPLACE TABLE meta.canonical_metric_proposal AS
WITH canon AS (
  SELECT DISTINCT canonical_stat, family,
         lower(canonical_stat) AS key
  FROM meta.canonical_metric
)
SELECT
  u.schema_name, u.table_name, u.column_name, u.data_type,
  c.canonical_stat AS proposed_canonical_stat,
  c.family AS proposed_family,
  'exact_name_match' AS method,
  0.9 AS confidence
FROM meta.v_unmapped_columns u
JOIN canon c ON lower(u.column_name) = c.key
-- exclude reconciliation infrastructure columns (not stats)
WHERE u.schema_name NOT IN ('xref', 'audit')
ORDER BY u.schema_name, u.table_name, u.column_name;`;

if (dryRun) {
  const nMetrics = (
    await q(`
    SELECT count(DISTINCT canonical_stat) AS n FROM meta.stat_crosswalk
    WHERE canonical_stat IS NOT NULL AND canonical_stat <> ''
  `)
  )[0].n;
  const nProposals = (
    await q(`
    WITH canon AS (SELECT DISTINCT lower(canonical_stat) k FROM meta.stat_crosswalk
                   WHERE canonical_stat IS NOT NULL AND canonical_stat <> '')
    SELECT count(*) AS n FROM meta.v_unmapped_columns u JOIN canon ON lower(u.column_name)=canon.k
    WHERE u.schema_name NOT IN ('xref','audit')
  `)
  )[0].n;
  console.log(`Would build meta.canonical_metric (~${nMetrics} metrics)`);
  console.log(
    'Would build meta.metric_source_authority (metrics × 3 sources, precedence+tolerance)',
  );
  console.log(
    `Would build meta.canonical_metric_proposal (~${nProposals} auto-classified columns)`,
  );
  console.log('\nDry run complete. Use --apply to execute.');
  process.exit(0);
}

await conn.run(canonicalMetricSQL);
const nm = (await q('SELECT count(*) AS n FROM meta.canonical_metric'))[0].n;
console.log(`✓ meta.canonical_metric: ${nm} metrics`);

await conn.run(authoritySQL);
const na = (await q('SELECT count(*) AS n FROM meta.metric_source_authority'))[0].n;
console.log(`✓ meta.metric_source_authority: ${na} (metric × source) precedence rows`);

await conn.run(proposalSQL);
const np = (await q('SELECT count(*) AS n FROM meta.canonical_metric_proposal'))[0].n;
console.log(`✓ meta.canonical_metric_proposal: ${np} auto-classified columns (for review)`);

// ---- coverage report --------------------------------------------------------
console.log('\n=== VALIDATION ===');
const sample = (await q(`
  SELECT canonical_stat,
         list(source_id ORDER BY precedence) AS precedence_order,
         max(tolerance) AS tolerance
  FROM meta.metric_source_authority
  WHERE canonical_stat IN ('PTS','FG3M','PTS_PER_GAME','DEF_RATING','PACE')
  GROUP BY canonical_stat ORDER BY canonical_stat
`)) as Array<Record<string, unknown>>;
console.log('Sample precedence (lower = wins first):');
for (const row of sample) {
  console.log(
    `  ${row.canonical_stat}: ${JSON.stringify(row.precedence_order)} tol=${row.tolerance}`,
  );
}
const proposalsBySchema = (await q(`
  SELECT schema_name, count(*) AS n FROM meta.canonical_metric_proposal GROUP BY 1 ORDER BY 2 DESC
`)) as Array<Record<string, unknown>>;
console.log('\nAuto-classification proposals by schema (review before merging to CSV):');
for (const row of proposalsBySchema) console.log(`  ${row.schema_name}: ${row.n}`);
await conn.run('CHECKPOINT'); // flush WAL → avoid cross-process replay bug
console.log('\nMetric registry build complete.');

function sqlList(xs: string[]): string {
  return `[${xs.map((x) => `'${x}'`).join(', ')}]`;
}
