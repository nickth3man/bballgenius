/**
 * dq-core.ts — Shared primitives for the data-quality check suites.
 *
 * Extracted from verify-dq.ts so the internal-consistency registry, the
 * cross-table reconciliation suite (verify-cross-table.ts), the advanced-stat
 * recompute (verify-advanced-recompute.ts) and the historical boundary scan
 * (verify-historical.ts) all share one check shape, one runner, one persistence
 * path (audit.dq_results) and one severity gate.
 *
 * Each check counts *violating* rows. row_count = 0 means the check passed.
 * Results are appended to audit.dq_results (history retained for trend tracking);
 * a single run shares one `checked_at` timestamp so "latest run" is queryable.
 *
 * Severity ladder: CRITICAL > HIGH > MEDIUM > LOW > INFO.
 *   CRITICAL = physically impossible / breaks the grain (must be zero).
 *   HIGH     = strong correctness signal, almost always a genuine defect.
 *   MEDIUM   = likely defect or completeness gap; triage + justify residual.
 *   LOW/INFO = cosmetic / informational.
 */
import type { DuckDBConnection } from '@duckdb/node-api';

export const DB_PATH = process.env['NBA_DUCKDB_PATH'] ?? './data/nba.duckdb';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type Dimension =
  | 'uniqueness'
  | 'referential'
  | 'consistency'
  | 'validity'
  | 'completeness'
  | 'accuracy';

export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
};

export const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

export type CheckSpec = {
  /** Stable identifier stored in audit.dq_results.check_name. */
  name: string;
  /** Fully-qualified table the check is about (stored as table_name). */
  table: string;
  severity: Severity;
  dimension: Dimension;
  /** Human-readable statement of the rule that must hold. */
  rule: string;
  /**
   * SQL returning exactly one row with columns:
   *   n       BIGINT   — count of violating rows
   *   details VARCHAR  — short explanation (NULL when n = 0)
   */
  countSql: string;
};

export type Outcome = CheckSpec & { count: number; detail: string | null; error: string | null };

// ── Reusable check builders ────────────────────────────────────────────────

/** Count rows where `predicate` holds (NULLs in the predicate are not counted). */
export function violations(table: string, predicate: string, label: string): string {
  return `SELECT count(*) AS n,
    CASE WHEN count(*) > 0 THEN '${label}: ' || count(*) || ' rows' END AS details
    FROM ${table} WHERE ${predicate}`;
}

/** Count duplicate grain groups for the given key columns. */
export function duplicateGrain(table: string, keys: string[]): string {
  const k = keys.join(', ');
  return `SELECT count(*) AS n,
    CASE WHEN count(*) > 0 THEN 'duplicate (${k}) groups: ' || count(*) END AS details
    FROM (SELECT ${k} FROM ${table} GROUP BY ${k} HAVING count(*) > 1)`;
}

/** Count child rows whose non-null FK has no matching parent PK (orphans). */
export function orphans(
  child: string,
  fk: string,
  parent: string,
  pk: string,
  distinct = false,
): string {
  const src = distinct ? `(SELECT DISTINCT ${fk} FROM ${child}) c` : `${child} c`;
  return `SELECT count(*) AS n,
    CASE WHEN count(*) > 0 THEN 'orphan ${fk} (not in ${parent}): ' || count(*) END AS details
    FROM ${src}
    WHERE c.${fk} IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ${parent} p WHERE p.${pk} = c.${fk})`;
}

/** Count rows missing any required grain/key column. */
export function requiredColumns(table: string, columns: string[], label: string): string {
  const predicate = columns.map((col) => `${col} IS NULL`).join(' OR ');
  return violations(table, predicate, label);
}

// ── Argument parsing ───────────────────────────────────────────────────────

export type StandardArgs = { dryRun: boolean; gate: Severity; filter: string | null };

export function parseStandardArgs(argv: string[]): StandardArgs {
  const args = argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const gateArg = args.find((a) => a.startsWith('--gate='));
  const filterArg = args.find((a) => a.startsWith('--filter='));
  const gate = (gateArg?.split('=')[1]?.toUpperCase() as Severity) ?? 'CRITICAL';
  const filter = filterArg?.split('=')[1] ?? null;
  if (!(gate in SEVERITY_RANK)) {
    throw new Error(`--gate must be one of ${Object.keys(SEVERITY_RANK).join(', ')}`);
  }
  return { dryRun, gate, filter };
}

