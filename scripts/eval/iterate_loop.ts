#!/usr/bin/env bun

/**
 * Iterative NBA chatbot test harness with structured observability.
 *
 * Goals:
 * - Run each predetermined-answer question multiple times.
 * - Keep terminal output concise but useful.
 * - Persist redacted raw logs and JSONL traces.
 * - Detect graph/tool loops, duplicate final answers, timeouts, crashes, and answer mismatches.
 * - Reset graph state per run to reduce state leakage.
 * - Append a test-mode prompt contract without exposing golden answers.
 *
 * NOTE: For matrix-driven evaluation with three-way (agent/DB/basketball-reference)
 * data-quality classification, prefer src/chatbot/eval/matrixHarness.ts
 * (`bun run chatbot:matrix`). This script remains for broad multi-run loop testing.
 *
 * Usage:
 *   bun run scripts/eval/iterate_loop.ts   (or: bun run chatbot:iterate)
 *
 * Useful env vars:
 *   RUNS_PER_QUESTION=3
 *   TOTAL_TIMEOUT_MS=300000
 *   RUN_TIMEOUT_MS=90000
 *   MAX_TOOL_CALLS=18
 *   LOG_DIR=.runs/nba-chatbot
 *   EXIT_NONZERO_ON_FAIL=1
 *   SECRET_SCAN=1
 */

import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { resetGraph } from '../../packages/data/src/tabs/chatbot/agent/graph.js';
import {
  type StreamEvent,
  streamQuery,
} from '../../packages/data/src/tabs/chatbot/agent/streaming.js';
import { closeDb, initDb } from '../../packages/data/src/tabs/chatbot/db.js';
import {
  type ExpectedAnswer,
  type ExpectedKind,
  QUESTIONS,
  type Question,
} from '../../packages/data/src/tabs/chatbot/eval/iterate-questions.js';
import { getModel } from '../../packages/data/src/tabs/chatbot/openrouter.js';
import { buildSystemPrompt } from '../../packages/data/src/tabs/chatbot/systemPrompt.js';
import {
  countOccurrences,
  detectDuplicateFinalAnswer,
  normalizeNumeric,
  normalizeText,
} from './shared/index.js';

export { countOccurrences, detectDuplicateFinalAnswer, normalizeNumeric, normalizeText };

const DEFAULT_TOTAL_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_RUN_TIMEOUT_MS = envInt('EVAL_TIMEOUT_MS', envInt('RUN_TIMEOUT_MS', 90 * 1000));
const DEFAULT_RUNS_PER_QUESTION = envInt('EVAL_RUNS_PER_QUESTION', envInt('RUNS_PER_QUESTION', 3));
const DEFAULT_MAX_TOOL_CALLS = envInt('EVAL_MAX_TOOL_CALLS', envInt('MAX_TOOL_CALLS', 18));

const TOTAL_TIMEOUT_MS = envInt('TOTAL_TIMEOUT_MS', DEFAULT_TOTAL_TIMEOUT_MS);
const RUN_TIMEOUT_MS = envInt('RUN_TIMEOUT_MS', DEFAULT_RUN_TIMEOUT_MS);
const RUNS_PER_QUESTION = envInt('RUNS_PER_QUESTION', DEFAULT_RUNS_PER_QUESTION);
const MAX_TOOL_CALLS = envInt('MAX_TOOL_CALLS', DEFAULT_MAX_TOOL_CALLS);
const EXIT_NONZERO_ON_FAIL = envBool('EXIT_NONZERO_ON_FAIL', true);
const SECRET_SCAN = envBool('SECRET_SCAN', true);
const LOG_ROOT = process.env.LOG_DIR || '.runs/nba-chatbot';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Select the questions to run.
 *
 * - EVAL_QUESTION_IDS=new-004,new-079,... pins an exact, ordered set (no
 *   shuffle). Use this for reproducible iteration where you want the same set
 *   every run so prompt improvements are measurable.
 * - Otherwise: shuffle and take EVAL_QUESTION_LIMIT (default: all).
 */
function selectQuestions(): Question[] {
  const idsEnv = (process.env.EVAL_QUESTION_IDS ?? '').trim();
  if (idsEnv) {
    const byId = new Map(QUESTIONS.map((q) => [q.id, q]));
    const selected = idsEnv
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => byId.get(id))
      .filter((q): q is Question => q != null);
    if (selected.length > 0) return selected;
  }
  return shuffle(QUESTIONS).slice(0, envInt('EVAL_QUESTION_LIMIT', QUESTIONS.length));
}

const ACTIVE_QUESTIONS = selectQuestions();

const TAB = '  ';

type FailureCategory =
  | 'pass'
  | 'sql_syntax'
  | 'sql_schema'
  | 'tool_loop'
  | 'duplicate_final_answer'
  | 'hallucination'
  | 'wrong_answer'
  | 'refused'
  | 'no_clarification'
  | 'not_available_expected'
  | 'timeout'
  | 'crash'
  | 'recursion_limit'
  | 'missing_final_answer'
  | 'evaluator_error'
  | 'unknown';

interface ToolTrace {
  index: number;
  name: string;
  input?: unknown;
  inputSummary?: string;
  outputSummary?: string;
  error?: string;
  sqlCandidates: string[];
  startedAt: string;
  endedAt?: string;
  latencyMs?: number;
}

