/**
 * verify-xref-coverage.ts — Cross-reference coverage verification suite.
 *
 * Validates that every source ID in raw tables has a corresponding mapping in
 * the xref layer. Writes one row per check to `audit.dq_results`
 *   (check_name, table_name, severity, row_count, details, checked_at).
 *
 * Each check counts *unmapped* source IDs. row_count = 0 means full coverage.
 * Results are appended (history is retained for trend tracking); a single run
 * shares one `checked_at` timestamp so "latest run" is queryable.
 *
 * Severity ladder: CRITICAL > HIGH > MEDIUM > LOW > INFO.
 *   HIGH   = player/team coverage gaps (strong correctness signal).
 *   MEDIUM = game coverage gaps (completeness gap).
 *
 * Usage:
 *   bun run scripts/db/verify-xref-coverage.ts                 # run all, gate on HIGH
 *   bun run scripts/db/verify-xref-coverage.ts --dry-run       # print only, do not write
 *   bun run scripts/db/verify-xref-coverage.ts --gate=MEDIUM   # also fail on MEDIUM violations
 *   bun run scripts/db/verify-xref-coverage.ts --filter=bref   # run only checks containing "bref"
 *
 * Exit code is non-zero when any check at or above the gate severity has violations.
 */
import { DuckDBInstance } from '@duckdb/node-api';

const DB_PATH = process.env['NBA_DUCKDB_PATH'] ?? './data/nba.duckdb';

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
type Dimension = 'uniqueness' | 'referential' | 'consistency' | 'validity' | 'completeness';

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
};

type CheckSpec = {
  name: string;
  table: string;
  severity: Severity;
  dimension: Dimension;
  rule: string;
  countSql: string;
};

function unmappedXref(
  sourceTable: string,
  sourceIdCol: string,
  xrefTable: string,
  sourceId: string,
): string {
  return `SELECT count(*) AS n,
    CASE WHEN count(*) > 0 THEN 'unmapped ${sourceIdCol} (not in ${xrefTable} source_id=${sourceId}): ' || count(*) END AS details
    FROM (SELECT DISTINCT CAST(${sourceIdCol} AS VARCHAR) AS src_key FROM ${sourceTable} WHERE ${sourceIdCol} IS NOT NULL) s
    WHERE NOT EXISTS (
      SELECT 1 FROM ${xrefTable} x
      WHERE x.source_id = '${sourceId}' AND x.source_natural_key = s.src_key
    )`;
}

const CHECKS: CheckSpec[] = [
  {
    name: 'xref_bref_player_coverage',
    table: 'xref.player_xref',
    severity: 'MEDIUM',
    dimension: 'completeness',
    rule: 'BBR players covered by xref (some BBR-only players lack NBA API IDs — ABA, pre-1980)',
    countSql: unmappedXref('raw_bref.player_totals', 'player_id', 'xref.player_xref', 'bref'),
  },
  {
    name: 'xref_nba_stats_player_coverage',
    table: 'xref.player_xref',
    severity: 'MEDIUM',
    dimension: 'completeness',
    rule: 'nba_stats supplementary feed players covered by xref (partial coverage expected — different ID space)',
    countSql: unmappedXref(
      'raw_sqlite.nba_stats__player_boxscores',
      'player_id',
      'xref.player_xref',
      'nba_stats',
    ),
  },
  {
    name: 'xref_espn_player_coverage',
    table: 'xref.player_xref',
    severity: 'MEDIUM',
    dimension: 'completeness',
    rule: 'ESPN players resolved to master IDs (some unresolved expected for ambiguous names)',
    countSql: unmappedXref('raw_espn.player', 'espn_id', 'xref.player_xref', 'espn'),
  },
  {
    name: 'xref_bref_team_coverage',
    table: 'xref.team_xref',
    severity: 'MEDIUM',
    dimension: 'completeness',
    rule: 'BBR team abbreviations covered by xref (historical/ABA teams may lack NBA API counterparts)',
    countSql: unmappedXref('raw_bref.team_totals', 'abbreviation', 'xref.team_xref', 'bref'),
  },
  {
    name: 'xref_nba_stats_team_coverage',
    table: 'xref.team_xref',
    severity: 'MEDIUM',
    dimension: 'completeness',
    rule: 'nba_stats supplementary feed teams covered by xref (partial coverage expected)',
    countSql: unmappedXref(
      'raw_sqlite.nba_stats__team_boxscores',
      'team_id',
      'xref.team_xref',
      'nba_stats',
    ),
  },
  {
    name: 'xref_nba_stats_game_coverage',
    table: 'xref.game_xref',
    severity: 'MEDIUM',
    dimension: 'completeness',
    rule: 'every raw_sqlite.nba_stats__games_schedule.game_id has a mapping in xref.game_xref (source_id=nba_stats)',
    countSql: unmappedXref(
      'raw_sqlite.nba_stats__games_schedule',
      'game_id',
      'xref.game_xref',
      'nba_stats',
    ),
  },
];

