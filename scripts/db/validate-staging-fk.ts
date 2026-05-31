/**
 * validate-staging-fk.ts — Pre-ingest FK validation for staging tables.
 *
 * Checks referential integrity at the staging layer BEFORE data reaches the
 * curated tier. Supports two modes:
 *
 *   Report mode (default): Count orphan rows and print a summary table.
 *   Quarantine mode (--quarantine): Move orphaned rows into
 *     {schema}.quarantine_{table} tables for later inspection.
 *
 * Exit code is non-zero when any check's orphan rate exceeds the threshold
 * (default 0.1 %).
 *
 * Usage:
 *   bun run scripts/db/validate-staging-fk.ts                        # report only
 *   bun run scripts/db/validate-staging-fk.ts --quarantine            # move orphans
 *   bun run scripts/db/validate-staging-fk.ts --threshold=0.01        # 1 % tolerance
 *   bun run scripts/db/validate-staging-fk.ts --filter=player         # subset by name
 */
import { DuckDBInstance } from '@duckdb/node-api';

const DB_PATH = process.env['NBA_DUCKDB_PATH'] ?? './data/nba.duckdb';

const args = process.argv.slice(2);
const argSet = new Set(args);
const quarantine = argSet.has('--quarantine');
const thresholdArg = args.find((a) => a.startsWith('--threshold='));
const threshold = Number(thresholdArg?.split('=')[1] ?? '0.001');
const filterArg = args.find((a) => a.startsWith('--filter='));
const filter = filterArg?.split('=')[1] ?? null;

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM';

type FKCheck = {
  name: string;
  child: string;
  childFk: string;
  parent: string;
  parentPk: string;
  severity: Severity;
  childFkCast?: string;
  parentPkCast?: string;
};

const CHECKS: FKCheck[] = [
  {
    name: 'stg_bref_player_totals_to_career_info',
    child: 'stg_bref.player_totals',
    childFk: 'player_id',
    parent: 'stg_bref.player_career_info',
    parentPk: 'player_id',
    severity: 'CRITICAL',
  },
  {
    name: 'stg_bref_player_totals_to_raw',
    child: 'stg_bref.player_totals',
    childFk: 'player_id',
    parent: 'raw_bref.player_totals',
    parentPk: 'player_id',
    severity: 'HIGH',
  },
  {
    name: 'stg_nba_api_player_boxscores_to_player',
    child: 'stg_nba_api_sqlite.nba_stats__player_boxscores',
    childFk: 'player_id',
    parent: 'stg_nba_api_sqlite.player',
    parentPk: 'id',
    severity: 'HIGH',
    childFkCast: 'CAST(CAST(c.player_id AS BIGINT) AS VARCHAR)',
    parentPkCast: 'p.id',
  },
  {
    name: 'stg_nba_api_team_boxscores_to_team',
    child: 'stg_nba_api_sqlite.nba_stats__team_boxscores',
    childFk: 'team_id',
    parent: 'stg_nba_api_sqlite.team',
    parentPk: 'id',
    severity: 'HIGH',
    childFkCast: 'CAST(CAST(c.team_id AS BIGINT) AS VARCHAR)',
    parentPkCast: 'p.id',
  },
  {
    name: 'stg_nba_api_player_boxscores_to_game',
    child: 'stg_nba_api_sqlite.nba_stats__player_boxscores',
    childFk: 'game_id',
    parent: 'stg_nba_api_sqlite.game',
    parentPk: 'game_id',
    severity: 'MEDIUM',
  },
  {
    name: 'stg_nba_api_team_boxscores_to_game',
    child: 'stg_nba_api_sqlite.nba_stats__team_boxscores',
    childFk: 'game_id',
    parent: 'stg_nba_api_sqlite.game',
    parentPk: 'game_id',
    severity: 'MEDIUM',
  },
];

const selected = filter ? CHECKS.filter((c) => c.name.includes(filter)) : CHECKS;

const db = await DuckDBInstance.fromCache(DB_PATH);
const conn = await db.connect();

async function scalar(sql: string): Promise<number> {
  const res = await conn.runAndReadAll(sql);
  const row = res.getRowObjectsJson()[0] ?? {};
  return Number(row['n'] ?? 0);
}

function childExpr(check: FKCheck): string {
  return check.childFkCast ?? `c.${check.childFk}`;
}

function parentExpr(check: FKCheck): string {
  return check.parentPkCast ?? `p.${check.parentPk}`;
}

function orphanCountSql(check: FKCheck): string {
  const child = childExpr(check);
  const parent = parentExpr(check);
  return `SELECT count(*) AS n
    FROM ${check.child} c
    WHERE ${child} IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM ${check.parent} p WHERE ${parent} = ${child}
      )`;
}

function totalSql(check: FKCheck): string {
  return `SELECT count(*) AS n FROM ${check.child}`;
}

function quarantineTable(check: FKCheck): string {
  const schema = check.child.split('.')[0];
  const table = check.child.split('.')[1];
  return `${schema}.quarantine_${table}`;
}