interface RunTrace {
  runId: string;
  threadId: string;
  questionId: string;
  question: string;
  expected: string;
  expectedKind: ExpectedKind;
  tier: string;
  model: string;
  modelParams: Record<string, unknown>;
  graph: {
    recursionLimit?: number | null;
    maxToolCalls: number;
  };
  timing: {
    startedAt: string;
    endedAt?: string;
    latencyMs?: number;
    runTimeoutMs: number;
    totalTimeoutMs: number;
  };
  nodeTransitions: string[];
  stateKeysChanged: string[];
  messagesSeenAtDone: number | null;
  toolCalls: ToolTrace[];
  sql: {
    generated: string[];
    validationResults: string[];
    executionResultSummaries: string[];
    executionLatenciesMs: number[];
  };
  streamedTokenText: string;
  finalAnswerCandidate: string;
  finalAnswerEmitted: string;
  evaluator: {
    passed: boolean;
    verdict: string;
    failureCategory: FailureCategory;
    duplicateFinalAnswer: boolean;
    duplicateEvidence?: string;
    normalizedExpected: string;
    normalizedActual: string;
  };
  stop: {
    reason: string;
    recursionLimitHit: boolean;
    timeout: boolean;
    error?: string;
  };
  tokenUsage: Array<Record<string, unknown>>;
  redaction: {
    applied: true;
  };
}

interface SuiteSummary {
  startedAt: string;
  endedAt: string;
  elapsedSec: number;
  model: string;
  totalPassed: number;
  totalAttempted: number;
  totalExpected: number;
  allPassed: boolean;
  runDir: string;
  failures: Array<{
    runId: string;
    questionId: string;
    question: string;
    expected: string;
    actual: string;
    category: FailureCategory;
    reason: string;
    tools: number;
    stopReason: string;
  }>;
}

const TEST_MODE_PROMPT_SUFFIX = `
You are running in deterministic test mode.

Final-answer contract:
- Emit exactly one final answer.
- Answer only the user's question.
- Do not include follow-up offers such as "Would you like...".
- Do not repeat the final answer.
- Stop after you have enough evidence.
- Do not call tools after you have enough evidence for the answer.
- Prefer database-grounded answers when the NBA database can answer the question.
- Do not introduce external NBA facts or official-record caveats unless the question explicitly asks for them or the database evidence requires the distinction.
- For ambiguous questions, ask one concise clarification question instead of guessing.
- If the requested statistic is not available in the database after checking the relevant sources, say "I do not have that information in the database."

Regular season vs playoffs:
- Always distinguish between regular season and playoff stats.
- The main.fact_bref_player_season_totals table has an is_playoffs column. Filter is_playoffs = false for regular season stats.
- If a question asks about "career points" or "career stats" without specifying regular season or playoffs, assume REGULAR SEASON.
- fact_bref_player_season_totals has NO playoff rows. For playoff career points/rebounds/assists, use:
  SELECT dp.player_name, SUM(p.points) as total FROM main.fact_player_game_stats p
  JOIN main.fact_game g ON p.game_id = g.game_id JOIN main.dim_player dp ON p.person_id = dp.person_id
  WHERE g.season_type = 'Playoffs' GROUP BY dp.player_name ORDER BY total DESC
- Playoff PER: use unified_star.fact_player_season_stats WHERE is_playoffs = true.
- Championship winners and Finals MVP are NOT in the database. The fact_player_award_vote table only has regular season awards (nba mvp, nba roy, nba dpoy). If asked about Finals MVP, say the data is not available in the database.

Career stat queries (CRITICAL):
- ALWAYS use main.fact_bref_player_season_totals for career totals.
- NEVER use fact_player_game_stats for career totals.
- Use exact player_name with = operator, NOT LIKE.
- Filter: team NOT LIKE '%TM%' AND is_playoffs = false.
- Column names: pts, ast, trb, stl, blk, x3p (three-pointers made).
- When reading SQL results with ORDER BY, the FIRST row is the top result (rank 1).
  Do NOT skip the first row. If you used OFFSET 1, the first returned row IS the answer.
  Read the FIRST row of the results, not the second.
- For "second on the all-time list" queries, use LIMIT 1 OFFSET 1 — this returns exactly ONE row
  which is the second-place player. Report that single row as the answer.

Season leaders — totals vs per game (CRITICAL):
- "Who led the NBA in [blocks/rebounds/assists/steals/points] in {season}?" with NO "per game"
  wording means the SEASON TOTAL leader. Rank by SUM(stat) in fact_bref_player_season_totals
  (team NOT LIKE '%TM%', is_playoffs = false), ORDER BY total DESC LIMIT 1.
- Only use the per-game table (e.g. blk_per_game) when the question says "per game" or "average".
- Do NOT report a per-game leader for a "led the NBA in X" question.

Team season queries (CRITICAL):
- Team win/loss totals are in main.fact_bref_team_season_summary.
- Columns are team (full name like 'Milwaukee Bucks'), w (wins), l (losses), srs.
  There is NO team_name, wins, losses, or win_loss_pct column.
- Query: SELECT team, w, l FROM main.fact_bref_team_season_summary WHERE team = 'Milwaukee Bucks' AND season_end_year = 2020.
- Do NOT add an is_playoffs filter on this table — the stored row holds the regular-season w/l.
- season_end_year is the season's ending year (2020 for the 2019-20 season).

Award queries (CRITICAL):
- Use main.fact_player_award_vote with winner = true.
- Award values: 'nba mvp', 'nba roy', 'nba dpoy' (use lower()).
- Season is INTEGER season_end_year (e.g. 2004 for 2003-04).
- For counting awards per player: GROUP BY player_name with HAVING COUNT(*) >= N.

Ambiguous questions (CRITICAL):
- "Who scored the most?" → ask "Could you clarify: regular season or playoffs? Which statistic (points, rebounds, etc.)?"
- "Who is the best player?" → ask "Could you clarify what you mean by best? (MVPs, points, overall impact?)"
- "Tell me about the Lakers" → ask "What specific Lakers information? (season record, roster, historical stats?)"
- "What are Jordans career stats?" → ask "Which specific stats? (points, assists, rebounds, all?)"
`.trim();

function envInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|y)$/i.test(value);
}

function timestampForPath(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function ensureDeterministicEnv(): void {
  process.env.NODE_ENV ||= 'test';
  process.env.TEMPERATURE ||= '0';
  process.env.LLM_TEMPERATURE ||= '0';
  process.env.OPENROUTER_TEMPERATURE ||= '0';
}

function redactSecrets(input: string): string {
  let out = input;

  out = out.replace(/\bsk-or-v1-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_OPENROUTER_KEY]');
  out = out.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_API_KEY]');
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi, 'Bearer [REDACTED_TOKEN]');
  out = out.replace(
    /(["']?(?:api[_-]?key|openrouter[_-]?api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi,
    '$1[REDACTED]',
  );
  out = out.replace(/(Authorization\s*:\s*)[^\n\r]+/gi, '$1[REDACTED]');
  out = out.replace(/(OPENROUTER_API_KEY\s*=\s*)[^\s]+/gi, '$1[REDACTED]');

  return out;
}

function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (/api[_-]?key|token|secret|password|authorization/i.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = toJsonSafe(val);
      }
    }
    return result;
  }
  return value;
}

function jsonLine(value: unknown): string {
  return `${JSON.stringify(toJsonSafe(value))}\n`;
}

function compact(value: string, max = 240): string {
  const clean = redactSecrets(value).replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function stringifyUnknown(value: unknown, max = 1000): string {
  try {
    return compact(JSON.stringify(toJsonSafe(value)), max);
  } catch {
    return compact(String(value), max);
  }
}

function messageContentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const record = part as Record<string, unknown>;
          if (typeof record.text === 'string') return record.text;
          if (typeof record.content === 'string') return record.content;
          return JSON.stringify(toJsonSafe(record));
        }
        return String(part ?? '');
      })
      .join('');
  }
  if (content == null) return '';
  return String(content);
}

function getMessageType(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const record = message as Record<string, unknown>;

  const directType = record.type;
  if (typeof directType === 'string') return directType.toLowerCase();

  const lcKwargs = record.kwargs;
  if (lcKwargs && typeof lcKwargs === 'object') {
    const type = (lcKwargs as Record<string, unknown>).type;
    if (typeof type === 'string') return type.toLowerCase();
  }

  const constructorName = (message as { constructor?: { name?: string } }).constructor?.name;
  return constructorName ? constructorName.toLowerCase() : '';
}

function extractMessageContent(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const record = message as Record<string, unknown>;

  if ('content' in record) return messageContentToString(record.content);

  const kwargs = record.kwargs;
  if (kwargs && typeof kwargs === 'object' && 'content' in kwargs) {
    return messageContentToString((kwargs as Record<string, unknown>).content);
  }

  return '';
}

function isAssistantLikeMessage(message: unknown): boolean {
  const type = getMessageType(message);
  if (!type) return true;
  return (
    type.includes('ai') ||
    type.includes('assistant') ||
    type.includes('chat') ||
    type.includes('constructor')
  );
}

function isToolLikeMessage(message: unknown): boolean {
  const type = getMessageType(message);
  return type.includes('tool') || type.includes('function');
}

function extractFinalAnswerFromMessages(
  messages: unknown,
  fallback: string,
): {
  final: string;
  candidate: string;
  messageCount: number | null;
} {
  if (!Array.isArray(messages)) {
    const cleanFallback = compactFinalAnswer(fallback);
    return { final: cleanFallback, candidate: cleanFallback, messageCount: null };
  }

  const reversed = [...messages].reverse();
  const candidates: string[] = [];

  for (const message of reversed) {
    if (isToolLikeMessage(message)) continue;
    if (!isAssistantLikeMessage(message)) continue;

    const content = extractMessageContent(message).trim();
    if (!content) continue;
    candidates.push(content);
  }

  const candidate = candidates[0] || fallback;
  const final = compactFinalAnswer(candidate || fallback);

  return {
    final,
    candidate: compact(candidate, 2000),
    messageCount: messages.length,
  };
}

function compactFinalAnswer(answer: string): string {
  return redactSecrets(answer)
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function collectSqlCandidates(value: unknown): string[] {
  const found = new Set<string>();

  function visit(input: unknown): void {
    if (input == null) return;

    if (typeof input === 'string') {
      const trimmed = input.trim();

      if (/^(with|select|describe|show|pragma|explain)\b/i.test(trimmed)) {
        found.add(trimmed);
      }

      const selectMatches = trimmed.match(/\b(?:with|select)\b[\s\S]{0,2000}?(?:;|$)/gi);
      for (const match of selectMatches || []) {
        if (/\bfrom\b/i.test(match) || /\bselect\b/i.test(match)) {
          found.add(match.trim());
        }
      }

      try {
        const parsed = JSON.parse(input);
        if (parsed !== input) visit(parsed);
      } catch {
        // Ignore non-JSON strings.
      }

      return;
    }

    if (Array.isArray(input)) {
      for (const item of input) visit(item);
      return;
    }

    if (typeof input === 'object') {
      for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
        if (/sql|query|statement/i.test(key)) visit(val);
        else if (typeof val === 'object') visit(val);
      }
    }
  }

  visit(value);
  return [...found].map((sql) => compact(sql, 2000));
}

function classifyToolOutput(
  name: string,
  output: string,
): {
  validation?: string;
  executionSummary?: string;
} {
  const n = name.toLowerCase();
  const clean = compact(output, 500);

  if (n.includes('check') || n.includes('valid')) {
    return { validation: clean };
  }

  if (n.includes('query') || n.includes('db') || n.includes('sql')) {
    return { executionSummary: clean };
  }

  return {};
}

