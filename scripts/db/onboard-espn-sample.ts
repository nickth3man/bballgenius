/**
 * Phase 6 acceptance test for the cross-source reconciliation plan
 * (.claude/plans/i-would-like-to-serialized-lake.md).
 *
 * Lands the real ESPN athlete sample (scripts/db/sources/espn_player_sample.csv)
 * into raw_espn.player. After this, the standard onboarding path applies with no
 * further schema work:
 *   1. bun run scripts/db/onboard-espn-sample.ts --apply        (this script)
 *   2. bun run scripts/db/build-source-registry.ts --apply      (registers espn)
 *   3. bun run scripts/db/resolve-entities.ts --source espn --apply
 *
 *   bun run scripts/db/onboard-espn-sample.ts          # dry run
 *   bun run scripts/db/onboard-espn-sample.ts --apply
 */
import { DuckDBInstance } from '@duckdb/node-api';

const dryRun = !process.argv.includes('--apply');
const CSV = 'scripts/db/sources/espn_player_sample.csv';

const db = await DuckDBInstance.fromCache('./data/nba.duckdb');
const conn = await db.connect();
const q = async (sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJson();

const n = (await q(`SELECT count(*) AS n FROM read_csv_auto('${CSV}')`))[0].n;
console.log(`${dryRun ? '[DRY RUN] ' : ''}ESPN sample: ${n} athletes from ${CSV}`);

if (dryRun) {
  console.log(
    'Would CREATE SCHEMA raw_espn; CREATE OR REPLACE TABLE raw_espn.player AS SELECT * FROM csv.',
  );
  console.log('Dry run complete. Use --apply to execute.');
  process.exit(0);
}

await conn.run('CREATE SCHEMA IF NOT EXISTS raw_espn');
await conn.run(`
  CREATE OR REPLACE TABLE raw_espn.player AS
  SELECT CAST(espn_id AS BIGINT) AS espn_id, full_name FROM read_csv_auto('${CSV}')
`);
const rows = (await q('SELECT count(*) AS n FROM raw_espn.player'))[0].n;
await conn.run('CHECKPOINT'); // flush WAL → avoid cross-process replay bug
console.log(`✓ raw_espn.player created with ${rows} rows.`);
console.log(
  'Next: build-source-registry.ts --apply, then resolve-entities.ts --source espn --apply',
);
