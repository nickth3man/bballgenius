/**
 * Firecrawl oracle harness for unresolved accuracy discrepancies.
 *
 * Phase 4 is intentionally queue-driven: only HIGH
 * `genuine_defect_candidate` rows from audit.metric_discrepancy_classification
 * are sent to external pages. Current Phase 3 runs have zero candidates, so this
 * script records an empty oracle run and exits cleanly.
 *
 * When candidates exist, it resolves NBA master ids to BBR player slugs through
 * xref.player_xref, scrapes the player page with the Firecrawl CLI, and records
 * the scrape artifact path for manual/source-rule adjudication.
 *
 * Usage:
 *   bun run scripts/db/oracle-resolve-discrepancies.ts --limit=20
 */
import { mkdirSync } from 'node:fs';

import { DuckDBInstance } from '@duckdb/node-api';

const DB_PATH = process.env['NBA_DUCKDB_PATH'] ?? './data/nba.duckdb';
const OUTPUT_DIR = '.firecrawl/oracle';
const DEFAULT_LIMIT = 20;

type Candidate = {
  master_id: string;
  season: number;
  canonical_stat: string;
  source_natural_key: string | null;
};

const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = Number(limitArg?.split('=')[1] ?? DEFAULT_LIMIT);
const runId = new Date().toISOString().replace('T', ' ').replace('Z', '');

const db = await DuckDBInstance.fromCache(DB_PATH);
const conn = await db.connect();

async function q<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
  return (await conn.runAndReadAll(sql)).getRowObjectsJson() as T[];
}

function bbrPlayerUrl(slug: string): string {
  return `https://www.basketball-reference.com/players/${slug.slice(0, 1)}/${slug}.html`;
}

function artifactPath(candidate: Candidate): string {
  return `${OUTPUT_DIR}/${candidate.source_natural_key}-${candidate.season}-${candidate.canonical_stat}.md`;
}

async function scrape(url: string, outputPath: string): Promise<number> {
  const proc = Bun.spawn(['firecrawl', 'scrape', url, '-o', outputPath], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
  return exitCode;
}

await conn.run(`
  CREATE TABLE IF NOT EXISTS audit.oracle_resolution_run (
    run_id TIMESTAMP,
    queued_candidates BIGINT,
    scraped_candidates BIGINT,
    failed_candidates BIGINT,
    created_at TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit.oracle_resolution (
    run_id TIMESTAMP,
    master_id VARCHAR,
    season INTEGER,
    canonical_stat VARCHAR,
    oracle_source VARCHAR,
    oracle_url VARCHAR,
    artifact_path VARCHAR,
    resolution_status VARCHAR,
    note VARCHAR,
    resolved_at TIMESTAMP
  );
`);

const candidates = await q<Candidate>(`
  SELECT c.master_id, c.season, c.canonical_stat, x.source_natural_key
  FROM audit.metric_discrepancy_classification c
  LEFT JOIN xref.player_xref x
    ON x.master_id = c.master_id
   AND x.source_id = 'bref'
  WHERE c.classification = 'genuine_defect_candidate'
    AND c.severity = 'HIGH'
  ORDER BY c.classified_at DESC, c.master_id, c.season, c.canonical_stat
  LIMIT ${limit}
`);

mkdirSync(OUTPUT_DIR, { recursive: true });

let scraped = 0;
let failed = 0;
for (const candidate of candidates) {
  if (!candidate.source_natural_key) {
    failed++;
    await conn.run(`
      INSERT INTO audit.oracle_resolution
      VALUES (
        TIMESTAMP '${runId}',
        '${candidate.master_id}',
        ${candidate.season},
        '${candidate.canonical_stat}',
        'bref',
        NULL,
        NULL,
        'blocked_missing_bref_xref',
        'No BBR player slug found in xref.player_xref',
        now()
      )
    `);
    continue;
  }

  const url = bbrPlayerUrl(candidate.source_natural_key);
  const outputPath = artifactPath(candidate);
  const exitCode = await scrape(url, outputPath);
  if (exitCode === 0) {
    scraped++;
  } else {
    failed++;
  }

  await conn.run(`
    INSERT INTO audit.oracle_resolution
    VALUES (
      TIMESTAMP '${runId}',
      '${candidate.master_id}',
      ${candidate.season},
      '${candidate.canonical_stat}',
      'bref',
      '${url}',
      '${outputPath}',
      '${exitCode === 0 ? 'scraped_pending_adjudication' : 'scrape_failed'}',
      '${exitCode === 0 ? 'Firecrawl artifact captured; compare disputed metric manually or with a parser.' : `firecrawl exited ${exitCode}`}',
      now()
    )
  `);
}

await conn.run(`
  INSERT INTO audit.oracle_resolution_run
  VALUES (TIMESTAMP '${runId}', ${candidates.length}, ${scraped}, ${failed}, now());
  CHECKPOINT;
`);

console.log(`Oracle resolution run ${runId}`);
console.log(`queued=${candidates.length} scraped=${scraped} failed=${failed}`);
if (candidates.length === 0) {
  console.log('No HIGH genuine-defect candidates are currently queued for oracle resolution.');
}

if (failed > 0) {
  process.exitCode = 1;
}

conn.closeSync();
