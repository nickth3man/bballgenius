#!/usr/bin/env bun
/**
 * BBallGenius Chatbot Smoke Test (v3)
 *
 * Loads fact-checked NBA questions or the 100-query broad NBA suite,
 * sends each through the LangGraph chatbotGraph, and validates
 * answers against expected keywords extracted from basketball-reference.com data.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-v1-... bun run scripts/chatbot-smoke.ts
 *   DRY_RUN=1 bun run scripts/chatbot-smoke.ts          # validate structure only, no API calls
 *
 * Environment:
 *   OPENROUTER_API_KEY  Required (unless DRY_RUN=1)
 *   NBA_DUCKDB_PATH     Optional (default: data/nba.duckdb)
 *   MODEL               Optional (default: openai/gpt-oss-120b)
 *   OPENROUTER_PROVIDER Optional (default: google-vertex)
 *   DRY_RUN             Optional (skip API calls, just parse + init)
 *   CHATBOT_SMOKE_SUITE Optional: facts or 100 (default: facts)
 *   CHATBOT_SMOKE_TIER  Optional: free | baseline | all (default: single MODEL)
 *   CHATBOT_SMOKE_LIMIT Optional number of cases to run
 *   CHATBOT_SMOKE_DELAY_MS Optional delay between cases on free tier (default: 3000)
 *   CHATBOT_SMOKE_TIMEOUT_MS Optional per-case timeout (default: 120000)
 */

import { existsSync, readFileSync } from 'node:fs';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getChatbotGraph, resetGraph } from '../../src/tabs/chatbot/agent/graph.js';
import { closeDb, initDb } from '../../src/tabs/chatbot/db.js';
import { NBA_100_QUERIES } from '../../src/tabs/chatbot/eval/nba-100-queries.js';
import { setModel } from '../../src/tabs/chatbot/openrouter.js';
import { buildSystemPrompt } from '../../src/tabs/chatbot/systemPrompt.js';
import {
  ANSI,
  normalizeNumbers,
  resolveSmokeModels,
  type SmokeModelTier,
  smokeTierDelayMs,
  warnFreeTierModel,
  withTimeout,
} from './shared/index.js';

interface RawTestCase {
  id: string;
  category: string;
  subcategory: string;
  question: string;
  expectedAnswer: Record<string, unknown>;
  source: string;
  confidence: string;
  notes: string;
}

interface TestCase {
  id: string;
  question: string;
  expectedKeywords: string[];
  expectedAbsent: string[];
  category: string;
  expectedTools?: string[];
  expectNoSqlError?: boolean;
}

interface TestResult {
  testCase: TestCase;
  answer: string;
  passed: boolean;
  reasons: string[];
  error?: string;
}

function extractKeywords(expectedAnswer: Record<string, unknown>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  function add(s: string) {
    const trimmed = s.trim();
    if (!trimmed || trimmed.length < 2 || trimmed.length > 60) return;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    result.push(trimmed);
  }

  function walk(obj: unknown, depth: number) {
    if (depth > 4 || !obj) return;
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item, depth + 1);
      return;
    }
    if (typeof obj !== 'object') return;

    const record = obj as Record<string, unknown>;

    // Extract player names (primary identifiers)
    const nameKeys = ['player', 'name', 'champion', 'originalTeam', 'newTeam'];
    for (const key of nameKeys) {
      if (typeof record[key] === 'string') add(record[key] as string);
    }

    // Extract notable numbers (including decimals) from value/count/titles keys
    const valueKeys = [
      'value',
      'count',
      'titles',
      'teamsCount',
      'gamesPerTeam',
      'games',
      'points',
      'rebounds',
      'assists',
      'blocks',
      'steals',
    ];
    for (const key of valueKeys) {
      const v = record[key];
      if (typeof v === 'number' || typeof v === 'string') {
        const str = String(v);
        if (/^\d+(?:\.\d+)?$/.test(str)) add(str);
      }
    }

    // Walk nested objects (rank1, rank2, etc.)
    for (const val of Object.values(record)) {
      if (val && typeof val === 'object') walk(val, depth + 1);
    }
  }

  walk(expectedAnswer, 0);
  return result;
}

