/**
 * Phase 1 of the cross-source reconciliation plan
 * (.claude/plans/i-would-like-to-serialized-lake.md).
 *
 * Loads the TypeScript source manifests in `scripts/db/sources/` into a
 * data-driven registry:
 *   - meta.source              one row per data source
 *   - meta.source_entity       one row per (source × entity grain) with keys
 *   - meta.source_column_map    canonical-column → source projection, derived
 *                               from the existing meta.stat_crosswalk via the
 *                               manifest's crosswalkAuthority (no re-entry)
 *
 * Every declared raw table + key column is validated against the live catalog
 * so manifest drift is caught here rather than at resolve time.
 *
 * Usage:
 *   bun run scripts/db/build-source-registry.ts            # dry run (default)
 *   bun run scripts/db/build-source-registry.ts --apply    # write to DB
 */
import { DuckDBInstance } from '@duckdb/node-api';
import { SOURCE_MANIFESTS } from './sources/index';
import type { SourceManifest } from './sources/types';

const args = new Set(process.argv.slice(2));
const dryRun = !args.has('--apply');

const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const list = (xs: string[]): string => `[${xs.map(q).join(', ')}]`;

const db = await DuckDBInstance.fromCache('./data/nba.duckdb');
const conn = await db.connect();

console.log(`${dryRun ? '[DRY RUN] ' : ''}Building source registry from manifests...\n`);

// ---------------------------------------------------------------------------
// 1. Validate every manifest entity against the live catalog
// ---------------------------------------------------------------------------
type ColRow = { table_schema: string; table_name: string; column_name: string };
const colResult = await conn.runAndReadAll(
  'SELECT table_schema, table_name, column_name FROM information_schema.columns',
);
const cols = colResult.getRowObjectsJson() as unknown as ColRow[];
const colSet = new Set(cols.map((c) => `${c.table_schema}.${c.table_name}.${c.column_name}`));
const tableSet = new Set(cols.map((c) => `${c.table_schema}.${c.table_name}`));

