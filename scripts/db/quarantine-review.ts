/**
 * Review and resolve quarantined rows from staging tables.
 *
 * Quarantine tables (named `quarantine_%`) in `stg_*` schemas hold rows that
 * failed validation during ingestion. This script provides visibility into
 * quarantined data and supports resolution actions.
 *
 * Usage:
 *   bun run scripts/db/quarantine-review.ts                    # review (default)
 *   bun run scripts/db/quarantine-review.ts --apply --action=promote
 *   bun run scripts/db/quarantine-review.ts --apply --action=purge --older-than=30
 *   bun run scripts/db/quarantine-review.ts --apply --action=export --export=./quarantine.csv
 */

import { writeFileSync } from 'node:fs';
import { DuckDBInstance } from '@duckdb/node-api';

const DB_PATH = process.env['NBA_DUCKDB_PATH'] ?? './data/nba.duckdb';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const dryRun = !apply;
const action = getArgValue('--action') ?? 'review';
const olderThanDays = Number(getArgValue('--older-than') ?? '30');
const exportPath = getArgValue('--export') ?? './quarantine-export.csv';
const reviewedBy = getArgValue('--reviewed-by') ?? 'quarantine-review-script';
const notes = getArgValue('--notes') ?? '';

function getArgValue(prefix: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return arg?.split('=')[1];
}

const db = await DuckDBInstance.fromCache(DB_PATH);
const conn = await db.connect();

async function rows(sql: string): Promise<Array<Record<string, unknown>>> {
  return (await conn.runAndReadAll(sql)).getRowObjectsJson() as Array<Record<string, unknown>>;
}

async function scalar(sql: string): Promise<number> {
  const [row] = await rows(sql);
  return Number(row?.['n'] ?? 0);
}

async function run(sql: string): Promise<void> {
  if (dryRun) {
    console.log(`\n-- DRY RUN SQL --\n${sql.trim()}\n`);
    return;
  }
  await conn.run(sql);
}

console.log(`${dryRun ? '[DRY RUN]' : '[APPLY]'} Quarantine Review`);
console.log(`DB: ${DB_PATH}`);
console.log(`Action: ${action}`);
if (action === 'purge') console.log(`Older than: ${olderThanDays} days`);
if (action === 'export') console.log(`Export path: ${exportPath}`);
console.log('');

await run(`
  CREATE SCHEMA IF NOT EXISTS audit;

  CREATE TABLE IF NOT EXISTS audit.quarantine_review_log (
    reviewed_at TIMESTAMP DEFAULT now(),
    quarantine_table VARCHAR,
    action VARCHAR,
    row_count BIGINT,
    reviewed_by VARCHAR,
    notes VARCHAR
  );
`);

const quarantineTables = await rows(`
  SELECT table_schema, table_name
  FROM information_schema.tables
  WHERE table_name LIKE 'quarantine_%'
    AND table_schema LIKE 'stg_%'
  ORDER BY table_schema, table_name
`);

if (quarantineTables.length === 0) {
  console.log('No quarantine tables found in stg_* schemas.');
  conn.closeSync();
  process.exit(0);
}

console.log(`Found ${quarantineTables.length} quarantine table(s):\n`);

