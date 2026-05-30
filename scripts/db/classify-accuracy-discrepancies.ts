/**
 * Classify cross-source accuracy discrepancies.
 *
 * Consumes audit.metric_discrepancy rows produced by build-canonical-merge.ts
 * and writes a governed 3-way classification surface:
 *   - agree: represented in audit.accuracy_run_summary when no discrepancy row exists
 *   - known_divergence: a documented source-rule variance
 *   - genuine_defect_candidate: unresolved HIGH-priority discrepancy queue
 *
 * The current player-season merge has zero discrepancies, but this script makes
 * Phase 3 explicit and repeatable when future metrics/sources add rows.
 *
 * Usage:
 *   bun run scripts/db/classify-accuracy-discrepancies.ts
 */
import { DuckDBInstance } from '@duckdb/node-api';

const DB_PATH = process.env['NBA_DUCKDB_PATH'] ?? './data/nba.duckdb';
const runId = new Date().toISOString().replace('T', ' ').replace('Z', '');

const db = await DuckDBInstance.fromCache(DB_PATH);
const conn = await db.connect();

async function q(sql: string): Promise<Array<Record<string, unknown>>> {
  return (await conn.runAndReadAll(sql)).getRowObjectsJson() as Array<Record<string, unknown>>;
}

await conn.run('CREATE SCHEMA IF NOT EXISTS audit');

await conn.run(`
  CREATE TABLE IF NOT EXISTS audit.discrepancy_known_divergence (
    entity VARCHAR,
    grain VARCHAR,
    canonical_stat VARCHAR,
    rule_name VARCHAR,
    reason VARCHAR,
    season_min INTEGER,
    season_max INTEGER,
    created_at TIMESTAMP
  );
  -- Migrate any pre-existing table to the season-scoped schema (NULL = all seasons).
  ALTER TABLE audit.discrepancy_known_divergence ADD COLUMN IF NOT EXISTS season_min INTEGER;
  ALTER TABLE audit.discrepancy_known_divergence ADD COLUMN IF NOT EXISTS season_max INTEGER;

  CREATE TABLE IF NOT EXISTS audit.metric_discrepancy_classification (
    run_id TIMESTAMP,
    entity VARCHAR,
    grain VARCHAR,
    master_id VARCHAR,
    season INTEGER,
    canonical_stat VARCHAR,
    classification VARCHAR,
    severity VARCHAR,
    reason VARCHAR,
    classified_at TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit.accuracy_run_summary (
    run_id TIMESTAMP,
    entity VARCHAR,
    grain VARCHAR,
    overlap_cells BIGINT,
    agree_cells BIGINT,
    known_divergence_cells BIGINT,
    genuine_defect_candidate_cells BIGINT,
    classified_at TIMESTAMP
  );
`);

// Documented, season-scoped known divergences (real NBA data-history facts).
// Offensive/defensive rebounds were not officially tracked before 1973-74, so any
// BBR<->NBA ORB/DRB disagreement for those seasons is a known source artifact.
await conn.run(`
  DELETE FROM audit.discrepancy_known_divergence
    WHERE rule_name IN ('pre_1974_orb_untracked', 'pre_1974_drb_untracked');
  INSERT INTO audit.discrepancy_known_divergence
    (entity, grain, canonical_stat, rule_name, reason, season_min, season_max, created_at)
  VALUES
    ('player','season_totals','ORB','pre_1974_orb_untracked',
     'Offensive rebounds were not officially tracked before 1973-74; source reconstructions diverge.',
     NULL, 1973, now()),
    ('player','season_totals','DRB','pre_1974_drb_untracked',
     'Defensive rebounds were not officially tracked before 1973-74; source reconstructions diverge.',
     NULL, 1973, now());
`);

await conn.run(`
  DELETE FROM audit.metric_discrepancy_classification WHERE run_id = TIMESTAMP '${runId}';
  DELETE FROM audit.accuracy_run_summary WHERE run_id = TIMESTAMP '${runId}';

  INSERT INTO audit.metric_discrepancy_classification
  SELECT
    TIMESTAMP '${runId}' AS run_id,
    d.entity,
    d.grain,
    d.master_id,
    d.season,
    d.canonical_stat,
    CASE WHEN k.rule_name IS NOT NULL THEN 'known_divergence' ELSE 'genuine_defect_candidate' END
      AS classification,
    CASE WHEN k.rule_name IS NOT NULL THEN 'LOW' ELSE 'HIGH' END AS severity,
    coalesce(k.reason, 'Cross-source disagreement beyond tolerance; requires oracle resolution')
      AS reason,
    now() AS classified_at
  FROM audit.metric_discrepancy d
  LEFT JOIN audit.discrepancy_known_divergence k
    ON k.entity = d.entity
   AND k.grain = d.grain
   AND k.canonical_stat = d.canonical_stat
   AND (k.season_min IS NULL OR d.season >= k.season_min)
   AND (k.season_max IS NULL OR d.season <= k.season_max)
  WHERE d.beyond_tolerance;

  INSERT INTO audit.accuracy_run_summary
  WITH golden AS (
    SELECT count(*) * 17 AS overlap_cells,
           coalesce(sum(n_disagreements), 0) AS discrepancy_cells
    FROM api.v_golden_player_season_totals
  ),
  classified AS (
    SELECT
      count(*) FILTER (WHERE classification = 'known_divergence') AS known_divergence_cells,
      count(*) FILTER (WHERE classification = 'genuine_defect_candidate') AS genuine_defect_candidate_cells
    FROM audit.metric_discrepancy_classification
    WHERE run_id = TIMESTAMP '${runId}'
  )
  SELECT
    TIMESTAMP '${runId}',
    'player',
    'season_totals',
    golden.overlap_cells,
    golden.overlap_cells - golden.discrepancy_cells,
    coalesce(classified.known_divergence_cells, 0),
    coalesce(classified.genuine_defect_candidate_cells, 0),
    now()
  FROM golden CROSS JOIN classified;

  CHECKPOINT;
`);

const [summary] = await q(`
  SELECT * FROM audit.accuracy_run_summary WHERE run_id = TIMESTAMP '${runId}'
`);
const classified = await q(`
  SELECT classification, severity, count(*) AS n
  FROM audit.metric_discrepancy_classification
  WHERE run_id = TIMESTAMP '${runId}'
  GROUP BY classification, severity
  ORDER BY severity, classification
`);

console.log(`Accuracy discrepancy classification — run ${runId}`);
console.log(`DB: ${DB_PATH}\n`);
console.log(
  `player/season_totals: overlap=${summary['overlap_cells']} agree=${summary['agree_cells']} ` +
    `known_divergence=${summary['known_divergence_cells']} ` +
    `genuine_defect_candidate=${summary['genuine_defect_candidate_cells']}`,
);

if (classified.length > 0) {
  console.log('\nClassified discrepancy rows:');
  for (const row of classified) {
    console.log(`  ${row['severity']} ${row['classification']}: ${row['n']}`);
  }
} else {
  console.log('\nClassified discrepancy rows: none');
}

if (Number(summary['genuine_defect_candidate_cells']) > 0) {
  process.exitCode = 1;
}

conn.closeSync();
