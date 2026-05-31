/**
 * verify-accuracy.ts — NBA fact-check verification suite.
 *
 * Usage:
 *   bun run scripts/db/verify-accuracy.ts                # run all checks
 *   bun run scripts/db/verify-accuracy.ts --filter=career # subset by category
 *   bun run scripts/db/verify-accuracy.ts --verbose       # show SQL snippets
 */
import { DuckDBInstance } from '@duckdb/node-api';

import { compareActual, formatExpected, loadAccuracyChecks, type Outcome } from './accuracy.js';

const DB_PATH = process.env['NBA_DUCKDB_PATH'] ?? './data/nba.duckdb';
const CHECKS_PATH = new URL('./accuracy-checks.json', import.meta.url);

const args = process.argv.slice(2);
const filterArg = args.find((a) => a.startsWith('--filter='));
const filter = filterArg?.split('=')[1] ?? null;
const verbose = args.includes('--verbose');

const checks = await loadAccuracyChecks(CHECKS_PATH);
const selected = filter ? checks.filter((check) => check.category.includes(filter)) : checks;

const db = await DuckDBInstance.fromCache(DB_PATH);
const conn = await db.connect();

const outcomes: Outcome[] = [];

for (const check of selected) {
  try {
    const res = await conn.runAndReadAll(check.sql);
    const row = res.getRowObjectsJson()[0] ?? {};
    const actual = row['val'] != null ? Number(row['val']) : null;

    outcomes.push({ ...check, actual, passed: compareActual(check, actual), error: null });

    if (verbose) {
      console.log(`  SQL: ${check.sql.replace(/\n/g, ' ').slice(0, 120)}...`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    outcomes.push({ ...check, actual: null, passed: false, error: message });
  }
}

conn.closeSync();

const passed = outcomes.filter((outcome) => outcome.passed).length;
const failed = outcomes.filter((outcome) => !outcome.passed && !outcome.error).length;
const errored = outcomes.filter((outcome) => outcome.error !== null).length;

console.log(`\nNBA Accuracy Verification — ${new Date().toISOString()}`);
console.log(`DB: ${DB_PATH} · checks: ${selected.length}\n`);

printTable(outcomes);

console.log(`\n${'═'.repeat(80)}`);
console.log(
  `RESULTS: ${passed} passed, ${failed} failed, ${errored} errors out of ${selected.length} checks`,
);
console.log('═'.repeat(80));

if (failed > 0) {
  console.log('\nFailed checks:');
  for (const outcome of outcomes.filter((outcome) => !outcome.passed && !outcome.error)) {
    console.log(`  ✗ ${outcome.name}: ${outcome.description}`);
    console.log(`    Expected: ${outcome.expected} (${outcome.mode}), Got: ${outcome.actual}`);
    console.log(`    Source: ${outcome.source}`);
  }
}

if (errored > 0) {
  console.log('\nErrored checks:');
  for (const outcome of outcomes.filter((outcome) => outcome.error)) {
    console.log(`  ✗ ${outcome.name}: ${outcome.error?.slice(0, 100)}`);
  }
}

process.exitCode = failed + errored > 0 ? 1 : 0;

function printTable(outcomes: Outcome[]) {
  const pad = (value: string, width: number) => value.padEnd(width);

  console.log(
    `${pad('STATUS', 8)}${pad('CATEGORY', 16)}${pad('CHECK', 40)}${pad('EXPECTED', 14)}${pad('ACTUAL', 14)}DETAIL`,
  );
  console.log('─'.repeat(130));

  for (const outcome of outcomes) {
    const status = outcome.error ? 'ERROR' : outcome.passed ? 'PASS' : 'FAIL';
    const actual = outcome.actual !== null ? String(outcome.actual) : 'NULL';
    const detail = outcome.error
      ? outcome.error.slice(0, 60)
      : outcome.passed
        ? outcome.source
        : `expected ${formatExpected(outcome)}, got ${actual}`;

    console.log(
      `${pad(status, 8)}${pad(outcome.category, 16)}${pad(outcome.description.slice(0, 38), 40)}${pad(formatExpected(outcome), 14)}${pad(actual, 14)}${detail}`,
    );
  }
}