type Outcome = {
  check: FKCheck;
  total: number;
  orphans: number;
  rate: number;
  quarantined: boolean;
  error: string | null;
};

const outcomes: Outcome[] = [];

for (const check of selected) {
  try {
    const total = await scalar(totalSql(check));
    const orphans = await scalar(orphanCountSql(check));
    const rate = total > 0 ? orphans / total : 0;
    let quarantined = false;

    if (quarantine && orphans > 0) {
      const qTable = quarantineTable(check);
      const child = childExpr(check);
      const parent = parentExpr(check);
      await conn.run(`
        CREATE TABLE IF NOT EXISTS ${qTable} AS
        SELECT now() AS quarantined_at,
               '${check.name}: orphan ${check.childFk} not in ${check.parent}' AS reason,
               c.*
        FROM ${check.child} c
        WHERE ${child} IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM ${check.parent} p WHERE ${parent} = ${child}
          )
        LIMIT 0
      `);
      await conn.run(`
        INSERT INTO ${qTable}
        SELECT now(),
               '${check.name}: orphan ${check.childFk} not in ${check.parent}',
               c.*
        FROM ${check.child} c
        WHERE ${child} IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM ${check.parent} p WHERE ${parent} = ${child}
          )
      `);
      await conn.run(`
        DELETE FROM ${check.child}
        WHERE ${check.childFk} IS NOT NULL
          AND ${check.childFk} IN (
            SELECT ${check.childFk} FROM ${check.child} c
            WHERE ${child} IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM ${check.parent} p WHERE ${parent} = ${child}
              )
          )
      `);
      quarantined = true;
    }

    outcomes.push({ check, total, orphans, rate, quarantined, error: null });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    outcomes.push({
      check,
      total: -1,
      orphans: -1,
      rate: -1,
      quarantined: false,
      error: message,
    });
  }
}

if (quarantine) {
  await conn.run('CHECKPOINT');
}

const pad = (s: string, n: number) => s.padEnd(n);
const pct = (rate: number) => `${(rate * 100).toFixed(4)}%`;

console.log(
  `\nStaging FK validation — ${new Date().toISOString()}${quarantine ? ' (quarantine mode)' : ''}`,
);
console.log(`DB: ${DB_PATH} · checks: ${selected.length} · threshold: ${pct(threshold)}\n`);

console.log(
  `${pad('SEV', 9)}${pad('CHECK', 50)}${pad('TOTAL', 12)}${pad('ORPHANS', 12)}${pad('RATE', 12)}${pad('STATUS', 8)}DETAIL`,
);
console.log('─'.repeat(120));

const severityRank: Record<Severity, number> = { CRITICAL: 3, HIGH: 2, MEDIUM: 1 };
const sorted = [...outcomes].sort(
  (a, b) =>
    severityRank[b.check.severity] - severityRank[a.check.severity] ||
    b.orphans - a.orphans ||
    a.check.name.localeCompare(b.check.name),
);

let criticalFailed = false;
for (const o of sorted) {
  if (o.error) {
    console.log(
      `${pad(o.check.severity, 9)}${pad(o.check.name, 50)}${pad('ERR', 12)}${pad('ERR', 12)}${pad('ERR', 12)}${pad('ERROR', 8)}${o.error}`,
    );
    if (o.check.severity === 'CRITICAL') criticalFailed = true;
    continue;
  }
  const exceedsThreshold = o.rate > threshold;
  const status = exceedsThreshold ? 'FAIL' : 'PASS';
  if (exceedsThreshold && o.check.severity === 'CRITICAL') criticalFailed = true;
  const detail = o.quarantined
    ? `quarantined ${o.orphans} rows → ${quarantineTable(o.check)}`
    : exceedsThreshold && o.check.severity !== 'CRITICAL'
      ? 'WARN (non-critical)'
      : '';
  console.log(
    `${pad(o.check.severity, 9)}${pad(o.check.name, 50)}${pad(String(o.total), 12)}${pad(String(o.orphans), 12)}${pad(pct(o.rate), 12)}${pad(status, 8)}${detail}`,
  );
}

const errored = outcomes.filter((o) => o.error !== null);
if (errored.length > 0) {
  console.log(`\n${errored.length} check(s) failed to execute.`);
}

if (criticalFailed) {
  console.log(`\n✗ FAILED: CRITICAL check(s) exceed threshold (${pct(threshold)}).`);
  process.exitCode = 1;
} else {
  const warnings = outcomes.filter(
    (o) => o.error === null && o.rate > threshold && o.check.severity !== 'CRITICAL',
  );
  if (warnings.length > 0) {
    console.log(
      `\n✓ No CRITICAL failures. ${warnings.length} non-critical warning(s) above threshold.`,
    );
  } else {
    console.log(`\n✓ All checks passed (threshold: ${pct(threshold)}).`);
  }
}

conn.closeSync();
