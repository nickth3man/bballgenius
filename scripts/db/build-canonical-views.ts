import { DuckDBInstance } from '@duckdb/node-api';

const DB_PATH = './data/nba.duckdb';

type TargetTable = {
  schema: string;
  table: string;
  viewName: string;
};

const TARGETS: TargetTable[] = [
  {
    schema: 'main',
    table: 'fact_bref_player_season_totals',
    viewName: 'api.v_canonical_player_season_totals',
  },
  {
    schema: 'main',
    table: 'fact_player_game_stats',
    viewName: 'api.v_canonical_player_game_stats',
  },
  {
    schema: 'main',
    table: 'fact_bref_player_season_per_game',
    viewName: 'api.v_canonical_player_season_per_game',
  },
  {
    schema: 'unified_star',
    table: 'fact_player_season_stats',
    viewName: 'api.v_canonical_unified_player_season',
  },
  {
    schema: 'main',
    table: 'fact_bref_team_season_summary',
    viewName: 'api.v_canonical_team_season',
  },
];

const EXCLUDED_FAMILIES = new Set(['etl_metadata', 'coordinate']);

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');

const db = await DuckDBInstance.fromCache(DB_PATH);
const conn = await db.connect();

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

async function buildViewDDL(target: TargetTable): Promise<string | null> {
  const rows = (await (
    await conn.runAndReadAll(
      `SELECT "column", canonical_stat, family, type
       FROM meta.stat_crosswalk
       WHERE schema = '${target.schema}'
         AND "table" = '${target.table}'
         AND canonical_stat IS NOT NULL
         AND canonical_stat != ''
         AND (family IS NULL OR family NOT IN (${[...EXCLUDED_FAMILIES].map((f) => `'${f}'`).join(',')}))
       ORDER BY "column"`,
    )
  ).getRowObjectsJson()) as Array<Record<string, string>>;

  if (rows.length === 0) {
    return null;
  }

  const seenCanonical = new Set<string>();
  const selectList: string[] = [];

  for (const row of rows) {
    const col = row.column;
    const canonical = row.canonical_stat;

    if (seenCanonical.has(canonical)) {
      continue;
    }
    seenCanonical.add(canonical);

    const colRef = quoteIdent(col);
    const alias = quoteIdent(canonical);
    selectList.push(`  ${colRef} AS ${alias}`);
  }

  const sourceRef = `${quoteIdent(target.schema)}.${quoteIdent(target.table)}`;
  return `CREATE OR REPLACE VIEW ${target.viewName} AS\nSELECT\n${selectList.join(',\n')}\nFROM ${sourceRef}`;
}

console.log(`${apply ? '[APPLY]' : '[DRY RUN]'} Building canonical views...\n`);

let created = 0;
let skipped = 0;

for (const target of TARGETS) {
  const ddl = await buildViewDDL(target);

  if (!ddl) {
    console.log(`⊘ ${target.viewName}: no mapped columns found, skipping`);
    skipped++;
    continue;
  }

  if (!apply) {
    console.log(`--- ${target.viewName} ---`);
    console.log(ddl);
    console.log();
    continue;
  }

  try {
    await conn.run(ddl);
    const countRow = (
      await (
        await conn.runAndReadAll(`SELECT count(*) AS n FROM ${target.viewName}`)
      ).getRowObjectsJson()
    )[0] as Record<string, unknown>;
    const n = Number(countRow.n);
    console.log(`✓ ${target.viewName} (${n} rows)`);
    created++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`✗ ${target.viewName}: ${msg}`);
  }
}

if (!apply) {
  console.log(
    `\nDry run: ${TARGETS.length - skipped} views would be created. Use --apply to persist.`,
  );
} else {
  console.log(`\n${created} canonical views created, ${skipped} skipped.`);
}