/** Timestamp shared by every row written in a single run. */
export function newRunId(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

// ── Execution ──────────────────────────────────────────────────────────────

/** Execute each check's countSql and collect outcomes (errors captured, not thrown). */
export async function runCountChecks(
  conn: DuckDBConnection,
  checks: CheckSpec[],
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const check of checks) {
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
  return outcomes;
}

/**
 * Append one row per (non-errored) outcome to audit.dq_results and flush the WAL.
 * Checks that failed to execute are skipped (their ERROR shows only in the report).
 */
export async function persistResults(
  conn: DuckDBConnection,
  outcomes: Outcome[],
  runId: string,
): Promise<void> {
  await conn.run('CREATE SCHEMA IF NOT EXISTS audit');
  for (const o of outcomes) {
    if (o.error) continue;
    const detailSql = o.detail === null ? 'NULL' : `'${o.detail.replace(/'/g, "''")}'`;
    await conn.run(
      `INSERT INTO audit.dq_results (check_name, table_name, severity, row_count, details, checked_at)
       VALUES ('${o.name}', '${o.table}', '${o.severity}', ${o.count}, ${detailSql}, TIMESTAMP '${runId}')`,
    );
  }
  await conn.run('CHECKPOINT'); // flush WAL → avoid cross-process replay bug
}

// ── Reporting & gating ──────────────────────────────────────────────────────

const pad = (s: string, n: number) => s.padEnd(n);

export type ReportOptions = {
  title: string;
  runId: string;
  dryRun: boolean;
  gate: Severity;
  checkCount: number;
};

export function printReport(outcomes: Outcome[], opts: ReportOptions): void {
  const sorted = [...outcomes].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.count - a.count ||
      a.name.localeCompare(b.name),
  );

  console.log(
    `\n${opts.title} — run ${opts.runId}${opts.dryRun ? ' (dry-run, not persisted)' : ''}`,
  );
  console.log(`DB: ${DB_PATH} · checks: ${opts.checkCount} · gate: ${opts.gate}\n`);
  console.log(
    `${pad('SEV', 9)}${pad('CHECK', 40)}${pad('TABLE', 40)}${pad('VIOLATIONS', 12)}DETAIL`,
  );
  console.log('─'.repeat(120));
  for (const o of sorted) {
    const v = o.error ? 'ERROR' : o.count === 0 ? 'ok' : String(o.count);
    const detail = o.error ? o.error : (o.detail ?? '');
    console.log(
      `${pad(o.severity, 9)}${pad(o.name, 40)}${pad(o.table.replace('nbadb.', ''), 40)}${pad(v, 12)}${detail}`,
    );
  }

  console.log('\nSummary by severity:');
  for (const sev of SEVERITY_ORDER) {
    const group = outcomes.filter((o) => o.severity === sev && o.error === null);
    if (group.length === 0) continue;
    const failing = group.filter((o) => o.count > 0).length;
    console.log(`  ${pad(sev, 9)} ${group.length} checks, ${failing} with violations`);
  }

  const errored = outcomes.filter((o) => o.error !== null);
  if (errored.length > 0) {
    console.log(`\n⚠ ${errored.length} check(s) failed to execute (see ERROR rows above).`);
  }
}

/** Outcomes at or above the gate severity that have violations. */
export function gateFailures(outcomes: Outcome[], gate: Severity): Outcome[] {
  return outcomes.filter(
    (o) => o.error === null && o.count > 0 && SEVERITY_RANK[o.severity] >= SEVERITY_RANK[gate],
  );
}

/** Print the gate verdict and set process.exitCode accordingly. */
export function applyGate(outcomes: Outcome[], gate: Severity): void {
  const failed = gateFailures(outcomes, gate);
  if (failed.length > 0) {
    console.log(`\n✗ GATE FAILED: ${failed.length} check(s) at or above ${gate} have violations:`);
    for (const f of failed) console.log(`    - [${f.severity}] ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  } else {
    console.log(`\n✓ Gate passed: no violations at or above ${gate}.`);
  }
}
