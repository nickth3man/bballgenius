#!/usr/bin/env bun

/**
 * Matrix-driven NBA chatbot eval harness with three-way truth classification.
 *
 * Source of truth = basketball-reference.com (NBA-only), captured in
 * eval/bbr-truth.json. For every question the harness compares:
 *
 *     agent answer   vs   DB value (eval/dbTruth)   vs   BBR value (eval/bbrTruth)
 *
 * Verdicts:
 *   - pass                  agent matches BBR, and the DB also matches BBR
 *   - data_quality          a verified BBR value disagrees with the DB (the DB is
 *                           wrong; the agent cannot be right-vs-BBR using it)
 *   - agent_bug             DB matches BBR but the agent's answer does not
 *   - stale_test_expected   the matrix's own expectedAnswer disagrees with BBR
 *                           (the test is wrong, not the agent) — surfaced, not failed
 *   - bbr_unverified        no verified BBR anchor; falls back to agent-vs-DB only
 *   - no_clarification / data_not_available  behavioural checks for vague/over-specific tiers
 *
 * Unlike the legacy iterate_loop.ts this judges values (not just "does the player's
 * name appear"), folds diacritics, honours per-question numeric tolerance, and never
 * trusts the legacy ground-truth.json.
 *
 * Usage:   bun run src/chatbot/eval/matrixHarness.ts
 * Env:     RUNS_PER_QUESTION=1  RUN_TIMEOUT_MS=90000  LOG_DIR=.runs/nba-chatbot
 *          MAX_TOOL_CALLS=12    EXIT_NONZERO_ON_FAIL=1
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { resetGraph } from '../agent/graph.js';
import { streamQuery } from '../agent/streaming.js';
import { closeDb, initDb } from '../db.js';
import { getModel } from '../openrouter.js';
import { buildSystemPrompt } from '../systemPrompt.js';
import { resolveBbrValue } from './bbrTruth.js';
import { resolveDbValue } from './dbTruth.js';
import { type EvalQuestion, QUESTION_MATRIX } from './question-matrix.js';

const RUNS_PER_QUESTION = envInt('RUNS_PER_QUESTION', 1);
const QUESTION_LIMIT = envInt('QUESTION_LIMIT', 9999);
const RUN_TIMEOUT_MS = envInt('RUN_TIMEOUT_MS', 90_000);
const MAX_TOOL_CALLS = envInt('MAX_TOOL_CALLS', 12);
const EXIT_NONZERO_ON_FAIL = envBool('EXIT_NONZERO_ON_FAIL', true);
const LOG_ROOT = process.env['LOG_DIR'] || '.runs/nba-chatbot';

type Verdict =
  | 'pass'
  | 'data_quality'
  | 'agent_bug'
  | 'no_clarification'
  | 'data_not_available'
  | 'wrong_data_not_available'
  | 'timeout'
  | 'crash';

interface IdComparison {
  id: string;
  bbr: string | number | null;
  bbrVerified: boolean;
  db: string | number | null;
  dbSupported: boolean;
  dbMatchesBbr: boolean | null; // null when not comparable
}

interface RunResult {
  questionId: string;
  tier: string;
  question: string;
  matrixExpected: string;
  bbrExpected: string | null;
  agentAnswer: string;
  verdict: Verdict;
  passed: boolean;
  reason: string;
  staleTestExpected: boolean;
  bbrUnverified: boolean;
  comparisons: IdComparison[];
  toolCalls: number;
  stopReason: string;
  latencyMs: number;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return /^(1|true|yes|y)$/i.test(v);
}

/** Lowercase + strip diacritics (Dončić -> doncic) + collapse whitespace. */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function containsToken(haystack: string, needle: string): boolean {
  const h = norm(haystack);
  const n = norm(String(needle));
  if (n.length === 0) return false;
  if (h.includes(n)) return true;
  // Numeric token: compare with digit separators (commas) folded out, e.g. "43,440" ~ "43440".
  if (/^\d[\d,]*$/.test(n)) {
    const digits = (s: string) => s.replace(/(?<=\d)[,](?=\d)/g, '');
    return digits(h).includes(digits(n));
  }
  return false;
}

/** Parse a tolerance string like "±0.1" / "±1" / "exact" into an absolute epsilon. */
function toleranceEpsilon(tol?: string): number {
  if (!tol || tol === 'exact') return 0;
  const m = tol.match(/([0-9.]+)/);
  return m ? Number(m[1]) : 0;
}

function numbersMatch(a: number, b: number, tol?: string): boolean {
  return Math.abs(a - b) <= toleranceEpsilon(tol) + 1e-9;
}

