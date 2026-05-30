/**
 * Phase 2 of the cross-source reconciliation plan
 * (.claude/plans/i-would-like-to-serialized-lake.md).
 *
 * Builds the tall `xref` (cross-reference) layer that maps every source's
 * natural key to a single master id per real-world entity. Seeded
 * deterministically from the existing `unified_star` master dims, which already
 * carry the resolved cross-source keys (dim_player.bref_player_id,
 * dim_team.bref_team_code, shared NBA id space for nba_stats). Genuinely new
 * sources are added later via `resolve-entities.ts`.
 *
 * Schema (one table per entity, identical shape):
 *   master_id, source_id, source_natural_key, match_method, confidence,
 *   valid_from, valid_to, evidence, resolved_by, resolved_at
 *
 * Manual fixes live in `xref.match_override` and are replayed on every rebuild,
 * so hand corrections survive a reseed.
 *
 *   bun run scripts/db/build-xref.ts            # dry run (default)
 *   bun run scripts/db/build-xref.ts --apply    # write to DB
 */
import { DuckDBInstance } from '@duckdb/node-api';

const args = new Set(process.argv.slice(2));
const dryRun = !args.has('--apply');

interface EntitySeed {
  entity: 'player' | 'team' | 'game' | 'official';
  /** SELECT producing (master_id, source_id, source_natural_key, evidence). */
  seedSelect: string;
}

const SEED_COLS =
  'master_id, source_id, source_natural_key, match_method, confidence, ' +
  'valid_from, valid_to, evidence, resolved_by, resolved_at';

const SEEDS: EntitySeed[] = [
  {
    entity: 'player',
    seedSelect: `
      -- NBA id space (Kaggle Walsh)
      SELECT CAST(player_id AS VARCHAR) AS master_id, 'nba_api_sqlite' AS source_id,
             CAST(player_id AS VARCHAR) AS source_natural_key, 'dim_player.player_id' AS evidence
      FROM unified_star.dim_player WHERE player_id IS NOT NULL
      UNION ALL
      -- Basketball-Reference slug
      SELECT CAST(player_id AS VARCHAR), 'bref', bref_player_id, 'dim_player.bref_player_id'
      FROM unified_star.dim_player WHERE bref_player_id IS NOT NULL AND player_id IS NOT NULL
      UNION ALL
      -- stats.nba.com feeds: presence-restricted to players actually in the box scores
      SELECT CAST(d.player_id AS VARCHAR), 'nba_stats', CAST(d.player_id AS VARCHAR),
             'nba_stats player boxscores (shared NBA id)'
      FROM unified_star.dim_player d
      WHERE d.player_id IN (SELECT DISTINCT player_id FROM raw_sqlite.nba_stats__player_boxscores)
    `,
  },
  {
    entity: 'team',
    seedSelect: `
      SELECT CAST(team_id AS VARCHAR) AS master_id, 'nba_api_sqlite' AS source_id,
             CAST(team_id AS VARCHAR) AS source_natural_key, 'dim_team.team_id' AS evidence
      FROM unified_star.dim_team WHERE team_id IS NOT NULL
      UNION ALL
      SELECT CAST(team_id AS VARCHAR), 'nba_stats', CAST(team_id AS VARCHAR), 'dim_team.team_id (shared NBA id)'
      FROM unified_star.dim_team WHERE team_id IS NOT NULL
      UNION ALL
      SELECT CAST(team_id AS VARCHAR), 'bref', bref_team_code, 'dim_team.bref_team_code'
      FROM unified_star.dim_team WHERE bref_team_code IS NOT NULL AND team_id IS NOT NULL
    `,
  },
  {
    entity: 'game',
    seedSelect: `
      SELECT CAST(game_id AS VARCHAR) AS master_id, 'nba_api_sqlite' AS source_id,
             CAST(game_id AS VARCHAR) AS source_natural_key, 'dim_game.game_id' AS evidence
      FROM unified_star.dim_game WHERE game_id IS NOT NULL
      UNION ALL
      SELECT CAST(d.game_id AS VARCHAR), 'nba_stats', CAST(d.game_id AS VARCHAR),
             'nba_stats schedule (shared NBA game id)'
      FROM unified_star.dim_game d
      WHERE CAST(d.game_id AS VARCHAR) IN (
        SELECT DISTINCT CAST(game_id AS VARCHAR) FROM raw_sqlite.nba_stats__games_schedule
      )
    `,
  },
  {
    entity: 'official',
    seedSelect: `
      SELECT CAST(official_id AS VARCHAR) AS master_id, 'nba_api_sqlite' AS source_id,
             CAST(official_id AS VARCHAR) AS source_natural_key, 'dim_official.official_id' AS evidence
      FROM unified_star.dim_official WHERE official_id IS NOT NULL
    `,
  },
];

