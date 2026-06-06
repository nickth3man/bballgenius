/**
 * DQ Pipeline Orchestrator
 *
 * Runs the full data-quality pipeline in the correct dependency order.
 * Each stage is executed as a child process; results are logged to
 * `data/pipeline-run-log.jsonl` for traceability (avoids DuckDB file-lock
 * conflicts between the orchestrator and child processes on Windows).
 *
 *   bun run scripts/db/run-dq-pipeline.ts            # dry run (default)
 *   bun run scripts/db/run-dq-pipeline.ts --apply    # execute all stages
 *   bun run scripts/db/run-dq-pipeline.ts --dry-run  # explicit dry run
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB_PATH = process.env['NBA_DUCKDB_PATH'] ?? './data/nba.duckdb';
const LOG_PATH = resolve('data/pipeline-run-log.jsonl');
const cliArgs = new Set(process.argv.slice(2));
const apply = cliArgs.has('--apply');
const dryRun = cliArgs.has('--dry-run') || !apply;

interface Stage {
  name: string;
  script: string;
  critical: boolean;
  args?: string[];
}

interface StageResult {
  stage: Stage;
  exitCode: number;
  startedAt: Date;
  completedAt: Date;
  errorMessage?: string;
}

const STAGES: Stage[] = [
  { name: 'validate-staging-fk', script: 'scripts/db/validate-staging-fk.ts', critical: true },
  {
    name: 'backfill-dimension-placeholders',
    script: 'scripts/db/backfill-dimension-placeholders.ts',
    critical: false,
  },
  { name: 'build-xref', script: 'scripts/db/build-xref.ts', critical: true },
  {
    name: 'resolve-entities',
    script: 'scripts/db/resolve-entities.ts',
    critical: false,
    args: ['--source', 'espn'],
  },
  { name: 'verify-xref-coverage', script: 'scripts/db/verify-xref-coverage.ts', critical: true },
  { name: 'build-canonical-merge', script: 'scripts/db/build-canonical-merge.ts', critical: false },
  {
    name: 'build-canonical-merge-game',
    script: 'scripts/db/build-canonical-merge-game.ts',
    critical: false,
  },
  {
    name: 'build-canonical-merge-team',
    script: 'scripts/db/build-canonical-merge-team.ts',
    critical: false,
  },
  { name: 'verify-dq', script: 'scripts/db/verify-dq.ts', critical: true },
  { name: 'verify-cross-table', script: 'scripts/db/verify-cross-table.ts', critical: false },
  {
    name: 'verify-advanced-recompute',
    script: 'scripts/db/verify-advanced-recompute.ts',
    critical: false,
  },
  { name: 'verify-historical', script: 'scripts/db/verify-historical.ts', critical: false },
];

function runStage(stage: Stage): Promise<StageResult> {
  const startedAt = new Date();
  const stageArgs = ['run', stage.script, ...(apply ? ['--apply'] : []), ...(stage.args ?? [])];
  console.log(
    `\n${'─'.repeat(60)}\n[${dryRun ? 'DRY RUN' : 'APPLY'}] Stage: ${stage.name}${stage.critical ? ' (critical)' : ''}\n${'─'.repeat(60)}`,
  );
  return new Promise((resolve) => {
    const proc = spawn('bun', stageArgs, { stdio: 'inherit' });
    proc.on('close', (code: number | null) => {
      resolve({ stage, exitCode: code ?? 1, startedAt, completedAt: new Date() });
    });
    proc.on('error', (err: Error) => {
      resolve({
        stage,
        exitCode: 1,
        startedAt,
        completedAt: new Date(),
        errorMessage: err.message,
      });
    });
  });
}

function logResult(runId: string, result: StageResult) {
  const entry = {
    run_id: runId,
    stage_name: result.stage.name,
    status: result.exitCode === 0 ? 'success' : 'failed',
    exit_code: result.exitCode,
    started_at: result.startedAt.toISOString(),
    completed_at: result.completedAt.toISOString(),
    error_message: result.errorMessage ?? null,
  };
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`);
}

function printSummary(results: StageResult[], pipelineStart: Date, aborted: boolean) {
  const passed = results.filter((r) => r.exitCode === 0).length;
  const failed = results.filter((r) => r.exitCode !== 0).length;
  const skipped = STAGES.length - results.length;
  const criticalFailures = results.filter((r) => r.exitCode !== 0 && r.stage.critical);
  const elapsed = ((Date.now() - pipelineStart.getTime()) / 1000).toFixed(1);

  console.log(`\n${'═'.repeat(60)}`);
  console.log('PIPELINE SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Mode:             ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log(`Total runtime:    ${elapsed}s`);
  console.log(`Stages passed:    ${passed}`);
  console.log(`Stages failed:    ${failed}`);
  console.log(`Stages skipped:   ${skipped}`);
  if (aborted) {
    console.log('Status:           ABORTED (critical failure)');
  }
  if (criticalFailures.length > 0) {
    console.log('\nCritical failures:');
    for (const r of criticalFailures) {
      console.log(
        `  ✗ ${r.stage.name} (exit ${r.exitCode})${r.errorMessage ? `: ${r.errorMessage}` : ''}`,
      );
    }
  }
  console.log('═'.repeat(60));

  for (const r of results) {
    const icon = r.exitCode === 0 ? '✓' : '✗';
    const crit = r.stage.critical ? ' [critical]' : '';
    console.log(
      `  ${icon} ${r.stage.name}${crit} (${((r.completedAt.getTime() - r.startedAt.getTime()) / 1000).toFixed(1)}s)`,
    );
  }
}

async function main() {
  const pipelineStart = new Date();
  const runId = pipelineStart.toISOString();
  console.log(`DQ Pipeline starting at ${runId}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (use --apply to execute)' : 'APPLY'}`);
  console.log(`DB:   ${DB_PATH}`);
  console.log(`Stages: ${STAGES.length}`);

  const results: StageResult[] = [];
  let aborted = false;

  for (const stage of STAGES) {
    const result = await runStage(stage);
    results.push(result);

    if (!dryRun) {
      logResult(runId, result);
    }

    if (result.exitCode !== 0) {
      console.log(`\n✗ Stage '${stage.name}' failed (exit ${result.exitCode})`);
      if (stage.critical) {
        console.log('  CRITICAL failure — aborting pipeline.');
        aborted = true;
        break;
      }
      console.log('  Non-critical — continuing.');
    }
  }

  printSummary(results, pipelineStart, aborted);

  const hasCriticalFailure = results.some((r) => r.exitCode !== 0 && r.stage.critical);
  process.exit(hasCriticalFailure ? 1 : 0);
}

void main();