for (const table of quarantineTables) {
  const schema = table['table_schema'] as string;
  const tableName = table['table_name'] as string;
  const fullName = `${schema}.${tableName}`;

  console.log(`\n${'='.repeat(72)}`);
  console.log(`Table: ${fullName}`);
  console.log('='.repeat(72));

  const count = await scalar(`SELECT count(*) AS n FROM ${fullName}`);
  console.log(`Row count: ${count}`);

  if (count === 0) {
    console.log('(empty)');
    continue;
  }

  const columns = await rows(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = '${schema}' AND table_name = '${tableName}'
    ORDER BY ordinal_position
  `);
  const columnNames = columns.map((c) => c['column_name'] as string);
  const hasReason = columnNames.includes('reason');
  const hasQuarantinedAt = columnNames.includes('quarantined_at');

  console.log('\nSample rows (first 5):');
  const sampleSql = `SELECT * FROM ${fullName} LIMIT 5`;
  const sample = await rows(sampleSql);
  for (const row of sample) {
    console.log(JSON.stringify(row, null, 2));
  }

  if (hasQuarantinedAt) {
    console.log('\nAge distribution:');
    const ageDistribution = await rows(`
      SELECT
        CASE
          WHEN quarantined_at >= current_date - INTERVAL '1 day' THEN '< 1 day'
          WHEN quarantined_at >= current_date - INTERVAL '7 days' THEN '1-7 days'
          WHEN quarantined_at >= current_date - INTERVAL '30 days' THEN '7-30 days'
          WHEN quarantined_at >= current_date - INTERVAL '90 days' THEN '30-90 days'
          ELSE '> 90 days'
        END AS age_bucket,
        count(*) AS row_count
      FROM ${fullName}
      GROUP BY 1
      ORDER BY
        CASE
          WHEN age_bucket = '< 1 day' THEN 1
          WHEN age_bucket = '1-7 days' THEN 2
          WHEN age_bucket = '7-30 days' THEN 3
          WHEN age_bucket = '30-90 days' THEN 4
          ELSE 5
        END
    `);
    for (const bucket of ageDistribution) {
      const label = bucket['age_bucket'] as string;
      const bucketCount = bucket['row_count'] as number;
      console.log(`  ${label.padEnd(12)} ${bucketCount}`);
    }
  }

  if (hasReason) {
    console.log('\nReason distribution:');
    const reasonDistribution = await rows(`
      SELECT coalesce(reason, '(null)') AS reason, count(*) AS row_count
      FROM ${fullName}
      GROUP BY 1
      ORDER BY row_count DESC
      LIMIT 10
    `);
    for (const r of reasonDistribution) {
      const reason = r['reason'] as string;
      const reasonCount = r['row_count'] as number;
      console.log(`  ${reason.padEnd(40)} ${reasonCount}`);
    }
  }

  if (action === 'review') continue;

  if (action === 'promote') {
    const sourceTable = tableName.replace(/^quarantine_/, '');
    const sourceFullName = `${schema}.${sourceTable}`;

    const sourceExists = await scalar(`
      SELECT count(*) AS n FROM information_schema.tables
      WHERE table_schema = '${schema}' AND table_name = '${sourceTable}'
    `);

    if (sourceExists === 0) {
      console.log(`\nCannot promote: source table ${sourceFullName} does not exist.`);
      continue;
    }

    const commonColumns = await rows(`
      SELECT q.column_name
      FROM information_schema.columns q
      INNER JOIN information_schema.columns s
        ON s.table_schema = q.table_schema AND s.table_name = '${sourceTable}'
        AND s.column_name = q.column_name
      WHERE q.table_schema = '${schema}' AND q.table_name = '${tableName}'
      ORDER BY q.ordinal_position
    `);

    if (commonColumns.length === 0) {
      console.log(`\nCannot promote: no common columns with ${sourceFullName}.`);
      continue;
    }

    const cols = commonColumns.map((c) => c['column_name'] as string).join(', ');
    console.log(`\nPromoting ${count} rows to ${sourceFullName} (columns: ${cols})`);

    await run(`
      INSERT INTO ${sourceFullName} (${cols})
      SELECT ${cols} FROM ${fullName}
    `);

    await run(`DELETE FROM ${fullName}`);

    await run(`
      INSERT INTO audit.quarantine_review_log
        (quarantine_table, action, row_count, reviewed_by, notes)
      VALUES ('${fullName}', 'promote', ${count}, '${reviewedBy}', '${notes}')
    `);
  }

  if (action === 'purge') {
    if (!hasQuarantinedAt) {
      console.log(`\nCannot purge: ${fullName} has no quarantined_at column.`);
      continue;
    }

    const purgeCount = await scalar(`
      SELECT count(*) AS n FROM ${fullName}
      WHERE quarantined_at < current_date - INTERVAL '${olderThanDays} days'
    `);

    if (purgeCount === 0) {
      console.log(`\nNo rows older than ${olderThanDays} days to purge.`);
      continue;
    }

    console.log(`\nPurging ${purgeCount} rows older than ${olderThanDays} days`);

    await run(`
      DELETE FROM ${fullName}
      WHERE quarantined_at < current_date - INTERVAL '${olderThanDays} days'
    `);

    await run(`
      INSERT INTO audit.quarantine_review_log
        (quarantine_table, action, row_count, reviewed_by, notes)
      VALUES ('${fullName}', 'purge', ${purgeCount}, '${reviewedBy}', 'older than ${olderThanDays} days')
    `);
  }

  if (action === 'export') {
    console.log(`\nExporting ${count} rows to ${exportPath}`);

    const exportData = await rows(`SELECT * FROM ${fullName}`);
    const headers = columnNames.join(',');
    const csvRows = exportData.map((row) =>
      columnNames
        .map((col) => {
          const val = row[col];
          if (val === null || val === undefined) return '';
          const str = String(val);
          return str.includes(',') || str.includes('"') || str.includes('\n')
            ? `"${str.replaceAll('"', '""')}"`
            : str;
        })
        .join(','),
    );
    const csv = [headers, ...csvRows].join('\n');

    if (dryRun) {
      console.log(`\n-- DRY RUN: Would write ${csv.length} bytes to ${exportPath} --`);
      console.log('First 500 chars:');
      console.log(csv.slice(0, 500));
    } else {
      writeFileSync(exportPath, csv, 'utf-8');
      console.log(`Exported to ${exportPath}`);
    }

    await run(`
      INSERT INTO audit.quarantine_review_log
        (quarantine_table, action, row_count, reviewed_by, notes)
      VALUES ('${fullName}', 'export', ${count}, '${reviewedBy}', 'exported to ${exportPath}')
    `);
  }
}

if (!dryRun) {
  await conn.run('CHECKPOINT');
}

console.log(
  dryRun ? '\nDry run complete. Use --apply to write changes.' : '\nQuarantine review complete.',
);
conn.closeSync();