const problems: string[] = [];
for (const m of SOURCE_MANIFESTS) {
  for (const e of m.entities) {
    const tbl = `${e.rawSchema}.${e.rawTable}`;
    if (!tableSet.has(tbl)) {
      problems.push(`${m.sourceId}: missing table ${tbl}`);
      continue;
    }
    for (const c of [
      ...e.naturalKey,
      ...e.blockingKey,
      ...(e.sourceIdColumn ? [e.sourceIdColumn] : []),
    ]) {
      if (!colSet.has(`${tbl}.${c}`)) {
        problems.push(`${m.sourceId}: ${tbl} has no column "${c}"`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error('✗ Manifest validation failed:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `✓ Validated ${SOURCE_MANIFESTS.length} sources / ` +
    `${SOURCE_MANIFESTS.reduce((n, m) => n + m.entities.length, 0)} entity grains against the catalog`,
);

// ---------------------------------------------------------------------------
// 2. Build DDL + inserts
// ---------------------------------------------------------------------------
const sourceRows = SOURCE_MANIFESTS.map(
  (m: SourceManifest) =>
    `(${q(m.sourceId)}, ${q(m.name)}, ${m.trustTier}, ` +
    `${m.urlPattern ? q(m.urlPattern) : 'NULL'}, ${q(m.license)}, ${q(m.cadence)}, ` +
    `${m.crosswalkAuthority ? q(m.crosswalkAuthority) : 'NULL'}, ${q(m.description)})`,
).join(',\n    ');

const entityRows = SOURCE_MANIFESTS.flatMap((m) =>
  m.entities.map(
    (e) =>
      `(${q(m.sourceId)}, ${q(e.entity)}, ${q(e.grain)}, ${q(e.rawSchema)}, ${q(e.rawTable)}, ` +
      `${list(e.naturalKey)}, ${list(e.blockingKey)}, ${e.sourceIdColumn ? q(e.sourceIdColumn) : 'NULL'})`,
  ),
).join(',\n    ');

const ddl = `
CREATE SCHEMA IF NOT EXISTS meta;

-- Drop dependents first (FK: source_entity/source_column_map → source).
DROP TABLE IF EXISTS meta.source_column_map;
DROP TABLE IF EXISTS meta.source_entity;
DROP TABLE IF EXISTS meta.source;

CREATE TABLE meta.source (
  source_id     VARCHAR PRIMARY KEY,
  name          VARCHAR NOT NULL,
  trust_tier    INTEGER NOT NULL,
  url_pattern   VARCHAR,
  license       VARCHAR,
  cadence       VARCHAR,
  crosswalk_authority VARCHAR,
  description   VARCHAR,
  registered_at TIMESTAMP DEFAULT now()
);
INSERT INTO meta.source
  (source_id, name, trust_tier, url_pattern, license, cadence, crosswalk_authority, description)
VALUES
    ${sourceRows};

CREATE TABLE meta.source_entity (
  source_id       VARCHAR NOT NULL REFERENCES meta.source(source_id),
  entity          VARCHAR NOT NULL,
  grain           VARCHAR,
  raw_schema      VARCHAR NOT NULL,
  raw_table       VARCHAR NOT NULL,
  natural_key     VARCHAR[] NOT NULL,
  blocking_key    VARCHAR[] NOT NULL,
  source_id_column VARCHAR
);
INSERT INTO meta.source_entity
  (source_id, entity, grain, raw_schema, raw_table, natural_key, blocking_key, source_id_column)
VALUES
    ${entityRows};
`;

if (dryRun) {
  console.log('\nWould execute:\n');
  console.log(ddl.trim());
} else {
  await conn.run(ddl);
  console.log('✓ Created meta.source and meta.source_entity');
}

// ---------------------------------------------------------------------------
// 3. Derive meta.source_column_map from the existing crosswalk (if present)
// ---------------------------------------------------------------------------
let hasCrosswalk = false;
try {
  await conn.runAndReadAll('SELECT 1 FROM meta.stat_crosswalk LIMIT 1');
  hasCrosswalk = true;
} catch {
  hasCrosswalk = false;
}

const colMapDDL = `
CREATE OR REPLACE TABLE meta.source_column_map AS
SELECT
  s.source_id,
  x.schema  AS curated_schema,
  x."table" AS curated_table,
  x.column  AS curated_column,
  x.canonical_stat,
  x.family,
  x.per_mode,
  x.side,
  x.confidence,
  x.source_authority
FROM meta.stat_crosswalk x
JOIN meta.source s ON s.crosswalk_authority = x.source_authority
WHERE x.canonical_stat IS NOT NULL AND x.canonical_stat <> '';
`;

if (!hasCrosswalk) {
  console.log(
    '\n⚠ meta.stat_crosswalk not found — skipping meta.source_column_map. ' +
      'Run `bun run scripts/db/sync-crosswalk-to-db.ts --apply` first to enable it.',
  );
} else if (dryRun) {
  console.log('\nWould execute:\n');
  console.log(colMapDDL.trim());
} else {
  await conn.run(colMapDDL);
  console.log('✓ Created meta.source_column_map (derived from meta.stat_crosswalk)');
}

// ---------------------------------------------------------------------------
// 4. Validation summary
// ---------------------------------------------------------------------------
if (!dryRun) {
  console.log('\n=== VALIDATION ===');
  const summary = await conn.runAndReadAll(`
    SELECT s.source_id, s.trust_tier,
           count(DISTINCT e.entity || ':' || e.raw_table) AS entity_grains
    FROM meta.source s
    LEFT JOIN meta.source_entity e USING (source_id)
    GROUP BY s.source_id, s.trust_tier
    ORDER BY s.trust_tier, s.source_id
  `);
  for (const r of summary.getRowObjectsJson() as Array<Record<string, unknown>>) {
    console.log(`  ${r.source_id} (tier ${r.trust_tier}): ${r.entity_grains} entity grain(s)`);
  }
  if (hasCrosswalk) {
    const mapped = await conn.runAndReadAll(`
      SELECT source_id, count(*) AS n FROM meta.source_column_map GROUP BY source_id ORDER BY n DESC
    `);
    console.log('\nsource_column_map rows by source:');
    for (const r of mapped.getRowObjectsJson() as Array<Record<string, unknown>>) {
      console.log(`  ${r.source_id}: ${r.n}`);
    }
  }
}

if (!dryRun) await conn.run('CHECKPOINT'); // flush WAL → avoid cross-process replay bug
console.log(
  `\n${dryRun ? 'Dry run complete. Use --apply to execute.' : 'Source registry build complete.'}`,
);