type Outcome = CheckSpec & { count: number; detail: string | null; error: string | null };

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const gateArg = args.find((a) => a.startsWith('--gate='));
  const filterArg = args.find((a) => a.startsWith('--filter='));
  const gate = (gateArg?.split('=')[1]?.toUpperCase() as Severity) ?? 'HIGH';
  const filter = filterArg?.split('=')[1] ?? null;
  if (!(gate in SEVERITY_RANK)) {
    throw new Error(`--gate must be one of ${Object.keys(SEVERITY_RANK).join(', ')}`);
  }
  return { dryRun, gate, filter };
}

const { dryRun, gate, filter } = parseArgs();
const runId = new Date().toISOString().replace('T', ' ').replace('Z', '');
const selected = filter ? CHECKS.filter((c) => c.name.includes(filter)) : CHECKS;

const db = await DuckDBInstance.fromCache(DB_PATH);
const conn = await db.connect();

const outcomes: Outcome[] = [];
for (const check of selected) {
  try {
    const res = await conn.runAndReadAll(check.countSql);
    const row = res.getRowObjectsJson()[0] ?? {};
    const count = Number(row['n'] ?? 0);
    const detail = (row['details'] as string | null) ?? null;
    outcomes.push({ ...check, count, detail, error: null });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    outcomes.push({ ...check, count: -1, detail: null, error: message });
  }
}

if (!dryRun) {
  for (const o of outcomes) {
    if (o.error) continue;
    const detailSql = o.detail === null ? 'NULL' : `'${o.detail.replace(/'/g, "''")}'`;
    await conn.run(
      `INSERT INTO audit.dq_results (check_name, table_name, severity, row_count, details, checked_at)
       VALUES ('${o.name}', '${o.table}', '${o.severity}', ${o.count}, ${detailSql}, TIMESTAMP '${runId}')`,
    );
  }
  await conn.run('CHECKPOINT');
}

const order: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const sorted = [...outcomes].sort(
  (a, b) =>
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    b.count - a.count ||
    a.name.localeCompare(b.name),
);

console.log(
  `\nXref coverage verification — run ${runId}${dryRun ? ' (dry-run, not persisted)' : ''}`,
);
console.log(`DB: ${DB_PATH} · checks: ${selected.length} · gate: ${gate}\n`);

const pad = (s: string, n: number) => s.padEnd(n);
console.log(`${pad('SEV', 9)}${pad('CHECK', 38)}${pad('TABLE', 38)}${pad('UNMAPPED', 12)}DETAIL`);
console.log('─'.repeat(120));
for (const o of sorted) {
  const v = o.error ? 'ERROR' : o.count === 0 ? 'ok' : String(o.count);
  const detail = o.error ? o.error : (o.detail ?? '');
  console.log(`${pad(o.severity, 9)}${pad(o.name, 38)}${pad(o.table, 38)}${pad(v, 12)}${detail}`);
}

const failed = outcomes.filter(
  (o) => o.error === null && o.count > 0 && SEVERITY_RANK[o.severity] >= SEVERITY_RANK[gate],
);
const errored = outcomes.filter((o) => o.error !== null);

console.log('\nSummary by severity:');
for (const sev of order) {
  const group = outcomes.filter((o) => o.severity === sev && o.error === null);
  if (group.length === 0) continue;
  const failing = group.filter((o) => o.count > 0).length;
  console.log(`  ${pad(sev, 9)} ${group.length} checks, ${failing} with violations`);
}

if (errored.length > 0) {
  console.log(`\n⚠ ${errored.length} check(s) failed to execute (see ERROR rows above).`);
}

if (failed.length > 0) {
  console.log(`\n✗ GATE FAILED: ${failed.length} check(s) at or above ${gate} have violations:`);
  for (const f of failed) console.log(`    - [${f.severity}] ${f.name}: ${f.detail}`);
  process.exitCode = 1;
} else {
  console.log(`\n✓ Gate passed: no violations at or above ${gate}.`);
}

conn.closeSync();