function canonicalToString(canonical: ExpectedAnswer['canonical']): string {
  if (typeof canonical === 'string') return canonical;
  if (typeof canonical === 'number') return String(canonical);
  return canonical.join(', ');
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function answerMatchesEntity(normalizedAnswer: string, expected: ExpectedAnswer): boolean {
  if (!expected.entity) return true;
  const candidates = [expected.entity, ...(expected.aliases ?? [])];
  return candidates.some((e) => normalizedAnswer.includes(normalizeText(e)));
}

function answerMatchesValue(
  answer: string,
  expected: ExpectedAnswer,
  validation: Question['validation'],
): boolean {
  if (expected.value == null) return true;
  const expectedStr = String(expected.value);
  const expectedNum = Number(expected.value);

  if (validation.mode === 'numeric_tolerance') {
    const tolerance = validation.tolerance ?? 0.1;
    const answerNums = answer.match(/\d+\.?\d*/g) ?? [];
    return answerNums.some((n) => Math.abs(Number.parseFloat(n) - expectedNum) <= tolerance);
  }

  if (validation.mode === 'numeric_exact') {
    const answerNumeric = normalizeNumeric(answer);
    const expectedNumeric = normalizeNumeric(expectedStr);
    return answerNumeric.includes(expectedNumeric);
  }

  const answerNumeric = normalizeNumeric(answer);
  const expectedNumeric = normalizeNumeric(expectedStr);
  if (answerNumeric.includes(expectedNumeric)) return true;

  if (expected.acceptedAnswers?.length) {
    const normalizedAnswer = normalizeText(answer);
    return expected.acceptedAnswers.some((a) =>
      normalizedAnswer.includes(normalizeText(String(a))),
    );
  }

  return false;
}

function evaluateAnswer(params: {
  question: Question;
  answer: string;
  toolCalls: number;
  timeout: boolean;
  error?: string;
  recursionLimitHit: boolean;
}): RunTrace['evaluator'] {
  const { question, answer, toolCalls, timeout, error, recursionLimitHit } = params;
  const expectedStr = canonicalToString(question.expected.canonical);
  const normalizedActual = normalizeText(answer);
  const normalizedExpected = normalizeText(expectedStr);
  const duplicate = detectDuplicateFinalAnswer(answer, expectedStr);

  if (timeout) {
    return {
      passed: false,
      verdict: 'Run timed out.',
      failureCategory: 'timeout',
      duplicateFinalAnswer: duplicate.duplicate,
      duplicateEvidence: duplicate.evidence,
      normalizedExpected,
      normalizedActual,
    };
  }

  if (error) {
    const category: FailureCategory = recursionLimitHit ? 'recursion_limit' : 'crash';
    return {
      passed: false,
      verdict: error,
      failureCategory: category,
      duplicateFinalAnswer: duplicate.duplicate,
      duplicateEvidence: duplicate.evidence,
      normalizedExpected,
      normalizedActual,
    };
  }

  if (!answer.trim()) {
    return {
      passed: false,
      verdict: 'Missing final answer.',
      failureCategory: 'missing_final_answer',
      duplicateFinalAnswer: duplicate.duplicate,
      duplicateEvidence: duplicate.evidence,
      normalizedExpected,
      normalizedActual,
    };
  }

  if (toolCalls >= MAX_TOOL_CALLS) {
    return {
      passed: false,
      verdict: `Tool-call count ${toolCalls} reached or exceeded limit ${MAX_TOOL_CALLS}.`,
      failureCategory: 'tool_loop',
      duplicateFinalAnswer: duplicate.duplicate,
      duplicateEvidence: duplicate.evidence,
      normalizedExpected,
      normalizedActual,
    };
  }

  if (duplicate.duplicate) {
    return {
      passed: false,
      verdict: duplicate.evidence || 'Likely duplicate final answer.',
      failureCategory: 'duplicate_final_answer',
      duplicateFinalAnswer: true,
      duplicateEvidence: duplicate.evidence,
      normalizedExpected,
      normalizedActual,
    };
  }

  const lower = answer.toLowerCase();

  if (/recursion limit|graphrecursionerror|without hitting a stop condition/i.test(answer)) {
    return {
      passed: false,
      verdict: 'Graph recursion limit surfaced in answer.',
      failureCategory: 'recursion_limit',
      duplicateFinalAnswer: false,
      normalizedExpected,
      normalizedActual,
    };
  }

  if (/syntax error|parse error/i.test(answer)) {
    return {
      passed: false,
      verdict: 'SQL syntax error surfaced in answer.',
      failureCategory: 'sql_syntax',
      duplicateFinalAnswer: false,
      normalizedExpected,
      normalizedActual,
    };
  }

  if (/does not exist|no such table|no such column|binder error|catalog error/i.test(answer)) {
    return {
      passed: false,
      verdict: 'SQL schema error surfaced in answer.',
      failureCategory: 'sql_schema',
      duplicateFinalAnswer: false,
      normalizedExpected,
      normalizedActual,
    };
  }

  if (question.expectedKind === 'clarification_required') {
    const criteria = question.validation.clarificationCriteria ?? [];
    const hasQuestionMark = /\?/.test(answer);
    const hasClarificationKeywords =
      /\b(clarify|clarification|specific|specify|which|what scope|regular season|playoffs|season|player|team|metric|what do you mean)\b/i.test(
        answer,
      );
    const passed = hasQuestionMark && hasClarificationKeywords;

    return {
      passed,
      verdict: passed
        ? `Asked for clarification.${criteria.length ? ` Criteria: ${criteria.join('; ')}` : ''}`
        : 'Expected a clarification question.',
      failureCategory: passed ? 'pass' : 'no_clarification',
      duplicateFinalAnswer: false,
      normalizedExpected,
      normalizedActual,
    };
  }

  if (question.expectedKind === 'not_available') {
    const passed =
      /\b(not available|do not have|don't have|not in (?:the )?database|cannot find|could not find|no data|no record|does not (?:have|contain))\b/i.test(
        answer,
      );

    return {
      passed,
      verdict: passed
        ? 'Correctly reported unavailable data.'
        : 'Expected unavailable-data response.',
      failureCategory: passed ? 'pass' : 'not_available_expected',
      duplicateFinalAnswer: false,
      normalizedExpected,
      normalizedActual,
    };
  }

  if (question.expectedKind === 'negative_identity_exact') {
    const hasNegation =
      /\b(no|not|does not|doesn't|is not|isn't|cannot|can't|could not|couldn't)\b/i.test(answer);
    const acceptedPhrases = question.expected.acceptedAnswers ?? [
      'no',
      'does not',
      'not found',
      'no player',
    ];
    const hasAccepted = acceptedPhrases.some((p) => lower.includes(String(p).toLowerCase()));
    const passed = hasNegation || hasAccepted;

    return {
      passed,
      verdict: passed
        ? 'Correctly reported negative identity.'
        : 'Expected negative identity response.',
      failureCategory: passed ? 'pass' : 'wrong_answer',
      duplicateFinalAnswer: false,
      normalizedExpected,
      normalizedActual,
    };
  }

  if (question.expectedKind === 'entity_exact') {
    const normalizedAnswer = stripDiacritics(normalizedActual);
    const candidates = [
      question.expected.entity ?? expectedStr,
      ...(question.expected.aliases ?? []),
      ...(question.expected.acceptedAnswers?.map(String) ?? []),
    ].map((c) => stripDiacritics(normalizeText(c)));

    const passed = candidates.some((c) => normalizedAnswer.includes(c));

    return {
      passed,
      verdict: passed
        ? 'Expected entity found.'
        : `Expected entity "${question.expected.entity ?? expectedStr}" not found.`,
      failureCategory: passed
        ? 'pass'
        : lower.includes('not available')
          ? 'refused'
          : 'wrong_answer',
      duplicateFinalAnswer: false,
      normalizedExpected,
      normalizedActual,
    };
  }

  if (
    question.expectedKind === 'numeric_exact' ||
    question.expectedKind === 'numeric_with_tolerance'
  ) {
    const passed = answerMatchesValue(answer, question.expected, question.validation);

    return {
      passed,
      verdict: passed
        ? 'Expected numeric answer found.'
        : `Expected numeric answer ${expectedStr}.`,
      failureCategory: passed
        ? 'pass'
        : lower.includes('not available')
          ? 'refused'
          : 'wrong_answer',
      duplicateFinalAnswer: false,
      normalizedExpected,
      normalizedActual,
    };
  }

  if (question.expectedKind === 'entity_with_value') {
    const entityOk = answerMatchesEntity(normalizedActual, question.expected);
    const valueOk = answerMatchesValue(answer, question.expected, question.validation);
    const passed = entityOk && valueOk;

    return {
      passed,
      verdict: passed
        ? 'Expected entity and value found.'
        : !entityOk && !valueOk
          ? `Expected "${expectedStr}" (entity and value not found).`
          : !entityOk
            ? `Expected entity "${question.expected.entity}" not found.`
            : `Expected value "${question.expected.value}" not found.`,
      failureCategory: passed
        ? 'pass'
        : lower.includes('not available')
          ? 'refused'
          : 'wrong_answer',
      duplicateFinalAnswer: false,
      normalizedExpected,
      normalizedActual,
    };
  }

  if (question.expectedKind === 'comparison') {
    const entityOk = answerMatchesEntity(normalizedActual, question.expected);
    const passed = entityOk;

    return {
      passed,
      verdict: passed
        ? 'Expected comparison winner found.'
        : `Expected comparison winner "${question.expected.entity}" not found.`,
      failureCategory: passed
        ? 'pass'
        : lower.includes('not available')
          ? 'refused'
          : 'wrong_answer',
      duplicateFinalAnswer: false,
      normalizedExpected,
      normalizedActual,
    };
  }

  if (question.expectedKind === 'set_exact') {
    const requiredItems = question.expected.acceptedAnswers?.map(String) ?? [];
    const normalizedAnswer = stripDiacritics(normalizedActual);
    const foundCount = requiredItems.filter((item) =>
      normalizedAnswer.includes(stripDiacritics(normalizeText(item))),
    ).length;
    const passed = foundCount === requiredItems.length;

    return {
      passed,
      verdict: passed
        ? 'All expected set items found.'
        : `Found ${foundCount}/${requiredItems.length} expected set items.`,
      failureCategory: passed ? 'pass' : 'wrong_answer',
      duplicateFinalAnswer: false,
      normalizedExpected,
      normalizedActual,
    };
  }

  const passed = normalizedActual.includes(normalizedExpected);

  return {
    passed,
    verdict: passed
      ? 'Expected answer found.'
      : `Expected answer token "${expectedStr}" not found.`,
    failureCategory: passed ? 'pass' : lower.includes('not available') ? 'refused' : 'wrong_answer',
    duplicateFinalAnswer: false,
    normalizedExpected,
    normalizedActual,
  };
}

function makeRunTrace(params: {
  q: Question;
  runNumber: number;
  model: string;
  suiteStartedAt: number;
}): RunTrace {
  const now = new Date();
  const runId = `${params.q.id}-r${params.runNumber}-${now.getTime()}`;
  return {
    runId,
    threadId: `iterate-${runId}`,
    questionId: params.q.id,
    question: params.q.q,
    expected: canonicalToString(params.q.expected.canonical),
    expectedKind: params.q.expectedKind,
    tier: params.q.tier,
    model: params.model,
    modelParams: {
      NODE_ENV: process.env.NODE_ENV,
      TEMPERATURE: process.env.TEMPERATURE,
      LLM_TEMPERATURE: process.env.LLM_TEMPERATURE,
      OPENROUTER_TEMPERATURE: process.env.OPENROUTER_TEMPERATURE,
    },
    graph: {
      recursionLimit: process.env.LANGGRAPH_RECURSION_LIMIT
        ? Number(process.env.LANGGRAPH_RECURSION_LIMIT)
        : null,
      maxToolCalls: MAX_TOOL_CALLS,
    },
    timing: {
      startedAt: now.toISOString(),
      runTimeoutMs: RUN_TIMEOUT_MS,
      totalTimeoutMs: TOTAL_TIMEOUT_MS,
    },
    nodeTransitions: [],
    stateKeysChanged: [],
    messagesSeenAtDone: null,
    toolCalls: [],
    sql: {
      generated: [],
      validationResults: [],
      executionResultSummaries: [],
      executionLatenciesMs: [],
    },
    streamedTokenText: '',
    finalAnswerCandidate: '',
    finalAnswerEmitted: '',
    evaluator: {
      passed: false,
      verdict: 'Not evaluated.',
      failureCategory: 'unknown',
      duplicateFinalAnswer: false,
      normalizedExpected: '',
      normalizedActual: '',
    },
    stop: {
      reason: 'unknown',
      recursionLimitHit: false,
      timeout: false,
    },
    tokenUsage: [],
    redaction: {
      applied: true,
    },
  };
}

async function nextWithTimeout<T>(
  iterator: AsyncIterator<T>,
  timeoutMs: number,
): Promise<IteratorResult<T>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<IteratorResult<T>>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('RUN_TIMEOUT_EXCEEDED')), timeoutMs);
  });

  try {
    return await Promise.race([iterator.next(), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function streamQuestion(params: {
  q: Question;
  runNumber: number;
  prompt: string;
  model: string;
  suiteDeadline: number;
  write: (text: string) => void;
}): Promise<RunTrace> {
  const { q, runNumber, prompt, model, suiteDeadline, write } = params;
  const trace = makeRunTrace({
    q,
    runNumber,
    model,
    suiteStartedAt: suiteDeadline - TOTAL_TIMEOUT_MS,
  });

  const runStarted = Date.now();
  const runDeadline = Math.min(runStarted + RUN_TIMEOUT_MS, suiteDeadline);
  const pendingToolStack: number[] = [];

  try {
    resetGraph();

    const gen = streamQuery([new SystemMessage(prompt), new HumanMessage(q.q)], trace.threadId);
    const iterator = gen[Symbol.asyncIterator]();

    while (Date.now() < runDeadline) {
      const remainingMs = Math.max(1, runDeadline - Date.now());
      const next = await nextWithTimeout<StreamEvent>(iterator, remainingMs);

      if (next.done) {
        trace.stop.reason = trace.stop.reason === 'unknown' ? 'stream_done' : trace.stop.reason;
        break;
      }

      const event = next.value;

      switch (event.type) {
        case 'chain_stage': {
          const stage = String(event.stage ?? 'unknown');
          trace.nodeTransitions.push(stage);
          break;
        }

        // NOTE: streaming.ts does not emit state_delta/state_update events; no case needed.

        case 'token': {
          const token = String(event.content ?? '');
          trace.streamedTokenText += token;
          write(token);
          break;
        }

        case 'tool_start': {
          const tool: ToolTrace = {
            index: trace.toolCalls.length,
            name: String(event.name ?? 'unknown_tool'),
            input: toJsonSafe(event.input),
            inputSummary: stringifyUnknown(event.input, 500),
            sqlCandidates: collectSqlCandidates(event.input),
            startedAt: new Date().toISOString(),
          };

          pendingToolStack.push(tool.index);
          trace.toolCalls.push(tool);
          trace.sql.generated.push(...tool.sqlCandidates);

          write(`\n${TAB}→ 🔧 ${tool.name}`);
          if (tool.sqlCandidates.length > 0) {
            write(`\n${TAB}${compact(tool.sqlCandidates[0], 160)}`);
          }
          break;
        }

        case 'tool_end': {
          const output = String(event.output ?? '');
          const toolIndex = pendingToolStack.pop();
          const tool =
            toolIndex == null
              ? undefined
              : trace.toolCalls.find((candidate) => candidate.index === toolIndex);

          if (tool) {
            tool.endedAt = new Date().toISOString();
            tool.latencyMs = Date.parse(tool.endedAt) - Date.parse(tool.startedAt);
            tool.outputSummary = compact(output, 1000);
            tool.sqlCandidates.push(...collectSqlCandidates(output));

            const classified = classifyToolOutput(tool.name, output);
            if (classified.validation) trace.sql.validationResults.push(classified.validation);
            if (classified.executionSummary) {
              trace.sql.executionResultSummaries.push(classified.executionSummary);
              if (typeof tool.latencyMs === 'number')
                trace.sql.executionLatenciesMs.push(tool.latencyMs);
            }

            for (const sql of collectSqlCandidates(output)) trace.sql.generated.push(sql);
          }

          write(` ✅\n${TAB}${compact(output, 140)}`);
          break;
        }

        case 'tool_error': {
          const error = String(event.error ?? 'unknown tool error');
          const toolIndex = pendingToolStack.pop();
          const tool =
            toolIndex == null
              ? undefined
              : trace.toolCalls.find((candidate) => candidate.index === toolIndex);

          if (tool) {
            tool.endedAt = new Date().toISOString();
            tool.latencyMs = Date.parse(tool.endedAt) - Date.parse(tool.startedAt);
            tool.error = compact(error, 1000);
          }

          write(` ❌\n${TAB}${compact(error, 140)}`);
          break;
        }

        case 'usage': {
          trace.tokenUsage.push(toJsonSafe(event.usage) as Record<string, unknown>);
          break;
        }

        case 'done': {
          const extracted = extractFinalAnswerFromMessages(event.messages, trace.streamedTokenText);
          trace.messagesSeenAtDone = extracted.messageCount;
          trace.finalAnswerCandidate = extracted.candidate;
          trace.finalAnswerEmitted = extracted.final;
          trace.stop.reason = 'done_event';
          break;
        }

        case 'error': {
          throw new Error(String(event.message ?? 'stream error'));
        }

        default: {
          const evtType = (event as { type?: string }).type;
          if (evtType) trace.nodeTransitions.push(`event:${evtType}`);
          break;
        }
      }

      if (trace.toolCalls.length >= MAX_TOOL_CALLS) {
        trace.stop.reason = 'max_tool_calls';
        break;
      }
    }

    if (Date.now() >= runDeadline && trace.stop.reason === 'unknown') {
      throw new Error('RUN_TIMEOUT_EXCEEDED');
    }

    await iterator.return?.();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    trace.stop.error = compact(message, 1000);
    trace.stop.timeout = /TIMEOUT|TIME_EXCEEDED/i.test(message);
    trace.stop.recursionLimitHit =
      /recursion limit|GraphRecursionError|GRAPH_RECURSION_LIMIT/i.test(message);
    trace.stop.reason = trace.stop.timeout
      ? 'timeout'
      : trace.stop.recursionLimitHit
        ? 'recursion_limit'
        : 'error';

    if (trace.stop.timeout) {
      write('\n[TIMEOUT]');
    } else {
      write(`\n[${compact(message, 120)}]`);
    }
  }

  if (!trace.finalAnswerEmitted) {
    trace.finalAnswerCandidate = compact(trace.streamedTokenText, 2000);
    trace.finalAnswerEmitted = compactFinalAnswer(trace.streamedTokenText);
  }

  if (trace.stop.reason === 'unknown') {
    trace.stop.reason = trace.finalAnswerEmitted
      ? 'final_answer_extracted'
      : 'missing_final_answer';
  }

  trace.sql.generated = [...new Set(trace.sql.generated.map((sql) => compact(sql, 2000)))];

  trace.timing.endedAt = new Date().toISOString();
  trace.timing.latencyMs = Date.parse(trace.timing.endedAt) - Date.parse(trace.timing.startedAt);

  trace.evaluator = evaluateAnswer({
    question: q,
    answer: trace.finalAnswerEmitted,
    toolCalls: trace.toolCalls.length,
    timeout: trace.stop.timeout,
    error: trace.stop.error,
    recursionLimitHit: trace.stop.recursionLimitHit,
  });

  return trace;
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  return `"${redactSecrets(text).replace(/"/g, '""')}"`;
}

function writeFailureCsv(path: string, failures: SuiteSummary['failures']): void {
  const header = [
    'run_id',
    'question_id',
    'question',
    'expected',
    'actual',
    'category',
    'reason',
    'tools',
    'stop_reason',
  ];

  const rows = failures.map((f) =>
    [
      f.runId,
      f.questionId,
      f.question,
      f.expected,
      f.actual,
      f.category,
      f.reason,
      f.tools,
      f.stopReason,
    ]
      .map(csvEscape)
      .join(','),
  );

  writeFileSync(path, `${header.join(',')}\n${rows.join('\n')}\n`);
}

function hasSecret(text: string): boolean {
  return redactSecrets(text) !== text;
}

function scanRepoForSecrets(root: string): Array<{ file: string; finding: string }> {
  const findings: Array<{ file: string; finding: string }> = [];
  const skipDirs = new Set([
    '.git',
    'node_modules',
    '.next',
    'dist',
    'build',
    'coverage',
    '.turbo',
    '.cache',
    '__pycache__',
  ]);

  const allowedExtensions = new Set([
    '',
    '.env',
    '.txt',
    '.log',
    '.json',
    '.jsonl',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.md',
    '.yml',
    '.yaml',
    '.toml',
    '.sh',
  ]);

  function walk(dir: string, depth: number): void {
    if (depth > 8 || findings.length >= 50) return;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = join(dir, entry);
      let st: ReturnType<typeof statSync> | undefined;
      try {
        st = statSync(full);
      } catch {
        continue;
      }

      if (st.isDirectory()) {
        if (skipDirs.has(entry)) continue;
        walk(full, depth + 1);
        continue;
      }

      if (!st.isFile()) continue;
      if (st.size > 2_000_000) continue;

      const ext = extname(entry).toLowerCase();
      const base = basename(entry).toLowerCase();
      if (!allowedExtensions.has(ext) && !base.startsWith('.env')) continue;

      try {
        const text = readFileSync(full, 'utf8');
        if (hasSecret(text)) {
          findings.push({
            file: relative(root, full),
            finding: 'possible secret detected and redacted',
          });
        }
      } catch {
        // Ignore binary/unreadable files.
      }
    }
  }

  walk(root, 0);
  return findings;
}

async function main(): Promise<void> {
  ensureDeterministicEnv();

  const suiteStartedAt = new Date();
  const suiteStartMs = Date.now();
  const suiteDeadline = suiteStartMs + TOTAL_TIMEOUT_MS;
  const runDir = join(LOG_ROOT, timestampForPath(suiteStartedAt));

  mkdirSync(runDir, { recursive: true });

  const rawLogPath = join(runDir, 'raw.log');
  const jsonlPath = join(runDir, 'observability.jsonl');
  const summaryPath = join(runDir, 'summary.json');
  const failuresCsvPath = join(runDir, 'failures.csv');

  const write = (text: string): void => {
    const clean = redactSecrets(text);
    process.stdout.write(clean);
    appendFileSync(rawLogPath, clean);
  };

  const writeLine = (text = ''): void => write(`${text}\n`);

  let dbInitialized = false;
  let totalPassed = 0;
  let totalAttempted = 0;
  const failures: SuiteSummary['failures'] = [];

  try {
    writeLine(`run_dir: ${runDir}`);
    writeLine('security: terminal and file logs are redacted');

    if (SECRET_SCAN) {
      const secretFindings = scanRepoForSecrets(process.cwd());
      if (secretFindings.length > 0) {
        writeLine(
          `security: ${secretFindings.length} possible secret-bearing file(s) found; values not printed`,
        );
        appendFileSync(join(runDir, 'secret-scan.json'), jsonLine(secretFindings));
      } else {
        writeLine('security: no obvious secrets found in scanned text files');
      }
    }

    await initDb();
    dbInitialized = true;

    const basePrompt = await buildSystemPrompt();
    const prompt = `${basePrompt.trim()}\n\n${TEST_MODE_PROMPT_SUFFIX}\n`;
    const modelId = getModel();

    writeLine();
    writeLine(`┌─ ${modelId} — ${RUNS_PER_QUESTION} runs × ${ACTIVE_QUESTIONS.length} questions`);
    writeLine(`├─ timeout: ${TOTAL_TIMEOUT_MS / 1000}s wall, ${RUN_TIMEOUT_MS / 1000}s per run`);
    writeLine(`├─ max tool calls per run: ${MAX_TOOL_CALLS}`);
    writeLine(`└${'─'.repeat(70)}`);
    writeLine();

    for (const q of ACTIVE_QUESTIONS) {
      if (Date.now() >= suiteDeadline) {
        writeLine(`⏰ Wall timeout — stopping before ${q.id}`);
        break;
      }

      writeLine();
      writeLine(`══════════ ${q.id} (${q.tier}): ${q.q} ══════════`);
      writeLine();

      let questionPassed = 0;
      let questionRuns = 0;

      for (
        let runNumber = 1;
        runNumber <= RUNS_PER_QUESTION && Date.now() < suiteDeadline;
        runNumber++
      ) {
        questionRuns++;
        writeLine(`── run ${runNumber}/${RUNS_PER_QUESTION} ──`);

        const trace = await streamQuestion({
          q,
          runNumber,
          prompt,
          model: modelId,
          suiteDeadline,
          write,
        });

        totalAttempted++;

        if (trace.evaluator.passed) {
          totalPassed++;
          questionPassed++;
        } else {
          failures.push({
            runId: trace.runId,
            questionId: trace.questionId,
            question: trace.question,
            expected: trace.expected,
            actual: compact(trace.finalAnswerEmitted, 500),
            category: trace.evaluator.failureCategory,
            reason: trace.evaluator.verdict,
            tools: trace.toolCalls.length,
            stopReason: trace.stop.reason,
          });
        }

        appendFileSync(jsonlPath, jsonLine(trace));

        const status = trace.evaluator.passed
          ? '✅ PASS'
          : `❌ FAIL [${trace.evaluator.failureCategory}]`;
        writeLine();
        writeLine(
          `${status} tools:${trace.toolCalls.length} stop:${trace.stop.reason} latency:${trace.timing.latencyMs ?? 0}ms`,
        );

        if (!trace.evaluator.passed) {
          writeLine(`${TAB}reason: ${compact(trace.evaluator.verdict, 240)}`);
          writeLine(`${TAB}actual: ${compact(trace.finalAnswerEmitted, 240)}`);
        }

        writeLine();
      }

      writeLine(`── ${q.id} result: ${questionPassed}/${questionRuns} pass ──`);
      writeLine();
    }

    const elapsedSec = Math.round((Date.now() - suiteStartMs) / 1000);
    const totalExpected = ACTIVE_QUESTIONS.length * RUNS_PER_QUESTION;
    const allPassed = totalAttempted === totalExpected && totalPassed === totalAttempted;

    const summary: SuiteSummary = {
      startedAt: suiteStartedAt.toISOString(),
      endedAt: new Date().toISOString(),
      elapsedSec,
      model: getModel(),
      totalPassed,
      totalAttempted,
      totalExpected,
      allPassed,
      runDir,
      failures,
    };

    writeFileSync(summaryPath, `${JSON.stringify(toJsonSafe(summary), null, 2)}\n`);
    writeFailureCsv(failuresCsvPath, failures);

    writeLine();
    writeLine('═'.repeat(70));
    writeLine(`RESULT: ${totalPassed}/${totalAttempted} PASS in ${elapsedSec}s`);
    writeLine(`EXPECTED RUNS: ${totalExpected}`);
    writeLine(`ALL PASSED: ${allPassed ? 'yes' : 'no'}`);
    writeLine(`RAW LOG: ${rawLogPath}`);
    writeLine(`JSONL TRACE: ${jsonlPath}`);
    writeLine(`SUMMARY: ${summaryPath}`);
    writeLine(`FAILURES CSV: ${failuresCsvPath}`);
    writeLine('═'.repeat(70));
    writeLine();

    if (!allPassed && EXIT_NONZERO_ON_FAIL) {
      process.exitCode = 1;
    }
  } catch (e) {
    const message = e instanceof Error ? e.stack || e.message : String(e);
    writeLine();
    writeLine(`FATAL: ${compact(message, 2000)}`);
    process.exitCode = 1;
  } finally {
    if (dbInitialized) {
      try {
        await closeDb();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        appendFileSync(rawLogPath, `closeDb error: ${compact(message, 500)}\n`);
      }
    }
  }
}

void main();