const db = await DuckDBInstance.fromCache('./data/nba.duckdb');
const conn = await db.connect();
const q = async (sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJson();

console.log(`${dryRun ? '[DRY RUN] ' : ''}Building xref layer from master dims...\n`);

const tableDDL = (entity: string) => `
CREATE OR REPLACE TABLE xref.${entity}_xref (
  master_id          VARCHAR NOT NULL,
  source_id          VARCHAR NOT NULL,
  source_natural_key VARCHAR NOT NULL,
  match_method       VARCHAR NOT NULL,
  confidence         DOUBLE  NOT NULL,
  valid_from         DATE,
  valid_to           DATE,
  evidence           VARCHAR,
  resolved_by        VARCHAR,
  resolved_at        TIMESTAMP DEFAULT now()
);`;

const seedDML = (s: EntitySeed) => `
INSERT INTO xref.${s.entity}_xref (${SEED_COLS})
SELECT master_id, source_id, source_natural_key, 'master_seed' AS match_method,
       1.0 AS confidence, NULL::DATE AS valid_from, NULL::DATE AS valid_to,
       evidence, 'build-xref' AS resolved_by, now() AS resolved_at
FROM (${s.seedSelect}) seed;`;

const overrideDDL = `
CREATE TABLE IF NOT EXISTS xref.match_override (
  entity             VARCHAR NOT NULL,
  source_id          VARCHAR NOT NULL,
  source_natural_key VARCHAR NOT NULL,
  master_id          VARCHAR,
  action             VARCHAR NOT NULL,   -- 'force' | 'reject'
  note               VARCHAR,
  created_at         TIMESTAMP DEFAULT now()
);`;

// Replay overrides: 'reject' removes a seeded mapping, 'force' upserts the corrected one.
const replaySQL = (entity: string) => `
DELETE FROM xref.${entity}_xref x
USING xref.match_override o
WHERE o.entity = '${entity}' AND o.source_id = x.source_id
  AND o.source_natural_key = x.source_natural_key;
INSERT INTO xref.${entity}_xref (${SEED_COLS})
SELECT o.master_id, o.source_id, o.source_natural_key, 'manual_override', 1.0,
       NULL::DATE, NULL::DATE, COALESCE(o.note, 'manual override'), 'match_override', now()
FROM xref.match_override o
WHERE o.entity = '${entity}' AND o.action = 'force' AND o.master_id IS NOT NULL;`;

if (dryRun) {
  console.log('Would CREATE SCHEMA xref; create override table; then per entity:');
  for (const s of SEEDS) {
    const n = (await q(`SELECT count(*) AS n FROM (${s.seedSelect}) t`))[0].n;
    console.log(`  ${s.entity}_xref  ←  ${n} seed rows`);
  }
  console.log('\nDry run complete. Use --apply to execute.');
  process.exit(0);
}

await conn.run('CREATE SCHEMA IF NOT EXISTS xref');
await conn.run(overrideDDL);
console.log('✓ Schema xref + xref.match_override ready');

await conn.run(
  'CREATE TABLE IF NOT EXISTS audit.xref_coverage (entity VARCHAR, source_id VARCHAR, mapped_rows BIGINT, distinct_masters BIGINT, built_at TIMESTAMP)',
);
await conn.run('DELETE FROM audit.xref_coverage WHERE built_at < now()');

for (const s of SEEDS) {
  await conn.run(tableDDL(s.entity));
  await conn.run(seedDML(s));
  await conn.run(replaySQL(s.entity));
  const cov = (await q(`
    SELECT source_id, count(*) AS mapped_rows, count(DISTINCT master_id) AS distinct_masters
    FROM xref.${s.entity}_xref GROUP BY source_id ORDER BY source_id
  `)) as Array<Record<string, unknown>>;
  for (const r of cov) {
    await conn.run(
      `INSERT INTO audit.xref_coverage VALUES ('${s.entity}', '${r.source_id}', ${r.mapped_rows}, ${r.distinct_masters}, now())`,
    );
  }
  console.log(`✓ xref.${s.entity}_xref built:`);
  for (const r of cov)
    console.log(`    ${r.source_id}: ${r.mapped_rows} rows / ${r.distinct_masters} masters`);
}

// Invariant: every source_natural_key maps to exactly one master per source.
console.log('\n=== VALIDATION ===');
let ok = true;
for (const s of SEEDS) {
  const dup = (
    await q(`
    SELECT count(*) AS n FROM (
      SELECT source_id, source_natural_key FROM xref.${s.entity}_xref
      GROUP BY 1,2 HAVING count(DISTINCT master_id) > 1
    )
  `)
  )[0].n;
  const flag = Number(dup) === 0 ? '✓' : '✗';
  if (Number(dup) !== 0) ok = false;
  console.log(`  ${flag} ${s.entity}_xref: ${dup} ambiguous (key→multiple masters)`);
}
console.log(
  ok
    ? '\n✓ All xref tables: every (source, key) resolves to one master.'
    : '\n✗ Ambiguity detected.',
);
await conn.run('CHECKPOINT'); // flush WAL → avoid cross-process replay bug
console.log('\nxref build complete.');
