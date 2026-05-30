import { DuckDBInstance } from '@duckdb/node-api';

const DB_PATH = process.env['NBA_DUCKDB_PATH'] ?? './data/nba.duckdb';

type ObjectKind = 'table' | 'view' | 'index';

type CheckResult = {
  name: string;
  kind: ObjectKind;
  exists: boolean;
  queryable: boolean;
  rowCount: number | null;
  error: string | null;
};

const EXPECTED_TABLES = ['meta.stat_crosswalk'] as const;

const EXPECTED_VIEWS = [
  'meta.v_column_semantic_catalog',
  'meta.v_unmapped_columns',
  'api.v_canonical_player_season_totals',
  'api.v_canonical_player_game_stats',
  'api.v_canonical_player_season_per_game',
  'api.v_canonical_unified_player_season',
  'api.v_canonical_team_season',
] as const;

const EXPECTED_INDEXES = ['idx_crosswalk_table', 'idx_crosswalk_canonical'] as const;

const db = await DuckDBInstance.fromCache(DB_PATH);
const conn = await db.connect();

async function checkTableOrView(fullName: string, kind: 'table' | 'view'): Promise<CheckResult> {
  const [schemaName, objectName] = fullName.split('.');
  try {
    const metaTable = kind === 'table' ? 'duckdb_tables()' : 'duckdb_views()';
    const nameCol = kind === 'table' ? 'table_name' : 'view_name';
    const metaResult = await conn.runAndReadAll(
      `SELECT count(*) AS n FROM ${metaTable} WHERE schema_name = '${schemaName}' AND ${nameCol} = '${objectName}'`,
    );
    const metaRow = metaResult.getRowObjectsJson()[0];
    const exists = Number(metaRow['n']) > 0;

    if (!exists) {
      return {
        name: fullName,
        kind,
        exists: false,
        queryable: false,
        rowCount: null,
        error: 'not found in catalog',
      };
    }

    const countResult = await conn.runAndReadAll(`SELECT count(*) AS n FROM ${fullName}`);
    const countRow = countResult.getRowObjectsJson()[0];
    const rowCount = Number(countRow['n']);

    return { name: fullName, kind, exists: true, queryable: true, rowCount, error: null };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      name: fullName,
      kind,
      exists: false,
      queryable: false,
      rowCount: null,
      error: message,
    };
  }
}

async function checkIndex(indexName: string): Promise<CheckResult> {
  try {
    const metaResult = await conn.runAndReadAll(
      `SELECT count(*) AS n FROM duckdb_indexes() WHERE index_name = '${indexName}'`,
    );
    const metaRow = metaResult.getRowObjectsJson()[0];
    const exists = Number(metaRow['n']) > 0;

    return {
      name: indexName,
      kind: 'index',
      exists,
      queryable: exists,
      rowCount: null,
      error: exists ? null : 'not found in catalog',
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      name: indexName,
      kind: 'index',
      exists: false,
      queryable: false,
      rowCount: null,
      error: message,
    };
  }
}

const results: CheckResult[] = [];

for (const table of EXPECTED_TABLES) {
  results.push(await checkTableOrView(table, 'table'));
}

for (const view of EXPECTED_VIEWS) {
  results.push(await checkTableOrView(view, 'view'));
}

for (const index of EXPECTED_INDEXES) {
  results.push(await checkIndex(index));
}

const totalExpected = results.length;
const totalPassed = results.filter((r) => r.exists && r.queryable).length;
const allPassed = totalPassed === totalExpected;

console.log('\n=== META SCHEMA VALIDATION ===');

for (const r of results) {
  const mark = r.exists && r.queryable ? '\u2713' : '\u2717';
  let detail: string = r.kind;
  if (r.rowCount !== null) {
    detail = `${r.kind}, ${r.rowCount} rows`;
  }
  if (r.error) {
    detail = `${r.kind}, ERROR: ${r.error}`;
  }
  console.log(`${mark} ${r.name} (${detail})`);
}

console.log(
  `\nRESULT: ${totalPassed}/${totalExpected} objects validated ${allPassed ? '\u2713' : '\u2717'}`,
);

process.exit(allPassed ? 0 : 1);
