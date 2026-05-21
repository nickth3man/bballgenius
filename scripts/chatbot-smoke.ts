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
 *   CHATBOT_SMOKE_LIMIT Optional number of cases to run
 *   CHATBOT_SMOKE_TIMEOUT_MS Optional per-case timeout (default: 120000)
 */

import { existsSync, readFileSync } from 'node:fs';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { closeDb, initDb } from '../src/chatbot/db.js';
import { NBA_100_QUERIES } from '../src/chatbot/eval/nba-100-queries.js';
import { chatbotGraph } from '../src/chatbot/graph/graph.js';
import { setModel } from '../src/chatbot/openrouter.js';
import { buildSystemPrompt } from '../src/chatbot/systemPrompt.js';

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
}

interface TestResult {
  testCase: TestCase;
  answer: string;
  passed: boolean;
  reasons: string[];
  error?: string;
}

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
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
  }));
}

function normalizeNumbers(s: string): string {
  return s.replace(/,/g, '');
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

async function main(): Promise<void> {
  const modelId = process.env.MODEL || 'openai/gpt-oss-120b';
  setModel(modelId);

  const isDryRun = process.env.DRY_RUN === '1';
  const suite = process.env.CHATBOT_SMOKE_SUITE || 'facts';
  const limit = process.env.CHATBOT_SMOKE_LIMIT ? Number(process.env.CHATBOT_SMOKE_LIMIT) : null;
  const perCaseTimeoutMs = Number(process.env.CHATBOT_SMOKE_TIMEOUT_MS || 120_000);

  if (!isDryRun && !process.env.OPENROUTER_API_KEY) {
    console.error(`${RED}${BOLD}ERROR:${RESET} OPENROUTER_API_KEY is not set.`);
    console.error(`  ${DIM}Set it or use DRY_RUN=1 to validate structure only.${RESET}`);
    process.exit(1);
  }

  const jsonPath = 'src/hub/tests/nba-facts-test-cases.json';
  if (suite === 'facts' && !existsSync(jsonPath)) {
    console.error(`${RED}${BOLD}ERROR:${RESET} Test cases JSON not found at ${jsonPath}`);
    process.exit(1);
  }

  const loadedTestCases = suite === '100' ? load100QuerySuite() : loadTestCases(jsonPath);
  const testCases = limit && limit > 0 ? loadedTestCases.slice(0, limit) : loadedTestCases;

  console.log();
  console.log(`${BOLD}=== BBallGenius Chatbot Smoke Test v3 ===${RESET}`);
  console.log(`Model:   ${modelId}`);
  console.log(`DB:      ${process.env.NBA_DUCKDB_PATH || '(default)'}`);
  console.log(`Suite:   ${suite}`);
  console.log(`Cases:   ${testCases.length}${suite === 'facts' ? ' (high-confidence only)' : ''}`);
  console.log(`Mode:    ${isDryRun ? 'DRY RUN (no API calls)' : 'LIVE'}`);
  console.log('========================================');
  console.log();

  try {
    await initDb();
  } catch (e: unknown) {
    console.error(
      `${RED}${BOLD}FAILED${RESET} to init DB: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  }

  let systemPrompt: string;
  try {
    systemPrompt = await buildSystemPrompt();
    console.log(`${DIM}System prompt: ${systemPrompt.length} chars${RESET}\n`);
  } catch (e: unknown) {
    console.error(
      `${RED}${BOLD}FAILED${RESET} to build prompt: ${e instanceof Error ? e.message : String(e)}`,
    );
    await closeDb();
    process.exit(1);
  }

  if (isDryRun) {
    console.log(
      `${GREEN}${BOLD}DRY RUN PASSED${RESET} — ${testCases.length} cases loaded, DB ready.`,
    );
    console.log(`${DIM}Run without DRY_RUN=1 to execute API queries.${RESET}\n`);
    await closeDb();
    return;
  }

  const results: TestResult[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const label = `[${i + 1}/${testCases.length}]`;

    process.stdout.write(`${BOLD}${label} ${tc.category} ${RESET}`);
    process.stdout.write(`${tc.question.slice(0, 70)}${tc.question.length > 70 ? '...' : ''}\n`);

    let result: TestResult;

    try {
      const graphResult = await withTimeout(
        chatbotGraph.invoke(
          {
            messages: [new SystemMessage(systemPrompt), new HumanMessage(tc.question)],
          },
          { configurable: { thread_id: tc.id } },
        ),
        perCaseTimeoutMs,
        tc.id,
      );

      const messages = graphResult.messages;
      const lastMsg = messages[messages.length - 1];
      const answer =
        typeof lastMsg.content === 'string' ? lastMsg.content : String(lastMsg.content);
      const trimmed = answer.trim();
      const { passed, reasons } = checkAnswer(trimmed, tc);
      result = { testCase: tc, answer: trimmed, passed, reasons };

      const excerpt = trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
      console.log(`  Answer: ${excerpt}`);
      const passStr = passed ? `${GREEN}${BOLD}PASS${RESET}` : `${RED}${BOLD}FAIL${RESET}`;
      console.log(`  ${passStr} (${reasons.join('; ') || 'no issues'})`);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      result = { testCase: tc, answer: '', passed: false, reasons: [], error: errMsg };
      console.log(`  ${YELLOW}ERROR${RESET} ${DIM}${errMsg}${RESET}`);
    }

    results.push(result);
  }

  const passCount = results.filter((r) => r.passed).length;
  const total = results.length;
  const failCount = total - passCount;

  const sep = '='.repeat(40);
  console.log(`\n${sep}`);
  console.log(`${BOLD}Results: ${passCount}/${total} PASS, ${failCount}/${total} FAIL${RESET}`);
  console.log(sep);

  for (const r of results) {
    const status =
      r.passed && !r.error
        ? `${GREEN}PASS${RESET}`
        : r.error
          ? `${RED}ERROR${RESET}`
          : `${RED}FAIL${RESET}`;
    const kwInfo = r.passed
      ? ''
      : ` ${DIM}expected: "${r.testCase.expectedKeywords.slice(0, 3).join('", "')}"${RESET}`;
    console.log(`  ${status}  ${r.testCase.id} ${kwInfo}`);
  }

  console.log();

  await closeDb();

  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`${RED}${BOLD}Fatal:${RESET}`, err);
  process.exit(1);
});