function buildAbsentKeywords(testCase: RawTestCase): string[] {
  const knownWrong: Record<string, string[]> = {
    'CHAMPIONSHIP-001': ['Lakers', 'L.A. Lakers'],
  };
  return knownWrong[testCase.id] || [];
}

function loadTestCases(jsonPath: string): TestCase[] {
  const raw = JSON.parse(readFileSync(jsonPath, 'utf-8')) as {
    testCases: RawTestCase[];
  };
  return raw.testCases
    .filter((tc) => tc.confidence === 'high')
    .map((tc) => ({
      id: tc.id,
      question: tc.question,
      expectedKeywords: extractKeywords(tc.expectedAnswer),
      expectedAbsent: buildAbsentKeywords(tc),
      category: `${tc.category} > ${tc.subcategory}`,
    }));
}

function load100QuerySuite(): TestCase[] {
  return NBA_100_QUERIES.map((query) => ({
    id: query.id,
    question: query.question,
    expectedKeywords: [],
    expectedAbsent: [],
    category: query.category,
    expectedTools: query.expectedTools,
    expectNoSqlError: query.expectNoSqlError ?? false,
  }));
}

function hasLeakedControlText(answer: string): boolean {
  return /<\|(?:channel|message|start|end|call)\|>|to=(?:container\.exec|repo_browser|duckdb)|\{"cmd":\[/i.test(
    answer,
  );
}

function hasRawSqlLeak(answer: string): boolean {
  return /```sql/i.test(answer) || /^\s*(select|with|describe)\b/im.test(answer);
}

function checkAnswer(answer: string, testCase: TestCase): Pick<TestResult, 'passed' | 'reasons'> {
  const normalizedAnswer = normalizeNumbers(answer).toLowerCase();
  const reasons: string[] = [];

  if (answer.trim().length === 0) {
    reasons.push('empty answer');
  }

  if (normalizedAnswer.includes('sql error')) {
    reasons.push('answer contains SQL error');
  }

  if (hasLeakedControlText(answer)) {
    reasons.push('answer leaked model/tool control text');
  }

  if (hasRawSqlLeak(answer)) {
    reasons.push('answer leaked raw SQL instead of a final answer');
  }

  if (testCase.expectedKeywords.length === 0) {
    const passed = reasons.every((reason) => !/empty|error|leaked/i.test(reason));
    return { passed, reasons };
  }

  const found = testCase.expectedKeywords.filter((kw) => {
    const lowerKw = kw.toLowerCase();
    if (normalizedAnswer.includes(lowerKw)) return true;
    if (normalizedAnswer.includes(normalizeNumbers(lowerKw))) return true;
    return false;
  });
  const foundCount = found.length;
  const totalCount = testCase.expectedKeywords.length;
  const needed = Math.max(1, Math.ceil(totalCount * 0.3));

  if (foundCount >= needed) {
    reasons.push(`found ${foundCount}/${totalCount} keywords`);
  } else {
    reasons.push(`only found ${foundCount}/${totalCount} keywords (needed ${needed})`);
  }

  let absentViolation = false;
  for (const absent of testCase.expectedAbsent) {
    const lowerAbsent = absent.toLowerCase();
    if (normalizedAnswer.includes(lowerAbsent)) {
      absentViolation = true;
      reasons.push(`forbidden: "${absent}"`);
    }
  }

  const passed =
    foundCount >= needed &&
    !absentViolation &&
    reasons.every((reason) => !/empty|error|leaked/i.test(reason));
  return { passed, reasons };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSmokeCases(
  modelId: string,
  testCases: TestCase[],
  systemPrompt: string,
  perCaseTimeoutMs: number,
  caseDelayMs: number,
): Promise<TestResult[]> {
  setModel(modelId);
  resetGraph();

  const results: TestResult[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i]!;
    const label = `[${i + 1}/${testCases.length}]`;

    process.stdout.write(`${ANSI.BOLD}${label} ${tc.category} ${ANSI.RESET}`);
    process.stdout.write(`${tc.question.slice(0, 70)}${tc.question.length > 70 ? '...' : ''}\n`);

    let result: TestResult;

    try {
      const graphResult = await withTimeout(
        getChatbotGraph().invoke(
          {
            messages: [new SystemMessage(systemPrompt), new HumanMessage(tc.question)],
          },
          { configurable: { thread_id: `${modelId}::${tc.id}` } },
        ),
        perCaseTimeoutMs,
        tc.id,
      );

      const messages = graphResult.messages;
      const lastMsg = messages[messages.length - 1]!;
      const answer =
        typeof lastMsg.content === 'string' ? lastMsg.content : String(lastMsg.content);
      const trimmed = answer.trim();
      const { passed, reasons } = checkAnswer(trimmed, tc);

      if (tc.expectedTools && tc.expectedTools.length > 0) {
        const toolNames = messages
          .filter((m) => {
            const rec = m as unknown as Record<string, unknown>;
            return 'tool_calls' in m && Array.isArray(rec['tool_calls']);
          })
          .flatMap((m) => {
            const rec = m as unknown as Record<string, unknown>;
            const calls = rec['tool_calls'] as Array<{ name?: string }> | undefined;
            return calls?.map((c) => c.name) ?? [];
          });
        for (const expectedTool of tc.expectedTools) {
          if (!toolNames.includes(expectedTool)) {
            reasons.push(`expected tool "${expectedTool}" not found in chain`);
          }
        }
      }

      if (tc.expectNoSqlError) {
        const sqlErrorMessages = messages.filter((m) => {
          const rec = m as unknown as Record<string, unknown>;
          return (
            'content' in m &&
            typeof rec['content'] === 'string' &&
            (rec['content'] as string).includes('SQL validation failed')
          );
        });
        if (sqlErrorMessages.length > 0) {
          reasons.push('unexpected SQL error in chain');
        }
      }

      const finalPassed =
        passed && reasons.every((reason) => !/expected tool|unexpected SQL error/i.test(reason));
      result = {
        testCase: tc,
        answer: trimmed,
        passed: finalPassed,
        reasons,
      };

      const excerpt = trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
      console.log(`  Answer: ${excerpt}`);
      const passStr = finalPassed
        ? `${ANSI.GREEN}${ANSI.BOLD}PASS${ANSI.RESET}`
        : `${ANSI.RED}${ANSI.BOLD}FAIL${ANSI.RESET}`;
      console.log(`  ${passStr} (${reasons.join('; ') || 'no issues'})`);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      result = { testCase: tc, answer: '', passed: false, reasons: [], error: errMsg };
      console.log(`  ${ANSI.YELLOW}ERROR${ANSI.RESET} ${ANSI.DIM}${errMsg}${ANSI.RESET}`);
    }

    results.push(result);

    if (caseDelayMs > 0 && i < testCases.length - 1) {
      await sleep(caseDelayMs);
    }
  }

  return results;
}

async function main(): Promise<void> {
  const smokeTier = process.env.CHATBOT_SMOKE_TIER?.trim() as SmokeModelTier | undefined;
  const models = resolveSmokeModels();
  const caseDelayMs = smokeTierDelayMs(smokeTier);

  const isDryRun = process.env.DRY_RUN === '1';
  const suite = process.env.CHATBOT_SMOKE_SUITE || 'facts';
  const limit = process.env.CHATBOT_SMOKE_LIMIT ? Number(process.env.CHATBOT_SMOKE_LIMIT) : null;
  const perCaseTimeoutMs = Number(
    process.env.EVAL_TIMEOUT_MS || process.env.CHATBOT_SMOKE_TIMEOUT_MS || 120_000,
  );

  if (!isDryRun && !process.env.OPENROUTER_API_KEY) {
    console.error(`${ANSI.RED}${ANSI.BOLD}ERROR:${ANSI.RESET} OPENROUTER_API_KEY is not set.`);
    console.error(`  ${ANSI.DIM}Set it or use DRY_RUN=1 to validate structure only.${ANSI.RESET}`);
    process.exit(1);
  }

  const jsonPath = 'src/tests/nba-facts-test-cases.json';
  if (suite === 'facts' && !existsSync(jsonPath)) {
    console.error(
      `${ANSI.RED}${ANSI.BOLD}ERROR:${ANSI.RESET} Test cases JSON not found at ${jsonPath}`,
    );
    process.exit(1);
  }

  const loadedTestCases = suite === '100' ? load100QuerySuite() : loadTestCases(jsonPath);
  const testCases = limit && limit > 0 ? loadedTestCases.slice(0, limit) : loadedTestCases;

  console.log();
  console.log(`${ANSI.BOLD}=== BBallGenius Chatbot Smoke Test v3 ===${ANSI.RESET}`);
  console.log(`Models:  ${models.join(', ')}`);
  console.log(`DB:      ${process.env.NBA_DUCKDB_PATH || '(default)'}`);
  console.log(`Suite:   ${suite}`);
  console.log(`Cases:   ${testCases.length}${suite === 'facts' ? ' (high-confidence only)' : ''}`);
  console.log(`Tier:    ${smokeTier ?? '(single MODEL)'}`);
  if (caseDelayMs > 0) {
    console.log(`Delay:   ${caseDelayMs}ms between cases (free-tier rate limit)`);
  }
  console.log(`Mode:    ${isDryRun ? 'DRY RUN (no API calls)' : 'LIVE'}`);
  console.log('========================================');
  console.log();

  try {
    await initDb();
  } catch (e: unknown) {
    console.error(
      `${ANSI.RED}${ANSI.BOLD}FAILED${ANSI.RESET} to init DB: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  }

  let systemPrompt: string;
  try {
    systemPrompt = await buildSystemPrompt();
    console.log(`${ANSI.DIM}System prompt: ${systemPrompt.length} chars${ANSI.RESET}\n`);
  } catch (e: unknown) {
    console.error(
      `${ANSI.RED}${ANSI.BOLD}FAILED${ANSI.RESET} to build prompt: ${e instanceof Error ? e.message : String(e)}`,
    );
    await closeDb();
    process.exit(1);
  }

  if (isDryRun) {
    console.log(
      `${ANSI.GREEN}${ANSI.BOLD}DRY RUN PASSED${ANSI.RESET} — ${testCases.length} cases × ${models.length} model(s), DB ready.`,
    );
    console.log(`${ANSI.DIM}Run without DRY_RUN=1 to execute API queries.${ANSI.RESET}\n`);
    await closeDb();
    return;
  }

  const modelSummaries: { modelId: string; passCount: number; failCount: number }[] = [];
  let anyFailed = false;

  for (const modelId of models) {
    warnFreeTierModel(modelId, smokeTier);
    console.log(`\n${ANSI.BOLD}--- Model: ${modelId} ---${ANSI.RESET}\n`);
    const results = await runSmokeCases(
      modelId,
      testCases,
      systemPrompt,
      perCaseTimeoutMs,
      caseDelayMs,
    );

    const passCount = results.filter((r) => r.passed).length;
    const failCount = results.length - passCount;
    modelSummaries.push({ modelId, passCount, failCount });
    if (failCount > 0) {
      anyFailed = true;
    }

    const sep = '='.repeat(40);
    console.log(`\n${sep}`);
    console.log(
      `${ANSI.BOLD}${modelId}: ${passCount}/${results.length} PASS, ${failCount}/${results.length} FAIL${ANSI.RESET}`,
    );
    console.log(sep);

    for (const r of results) {
      const status =
        r.passed && !r.error
          ? `${ANSI.GREEN}PASS${ANSI.RESET}`
          : r.error
            ? `${ANSI.RED}ERROR${ANSI.RESET}`
            : `${ANSI.RED}FAIL${ANSI.RESET}`;
      const kwInfo = r.passed
        ? ''
        : ` ${ANSI.DIM}expected: "${r.testCase.expectedKeywords.slice(0, 3).join('", "')}"${ANSI.RESET}`;
      console.log(`  ${status}  ${r.testCase.id} ${kwInfo}`);
    }
  }

  if (models.length > 1) {
    console.log(`\n${ANSI.BOLD}=== Model summary ===${ANSI.RESET}`);
    for (const row of modelSummaries) {
      const ok = row.failCount === 0;
      console.log(
        `  ${ok ? ANSI.GREEN : ANSI.RED}${row.modelId}: ${row.passCount}/${row.passCount + row.failCount} PASS${ANSI.RESET}`,
      );
    }
  }

  console.log();

  await closeDb();

  if (anyFailed) process.exit(1);
}

main().catch((err) => {
  console.error(`${ANSI.RED}${ANSI.BOLD}Fatal:${ANSI.RESET}`, err);
  process.exit(1);
});
