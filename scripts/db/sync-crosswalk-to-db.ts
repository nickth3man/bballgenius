import { readFileSync } from 'node:fs';
import { DuckDBInstance } from '@duckdb/node-api';

const CROSSWALK_PATH = 'master-stat-crosswalk.csv';

const args = new Set(process.argv.slice(2));
const dryRun = !args.has('--apply') && !args.has('--check-drift');
const checkDrift = args.has('--check-drift');

const csvLineCount =
  readFileSync(CROSSWALK_PATH, 'utf-8')
    .split('\n')
    .filter((l: string) => l.trim() !== '').length - 1;

const db = await DuckDBInstance.fromCache('./data/nba.duckdb');
const conn = await db.connect();

if (checkDrift) {
  console.log('[DRIFT CHECK] Reporting unmapped columns without syncing.\n');

  let viewExists = false;
  try {
    await conn.runAndReadAll('SELECT count(*) FROM meta.v_unmapped_columns');
    viewExists = true;
  } catch {
    viewExists = false;
  }

  if (!viewExists) {
    console.log('meta.v_unmapped_columns does not exist. Run with --apply first.');
    process.exit(1);
  }

  const unmappedResult = await conn.runAndReadAll(`
    SELECT schema_name, count(*) AS n
    FROM meta.v_unmapped_columns
    GROUP BY schema_name
    ORDER BY n DESC
  `);
  const bySchema = unmappedResult.getRowObjectsJson() as Array<Record<string, unknown>>;

  let totalUnmapped = 0;
  console.log('Unmapped columns by schema:');
  for (const row of bySchema) {
    const n = Number(row.n);
    totalUnmapped += n;
    console.log(`  ${row.schema_name}: ${n}`);
  }

  const topResult = await conn.runAndReadAll(`
    SELECT schema_name, table_name, column_name, data_type
    FROM meta.v_unmapped_columns
    LIMIT 10
  `);
  const top = topResult.getRowObjectsJson() as Array<Record<string, unknown>>;
  console.log(`\nTop 10 unmapped columns (${totalUnmapped} total):`);
  for (const row of top) {
    console.log(`  ${row.schema_name}.${row.table_name}.${row.column_name} (${row.data_type})`);
  }

  const catalogResult = await conn.runAndReadAll(
    'SELECT count(*) AS n FROM meta.v_column_semantic_catalog',
  );
  const total = Number((catalogResult.getRowObjectsJson()[0] as Record<string, unknown>).n);
  const mapped = total - totalUnmapped;
  const pctMapped = total > 0 ? ((mapped / total) * 100).toFixed(1) : '0.0';
  const pctUnmapped = total > 0 ? ((totalUnmapped / total) * 100).toFixed(1) : '0.0';
  console.log(
    `\nCoverage: ${mapped}/${total} mapped (${pctMapped}%), ${totalUnmapped} unmapped (${pctUnmapped}%)`,
  );
  console.log('\nDrift check complete.');
  process.exit(0);
}

console.log(`${dryRun ? '[DRY RUN] ' : ''}Syncing crosswalk to meta schema...\n`);

await conn.run('CREATE SCHEMA IF NOT EXISTS meta');

let skipReload = false;
if (!dryRun) {
  try {
    const existingResult = await conn.runAndReadAll(
      'SELECT count(*) AS n FROM meta.stat_crosswalk',
    );
    const existingCount = Number(
      (existingResult.getRowObjectsJson()[0] as Record<string, unknown>).n,
    );
    if (existingCount === csvLineCount) {
      console.log(
        `✓ meta.stat_crosswalk already has ${existingCount} rows (matches CSV). Skipping reload.`,
      );
      skipReload = true;
    }
  } catch {
    // table doesn't exist yet
  }
}

const createTableSQL = `
  CREATE OR REPLACE TABLE meta.stat_crosswalk AS
  SELECT * FROM read_csv_auto('${CROSSWALK_PATH}')
`;

if (dryRun) {
  console.log('Would execute:');
  console.log(createTableSQL.trim());
} else if (!skipReload) {
  await conn.run(createTableSQL);
  const countResult = await conn.runAndReadAll('SELECT count(*) AS n FROM meta.stat_crosswalk');
  const countRow = countResult.getRowObjectsJson()[0] as Record<string, unknown>;
  const count = Number(countRow.n);
  if (count !== csvLineCount) {
    console.error(
      `✗ Row count mismatch: DB has ${count} rows but CSV has ${csvLineCount} lines (minus header).`,
    );
    process.exit(1);
  }
  console.log(`✓ Created meta.stat_crosswalk (${count} rows, matches CSV line count)`);
}

const createCatalogViewSQL = `
  CREATE OR REPLACE VIEW meta.v_column_semantic_catalog AS
  SELECT
    c.database_name,
    c.schema_name,
    c.table_name,
    c.column_name,
    c.data_type,
    c.column_index,
    c.internal,
    x.canonical_stat,
    x.family,
    x.per_mode,
    x.side,
    x.definition,
    x.confidence,
    x.source_authority,
    CASE
      WHEN x.canonical_stat IS NOT NULL AND x.canonical_stat != ''
      THEN true ELSE false
    END AS is_mapped,
    COALESCE(x.family, 'unclassified') AS stat_family,
    c."comment" AS column_comment
  FROM duckdb_columns() c
  LEFT JOIN meta.stat_crosswalk x
    ON x.schema = c.schema_name
    AND x."table" = c.table_name
    AND x.column = c.column_name
  WHERE c.schema_name NOT IN ('information_schema', 'pg_catalog', 'meta')
    AND NOT starts_with(c.table_name, 'duckdb_')
    AND NOT starts_with(c.table_name, 'sqlite_')
    AND NOT starts_with(c.table_name, 'pragma_')
`;