/** Compare two truth values (string or number), folding diacritics and honouring tolerance. */
function valuesMatch(x: string | number | null, y: string | number | null, tol?: string): boolean {
  if (x == null || y == null) return false;
  if (typeof x === 'number' && typeof y === 'number') return numbersMatch(x, y, tol);
  const xs = String(x);
  const ys = String(y);
  return norm(xs) === norm(ys) || norm(xs).includes(norm(ys)) || norm(ys).includes(norm(xs));
}

const TEST_MODE_SUFFIX = `
You are running in deterministic test mode.
- Emit exactly one final answer that directly answers the question.
- Prefer database-grounded answers; do not add external facts or caveats unless asked.
- For ambiguous questions, ask ONE concise clarification question instead of guessing.
- If the requested data is not in the database after checking, say "I do not have that information in the database."
- Always distinguish regular season from playoffs; assume regular season for unqualified "career" stats.
`.trim();

interface StreamEvent {
  type: string;
  [k: string]: unknown;
}

async function runAgent(
  q: EvalQuestion,
  prompt: string,
  threadId: string,
): Promise<{ answer: string; toolCalls: number; stopReason: string; latencyMs: number }> {
  const started = Date.now();
  const deadline = started + RUN_TIMEOUT_MS;
  let answer = '';
  let streamed = '';
  let toolCalls = 0;
  let stopReason = 'unknown';

  resetGraph();
  const gen = streamQuery([new SystemMessage(prompt), new HumanMessage(q.question)], threadId);
  const it = gen[Symbol.asyncIterator]();

  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const next = await Promise.race([
        it.next(),
        new Promise<IteratorResult<StreamEvent>>((_, rej) =>
          setTimeout(() => rej(new Error('RUN_TIMEOUT')), remaining),
        ),
      ]);
      if (next.done) {
        stopReason = stopReason === 'unknown' ? 'stream_done' : stopReason;
        break;
      }
      const ev = next.value;
      if (ev.type === 'token') streamed += String(ev.content ?? '');
      else if (ev.type === 'tool_start') toolCalls++;
      else if (ev.type === 'done') {
        const msgs = ev.messages as Array<{ content?: unknown }> | undefined;
        if (Array.isArray(msgs)) {
          for (let i = msgs.length - 1; i >= 0; i--) {
            const c = msgs[i]?.content;
            if (typeof c === 'string' && c.trim()) {
              answer = c.trim();
              break;
            }
          }
        }
        stopReason = 'done';
      } else if (ev.type === 'error') {
        throw new Error(String(ev.message ?? 'stream error'));
      }
      if (toolCalls >= MAX_TOOL_CALLS) {
        stopReason = 'max_tool_calls';
        break;
      }
    }
    await it.return?.();
  } catch (e) {
    stopReason = /TIMEOUT/i.test(String(e)) ? 'timeout' : 'error';
  }

  if (!answer) answer = streamed.trim();
  return { answer, toolCalls, stopReason, latencyMs: Date.now() - started };
}

function classify(q: EvalQuestion, agentAnswer: string, stopReason: string): RunResult {
  const base: Omit<RunResult, 'verdict' | 'passed' | 'reason'> = {
    questionId: q.id,
    tier: q.tier,
    question: q.question,
    matrixExpected: Array.isArray(q.expectedAnswer)
      ? q.expectedAnswer.join(' | ')
      : String(q.expectedAnswer),
    bbrExpected: null,
    agentAnswer,
    staleTestExpected: false,
    bbrUnverified: false,
    comparisons: [],
    toolCalls: 0,
    stopReason,
    latencyMs: 0,
  };

  if (stopReason === 'timeout')
    return { ...base, verdict: 'timeout', passed: false, reason: 'Run timed out.' };
  if (stopReason === 'error')
    return { ...base, verdict: 'crash', passed: false, reason: 'Agent stream errored.' };

  // --- Vague tier: expect a clarifying question ---
  if (q.expectedClarification) {
    const ok =
      /\?/.test(agentAnswer) &&
      /(clarif|which|what|specify|do you mean|regular season|playoffs|category|stat)/i.test(
        agentAnswer,
      );
    return {
      ...base,
      verdict: ok ? 'pass' : 'no_clarification',
      passed: ok,
      reason: ok ? 'Asked for clarification.' : 'Expected a clarification question.',
    };
  }

  // --- Overly-specific tier: expect "not available" ---
  if (q.expectedAnswer === 'DATA_NOT_AVAILABLE') {
    const ok =
      /(not available|do not have|don't have|not in (the )?database|no data|cannot find|could not find|does not (have|contain))/i.test(
        agentAnswer,
      );
    return {
      ...base,
      verdict: ok ? 'pass' : 'wrong_data_not_available',
      passed: ok,
      reason: ok
        ? 'Correctly reported data unavailable.'
        : 'Expected an "unavailable data" response.',
    };
  }

  // --- Factual / derived: BBR side now; caller attaches DB then calls finalizeFactual ---
  const comparisons: IdComparison[] = [];
  let allUnverified = q.groundTruthIds.length > 0;

  for (const id of q.groundTruthIds) {
    const bbr = resolveBbrValue(id);
    comparisons.push({
      id,
      bbr: bbr.value,
      bbrVerified: bbr.verified,
      db: null,
      dbSupported: false,
      dbMatchesBbr: null,
    });
    if (bbr.verified) allUnverified = false;
  }

  const firstVerified = comparisons.find((c) => c.bbrVerified && c.bbr != null);
  return {
    ...base,
    bbrExpected: firstVerified?.bbr != null ? String(firstVerified.bbr) : null,
    comparisons,
    bbrUnverified: allUnverified,
    verdict: 'pass',
    passed: false,
    reason: 'pending-db',
  };
}

/** Finalize a factual verdict once DB comparisons are attached. */
function finalizeFactual(result: RunResult, q: EvalQuestion): RunResult {
  if (result.reason !== 'pending-db') return result; // already terminal (vague / specific / timeout)

  const agent = result.agentAnswer;
  let anyVerifiedMismatch = false;
  let comparedAny = false;

  for (const c of result.comparisons) {
    if (c.bbrVerified && c.dbSupported) {
      comparedAny = true;
      c.dbMatchesBbr = valuesMatch(c.db, c.bbr);
      if (!c.dbMatchesBbr) anyVerifiedMismatch = true;
    }
  }

  // 1) DB disagrees with BBR on a verified fact -> data quality issue.
  if (anyVerifiedMismatch) {
    const bad = result.comparisons.filter((c) => c.dbMatchesBbr === false);
    return {
      ...result,
      verdict: 'data_quality',
      passed: false,
      reason: `DB disagrees with basketball-reference: ${bad
        .map((c) => `${c.id} DB=${JSON.stringify(c.db)} BBR=${JSON.stringify(c.bbr)}`)
        .join('; ')}`,
    };
  }

  // 2) No verified BBR anchor -> can only audit agent vs DB.
  if (!comparedAny) {
    const expectedTokens = Array.isArray(q.expectedAnswer) ? q.expectedAnswer : [q.expectedAnswer];
    const ok = expectedTokens.every((t) => containsToken(agent, String(t)));
    return {
      ...result,
      bbrUnverified: true,
      verdict: ok ? 'pass' : 'agent_bug',
      passed: ok,
      reason: ok
        ? 'Agent matched expected (BBR unverified — agent-vs-test only).'
        : 'Agent did not match expected answer (BBR unverified).',
    };
  }

  // 3) DB agrees with BBR. Judge the agent against BBR truth.
  // Determine authoritative expected tokens: prefer verified BBR values; flag the test if its
  // own expectedAnswer disagrees with BBR.
  const verifiedBbr = result.comparisons.filter((c) => c.bbrVerified && c.bbr != null);
  const matrixTokens = Array.isArray(q.expectedAnswer)
    ? q.expectedAnswer.map(String)
    : [String(q.expectedAnswer)];

  // Stale-test detection: single-fact lookups where matrix expected != BBR.
  let staleTestExpected = false;
  const soleBbr = verifiedBbr[0];
  const soleToken = matrixTokens[0];
  if (verifiedBbr.length === 1 && matrixTokens.length === 1 && soleBbr && soleToken != null) {
    if (!valuesMatch(soleToken, soleBbr.bbr, q.tolerance)) {
      staleTestExpected = true;
    }
  }

  // Expected tokens the agent must contain: BBR values (authoritative) plus, for derived/multi
  // questions, the matrix expected text (which encodes the derivation we can't recompute).
  const expectedTokens = new Set<string>();
  for (const c of verifiedBbr) expectedTokens.add(String(c.bbr));
  if (!staleTestExpected) for (const t of matrixTokens) expectedTokens.add(t);

  const ok = [...expectedTokens].every((t) => containsToken(agent, t));
  return {
    ...result,
    staleTestExpected,
    verdict: ok ? 'pass' : 'agent_bug',
    passed: ok,
    reason: ok
      ? staleTestExpected
        ? 'Agent matches BBR (note: matrix expectedAnswer is stale vs BBR).'
        : 'Agent matches BBR and DB.'
      : `Agent answer does not contain expected BBR value(s): ${[...expectedTokens]
          .filter((t) => !containsToken(agent, t))
          .join(', ')}`,
  };
}