if (dryRun) {
  console.log('\nWould execute:');
  console.log(createCatalogViewSQL.trim());
} else {
  await conn.run(createCatalogViewSQL);
  console.log('✓ Created meta.v_column_semantic_catalog');
}

const createUnmappedViewSQL = `
  CREATE OR REPLACE VIEW meta.v_unmapped_columns AS
  SELECT
    c.schema_name,
    c.table_name,
    c.column_name,
    c.data_type
  FROM duckdb_columns() c
  LEFT JOIN meta.stat_crosswalk x
    ON x.schema = c.schema_name
    AND x."table" = c.table_name
    AND x.column = c.column_name
  WHERE x.column IS NULL
    AND c.schema_name NOT IN ('information_schema', 'pg_catalog', 'meta')
    AND NOT starts_with(c.table_name, 'duckdb_')
    AND NOT starts_with(c.table_name, 'sqlite_')
    AND NOT starts_with(c.table_name, 'pragma_')
  ORDER BY c.schema_name, c.table_name, c.column_index
`;

if (dryRun) {
  console.log('\nWould execute:');
  console.log(createUnmappedViewSQL.trim());
} else {
  await conn.run(createUnmappedViewSQL);
  console.log('✓ Created meta.v_unmapped_columns');
}

const index1SQL = `
  CREATE INDEX IF NOT EXISTS idx_crosswalk_table
  ON meta.stat_crosswalk(schema, "table")
`;

const index2SQL = `
  CREATE INDEX IF NOT EXISTS idx_crosswalk_canonical
  ON meta.stat_crosswalk(canonical_stat)
`;

if (dryRun) {
  console.log('\nWould execute:');
  console.log(index1SQL.trim());
  console.log('\nWould execute:');
  console.log(index2SQL.trim());
} else {
  await conn.run(index1SQL);
  await conn.run(index2SQL);
  console.log('✓ Created indexes on meta.stat_crosswalk');
}

if (!dryRun) {
  console.log('\n=== VALIDATION ===');

  let catalogOk = false;
  let catalog = 0;
  try {
    const catalogCount = await conn.runAndReadAll(
      'SELECT count(*) AS n FROM meta.v_column_semantic_catalog',
    );
    catalog = Number((catalogCount.getRowObjectsJson()[0] as Record<string, unknown>).n);
    catalogOk = true;
    console.log(`✓ Semantic catalog queryable: ${catalog} columns`);
  } catch (e) {
    console.error(`✗ meta.v_column_semantic_catalog not queryable: ${e}`);
  }

  let unmappedOk = false;
  let unmapped = 0;
  try {
    const unmappedCount = await conn.runAndReadAll(
      'SELECT count(*) AS n FROM meta.v_unmapped_columns',
    );
    unmapped = Number((unmappedCount.getRowObjectsJson()[0] as Record<string, unknown>).n);
    unmappedOk = true;
    console.log(`✓ Unmapped view queryable: ${unmapped} columns`);
  } catch (e) {
    console.error(`✗ meta.v_unmapped_columns not queryable: ${e}`);
  }

  if (catalogOk && unmappedOk) {
    const mapped = catalog - unmapped;
    const pctMapped = catalog > 0 ? ((mapped / catalog) * 100).toFixed(1) : '0.0';
    const pctUnmapped = catalog > 0 ? ((unmapped / catalog) * 100).toFixed(1) : '0.0';
    console.log(
      `Coverage: ${mapped}/${catalog} mapped (${pctMapped}%), ${unmapped} unmapped (${pctUnmapped}%)`,
    );
  }

  const driftResult = await conn.runAndReadAll(`
    SELECT schema_name, count(*) AS n
    FROM meta.v_unmapped_columns
    GROUP BY schema_name
    ORDER BY n DESC
  `);
  const driftRows = driftResult.getRowObjectsJson() as Array<Record<string, unknown>>;
  if (driftRows.length > 0) {
    console.log('\nDrift: unmapped columns by schema:');
    for (const row of driftRows) {
      console.log(`  ${row.schema_name}: ${row.n}`);
    }
    const topDriftResult = await conn.runAndReadAll(`
      SELECT schema_name, table_name, column_name, data_type
      FROM meta.v_unmapped_columns
      LIMIT 10
    `);
    const topDrift = topDriftResult.getRowObjectsJson() as Array<Record<string, unknown>>;
    console.log('Top 10 unmapped:');
    for (const row of topDrift) {
      console.log(`  ${row.schema_name}.${row.table_name}.${row.column_name} (${row.data_type})`);
    }
  } else {
    console.log('\n✓ No drift detected — all columns are mapped.');
  }

  const sampleResult = await conn.runAndReadAll(`
    SELECT schema_name, table_name, column_name, canonical_stat, family
    FROM meta.v_column_semantic_catalog
    WHERE canonical_stat = 'PTS'
    LIMIT 5
  `);
  const sample = sampleResult.getRowObjectsJson() as Array<Record<string, unknown>>;
  console.log('\nSample: columns mapping to "PTS":');
  for (const row of sample) {
    console.log(`  ${row.schema_name}.${row.table_name}.${row.column_name} [${row.family}]`);
  }
}

console.log(`\n${dryRun ? 'Dry run complete. Use --apply to execute.' : 'Sync complete.'}`);