async function main(): Promise<void> {
  process.env['NODE_ENV'] ||= 'test';
  process.env['TEMPERATURE'] ||= '0';

  const startedAt = new Date();
  const runDir = join(LOG_ROOT, `matrix-${startedAt.toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(runDir, { recursive: true });
  const jsonlPath = join(runDir, 'results.jsonl');
  const summaryPath = join(runDir, 'summary.json');

  await initDb();
  const prompt = `${(await buildSystemPrompt()).trim()}\n\n${TEST_MODE_SUFFIX}\n`;
  const model = getModel();

  console.log(
    `┌─ matrix eval — ${model} — ${QUESTION_MATRIX.length} questions × ${RUNS_PER_QUESTION} run(s)`,
  );
  console.log('├─ truth: basketball-reference.com via eval/bbr-truth.json');
  console.log(`└─ run dir: ${runDir}\n`);

  const results: RunResult[] = [];

  for (const q of QUESTION_MATRIX.slice(0, QUESTION_LIMIT)) {
    for (let run = 1; run <= RUNS_PER_QUESTION; run++) {
      const threadId = `matrix-${q.id}-r${run}-${Date.now()}`;
      const agent = await runAgent(q, prompt, threadId);

      let result = classify(q, agent.answer, agent.stopReason);
      // attach DB comparisons
      for (const c of result.comparisons) {
        const db = await resolveDbValue(c.id);
        c.db = db.value;
        c.dbSupported = db.supported && db.value != null;
      }
      result = finalizeFactual(result, q);
      result.toolCalls = agent.toolCalls;
      result.latencyMs = agent.latencyMs;

      results.push(result);
      appendFileSync(jsonlPath, `${JSON.stringify(result)}\n`);

      const icon = result.passed ? '✅' : result.verdict === 'data_quality' ? '🟠' : '❌';
      const tags = [
        result.staleTestExpected ? 'STALE-TEST' : '',
        result.bbrUnverified ? 'BBR-UNVERIFIED' : '',
      ]
        .filter(Boolean)
        .join(' ');
      console.log(`${icon} ${q.id} [${result.verdict}] ${tags}`);
      if (!result.passed) console.log(`     ${result.reason}`);
    }
  }

  // Rollups
  const byVerdict: Record<string, number> = {};
  const byTier: Record<string, { pass: number; total: number }> = {};
  for (const r of results) {
    byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
    const tier = (byTier[r.tier] ??= { pass: 0, total: 0 });
    tier.total++;
    if (r.passed) tier.pass++;
  }
  const dataQuality = results.filter((r) => r.verdict === 'data_quality');
  const staleTests = results.filter((r) => r.staleTestExpected);
  const passed = results.filter((r) => r.passed).length;

  const summary = {
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    model,
    truthSource: 'basketball-reference.com',
    totalPassed: passed,
    total: results.length,
    byVerdict,
    byTier,
    dataQualityIssues: dataQuality.map((r) => ({ id: r.questionId, reason: r.reason })),
    staleTestExpectations: staleTests.map((r) => ({
      id: r.questionId,
      matrixExpected: r.matrixExpected,
      bbrExpected: r.bbrExpected,
    })),
  };
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`RESULT: ${passed}/${results.length} pass`);
  console.log('By verdict:', JSON.stringify(byVerdict));
  console.log(
    'By tier:',
    Object.entries(byTier)
      .map(([t, v]) => `${t} ${v.pass}/${v.total}`)
      .join('  '),
  );
  if (dataQuality.length)
    console.log(`\n🟠 DATA QUALITY ISSUES (DB ≠ basketball-reference): ${dataQuality.length}`);
  for (const r of dataQuality) console.log(`   - ${r.questionId}: ${r.reason}`);
  if (staleTests.length)
    console.log(`\n⚠️  STALE TEST EXPECTATIONS (matrix ≠ BBR): ${staleTests.length}`);
  for (const r of staleTests)
    console.log(`   - ${r.questionId}: matrix="${r.matrixExpected}" bbr="${r.bbrExpected}"`);
  console.log(`\nSUMMARY: ${summaryPath}`);
  console.log('═'.repeat(60));

  await closeDb();
  if (passed !== results.length && EXIT_NONZERO_ON_FAIL) process.exitCode = 1;
}

main();
