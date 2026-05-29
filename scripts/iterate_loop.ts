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
 *   bun run src/chatbot/scripts/iterate_loop.ts   (or: bun run chatbot:iterate)
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
import { resetGraph } from '../agent/graph.js';
import { streamQuery } from '../agent/streaming.js';
import { closeDb, initDb } from '../db.js';
import { getModel } from '../openrouter.js';
import { buildSystemPrompt } from '../systemPrompt.js';

const DEFAULT_TOTAL_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_RUN_TIMEOUT_MS = 90 * 1000;
const DEFAULT_RUNS_PER_QUESTION = 3;
const DEFAULT_MAX_TOOL_CALLS = 18;

const TOTAL_TIMEOUT_MS = envInt('TOTAL_TIMEOUT_MS', DEFAULT_TOTAL_TIMEOUT_MS);
const RUN_TIMEOUT_MS = envInt('RUN_TIMEOUT_MS', DEFAULT_RUN_TIMEOUT_MS);
const RUNS_PER_QUESTION = envInt('RUNS_PER_QUESTION', DEFAULT_RUNS_PER_QUESTION);
const MAX_TOOL_CALLS = envInt('MAX_TOOL_CALLS', DEFAULT_MAX_TOOL_CALLS);
const EXIT_NONZERO_ON_FAIL = envBool('EXIT_NONZERO_ON_FAIL', true);
const SECRET_SCAN = envBool('SECRET_SCAN', true);
const LOG_ROOT = process.env.LOG_DIR || '.runs/nba-chatbot';

const TAB = '  ';

type ExpectedKind = 'contains' | 'numeric_contains' | 'clarification' | 'not_available';

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

interface Question {
  id: string;
  q: string;
  expected: string;
  expectedKind: ExpectedKind;
  tier: string;
}

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

interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

const QUESTIONS: Question[] = [
  {
    id: 'new-001',
    q: 'Who scored the most total points in the 2022-23 NBA regular season?',
    expected: 'Jayson Tatum',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-002',
    q: 'Who had the most total rebounds in the 2018-19 NBA regular season?',
    expected: 'rebounds',
    expectedKind: 'contains',
    tier: 'data_quality',
  },
  {
    id: 'new-003',
    q: 'Who had the most total assists in the 2016-17 NBA regular season?',
    expected: 'James Harden',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-004',
    q: 'Who led the NBA in regular season blocks in 2021-22?',
    expected: 'blocks',
    expectedKind: 'contains',
    tier: 'data_quality',
  },
  {
    id: 'new-005',
    q: 'Who made the most three-pointers in the 2020-21 NBA regular season?',
    expected: 'Curry',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-006',
    q: "What was Giannis Antetokounmpo's points per game in the 2019-20 season?",
    expected: 'Giannis',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-007',
    q: "What was Joel Embiid's points per game in the 2022-23 season?",
    expected: 'Embiid',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-008',
    q: 'What regular season did Andre Drummond lead the NBA in rebounds per game?',
    expected: 'Drummond',
    expectedKind: 'contains',
    tier: 'data_quality',
  },
  {
    id: 'new-009',
    q: 'Who averaged the most assists per game in the 2014-15 NBA season?',
    expected: 'Rondo',
    expectedKind: 'contains',
    tier: 'data_quality',
  },
  {
    id: 'new-010',
    q: 'How many regular season career steals does Chris Paul have?',
    expected: 'Chris Paul',
    expectedKind: 'contains',
    tier: 'career_leaders',
  },
  {
    id: 'new-011',
    q: 'Who averaged the most blocks per game in the 2019-20 NBA season?',
    expected: 'Whiteside',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-012',
    q: "What was Damian Lillard's points per game in the 2022-23 season?",
    expected: 'Lillard',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-013',
    q: "What was Shai Gilgeous-Alexander's points per game in the 2023-24 season?",
    expected: 'Shai',
    expectedKind: 'contains',
    tier: 'data_quality',
  },
  {
    id: 'new-014',
    q: "What was Kevin Durant's points per game in the 2013-14 season?",
    expected: 'Durant',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-015',
    q: "What was Chris Paul's assists per game in the 2007-08 season?",
    expected: 'Chris Paul',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-016',
    q: 'How many total points did Luka Doncic score in the 2023-24 regular season?',
    expected: 'Luka',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-017',
    q: 'How many total points did Jayson Tatum score in the 2022-23 regular season?',
    expected: 'Tatum',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-018',
    q: 'How many total rebounds did Wilt Chamberlain have in the 1961-62 regular season?',
    expected: 'Wilt',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-019',
    q: 'How many three-pointers did Stephen Curry make in the 2015-16 regular season?',
    expected: '402',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-020',
    q: 'How many three-pointers did James Harden make in the 2018-19 regular season?',
    expected: '378',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-021',
    q: 'How many three-pointers did Klay Thompson make in the 2022-23 regular season?',
    expected: '301',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-022',
    q: "What was Nikola Jokic's points per game in the 2020-21 season?",
    expected: 'Nikola',
    expectedKind: 'contains',
    tier: 'data_quality',
  },
  {
    id: 'new-023',
    q: "What was LeBron James's points per game in the 2007-08 season?",
    expected: 'LeBron',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-024',
    q: 'How many regular season career points does Kevin Garnett have?',
    expected: 'Garnett',
    expectedKind: 'contains',
    tier: 'career_leaders',
  },
  {
    id: 'new-025',
    q: "What was Dwight Howard's rebounds per game in the 2010-11 season?",
    expected: 'Howard',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-026',
    q: "What was Anthony Davis's blocks per game in the 2017-18 season?",
    expected: 'Davis',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-027',
    q: "What was Kawhi Leonard's points per game in the 2016-17 season?",
    expected: 'Kawhi',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-028',
    q: 'How many total assists did Trae Young have in the 2021-22 regular season?',
    expected: 'Trae',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-029',
    q: 'How many total rebounds did Rudy Gobert have in the 2020-21 regular season?',
    expected: 'Gobert',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-030',
    q: 'How many total steals did Chris Paul have in the 2008-09 regular season?',
    expected: 'Chris Paul',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-031',
    q: 'How many wins did the Detroit Pistons have in the 2023-24 regular season?',
    expected: 'Detroit',
    expectedKind: 'contains',
    tier: 'team_seasons',
  },
  {
    id: 'new-032',
    q: 'Which team had the best SRS in the 1995-96 season according to the database?',
    expected: 'Chicago',
    expectedKind: 'contains',
    tier: 'data_quality',
  },
  {
    id: 'new-033',
    q: 'How many wins did the 2016-17 Golden State Warriors have?',
    expected: 'Golden State',
    expectedKind: 'contains',
    tier: 'team_seasons',
  },
  {
    id: 'new-034',
    q: 'What was the Milwaukee Bucks win total in the 2019-20 season?',
    expected: 'Bucks',
    expectedKind: 'contains',
    tier: 'data_quality',
  },
  {
    id: 'new-035',
    q: 'What was the Phoenix Suns win total in the 2021-22 season?',
    expected: 'Suns',
    expectedKind: 'contains',
    tier: 'data_quality',
  },
  {
    id: 'new-036',
    q: 'Which team had the most wins in the 2017-18 regular season?',
    expected: 'Nuggets',
    expectedKind: 'contains',
    tier: 'data_quality',
  },
  {
    id: 'new-037',
    q: 'How many wins did the Oklahoma City Thunder have in the 2023-24 regular season?',
    expected: 'Oklahoma City',
    expectedKind: 'contains',
    tier: 'team_seasons',
  },
  {
    id: 'new-038',
    q: 'How many wins did the 2014-15 Atlanta Hawks have?',
    expected: 'Atlanta',
    expectedKind: 'contains',
    tier: 'team_seasons',
  },
  {
    id: 'new-039',
    q: 'Which team had the most regular season wins in the 2012-13 season?',
    expected: 'wins',
    expectedKind: 'contains',
    tier: 'data_quality',
  },
  {
    id: 'new-040',
    q: 'What was the worst regular season record by wins in the 2011-12 lockout season?',
    expected: 'wins',
    expectedKind: 'contains',
    tier: 'data_quality',
  },
  {
    id: 'new-041',
    q: 'How many regular season career points does Luka Doncic have?',
    expected: 'Luka',
    expectedKind: 'contains',
    tier: 'career_leaders',
  },
  {
    id: 'new-042',
    q: 'How many regular season career assists does Chris Paul have?',
    expected: 'Chris Paul',
    expectedKind: 'contains',
    tier: 'career_leaders',
  },
  {
    id: 'new-043',
    q: 'How many regular season career rebounds does Nikola Jokic have?',
    expected: 'Jokic',
    expectedKind: 'contains',
    tier: 'career_leaders',
  },
  {
    id: 'new-044',
    q: 'How many triple-doubles did Russell Westbrook have in the 2020-21 regular season?',
    expected: 'Westbrook',
    expectedKind: 'contains',
    tier: 'games',
  },
  {
    id: 'new-045',
    q: 'How many points did Luka Doncic score in his career-high game?',
    expected: '73',
    expectedKind: 'contains',
    tier: 'games',
  },
  {
    id: 'new-046',
    q: 'How many points did Joel Embiid score in his career-high game?',
    expected: '70',
    expectedKind: 'contains',
    tier: 'games',
  },
  {
    id: 'new-047',
    q: 'How many points did Giannis Antetokounmpo score in his career-high game?',
    expected: '64',
    expectedKind: 'contains',
    tier: 'games',
  },
  {
    id: 'new-048',
    q: 'How many points did Kobe Bryant score in his 81-point game?',
    expected: '81',
    expectedKind: 'contains',
    tier: 'games',
  },
  {
    id: 'new-049',
    q: 'How many points did Donovan Mitchell score in his 71-point game?',
    expected: '71',
    expectedKind: 'contains',
    tier: 'games',
  },
  {
    id: 'new-050',
    q: 'How many points did Damian Lillard score in his 71-point game?',
    expected: '71',
    expectedKind: 'contains',
    tier: 'games',
  },
  {
    id: 'new-051',
    q: 'Who averaged more points per game in the 2022-23 season, Damian Lillard or Shai Gilgeous-Alexander?',
    expected: 'Damian Lillard',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-052',
    q: 'Who had more total rebounds in the 2023-24 season, Nikola Jokic or Anthony Davis?',
    expected: 'Anthony Davis',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-053',
    q: 'Which team won more games in the 2022-23 season, the Denver Nuggets or the Boston Celtics?',
    expected: 'Boston',
    expectedKind: 'contains',
    tier: 'team_seasons',
  },
  {
    id: 'new-054',
    q: 'Who made more three-pointers in the 2015-16 regular season, Stephen Curry or Klay Thompson?',
    expected: 'Stephen Curry',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-055',
    q: 'Who had more total blocks in the 2023-24 regular season, Victor Wembanyama or Brook Lopez?',
    expected: 'Victor Wembanyama',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-056',
    q: 'How many regular season career points does Russell Westbrook have?',
    expected: 'Westbrook',
    expectedKind: 'contains',
    tier: 'career_leaders',
  },
  {
    id: 'new-057',
    q: 'Which team had a better SRS in the 2015-16 season, the Golden State Warriors or the San Antonio Spurs?',
    expected: 'Golden State',
    expectedKind: 'contains',
    tier: 'team_seasons',
  },
  {
    id: 'new-058',
    q: 'Who scored more total points in the 2017-18 regular season, LeBron James or James Harden?',
    expected: 'LeBron',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-059',
    q: 'Who averaged more assists per game in the 2015-16 season, Rajon Rondo or Russell Westbrook?',
    expected: 'Rajon Rondo',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-060',
    q: 'Who has more NBA MVP awards, Michael Jordan or LeBron James?',
    expected: 'Michael Jordan',
    expectedKind: 'contains',
    tier: 'awards',
  },
  {
    id: 'new-061',
    q: 'Who won the NBA MVP award in the 2022-23 season?',
    expected: 'Joel Embiid',
    expectedKind: 'contains',
    tier: 'awards',
  },
  {
    id: 'new-062',
    q: 'Who won NBA Rookie of the Year in the 2021-22 season?',
    expected: 'Scottie Barnes',
    expectedKind: 'contains',
    tier: 'awards',
  },
  {
    id: 'new-063',
    q: 'Who won NBA Defensive Player of the Year in the 2017-18 season?',
    expected: 'Rudy Gobert',
    expectedKind: 'contains',
    tier: 'awards',
  },
  {
    id: 'new-064',
    q: 'Who won NBA MVP in the 2014-15 season?',
    expected: 'Stephen Curry',
    expectedKind: 'contains',
    tier: 'awards',
  },
  {
    id: 'new-065',
    q: 'Who won NBA MVP in the 2011-12 season?',
    expected: 'LeBron James',
    expectedKind: 'contains',
    tier: 'awards',
  },
  {
    id: 'new-066',
    q: 'Who won NBA MVP in the 2010-11 season?',
    expected: 'Derrick Rose',
    expectedKind: 'contains',
    tier: 'awards',
  },
  {
    id: 'new-067',
    q: 'Who won NBA MVP in the 2000-01 season?',
    expected: 'Allen Iverson',
    expectedKind: 'contains',
    tier: 'awards',
  },
  {
    id: 'new-068',
    q: 'Who won NBA Rookie of the Year in the 2003-04 season?',
    expected: 'LeBron James',
    expectedKind: 'contains',
    tier: 'awards',
  },
  {
    id: 'new-069',
    q: 'How many NBA MVP awards has LeBron James won?',
    expected: '4',
    expectedKind: 'contains',
    tier: 'awards',
  },
  {
    id: 'new-070',
    q: 'Who won NBA Defensive Player of the Year in the 2020-21 season?',
    expected: 'Rudy Gobert',
    expectedKind: 'contains',
    tier: 'awards',
  },
  {
    id: 'new-071',
    q: 'What draft position was Stephen Curry selected in the 2009 NBA draft?',
    expected: '7',
    expectedKind: 'contains',
    tier: 'draft',
  },
  {
    id: 'new-072',
    q: 'What year was Giannis Antetokounmpo drafted?',
    expected: '2013',
    expectedKind: 'contains',
    tier: 'draft',
  },
  {
    id: 'new-073',
    q: 'Which team drafted Kevin Durant in the 2007 NBA draft?',
    expected: 'Seattle',
    expectedKind: 'contains',
    tier: 'draft',
  },
  {
    id: 'new-074',
    q: 'Who was selected second overall in the 2022 NBA draft?',
    expected: 'Chet Holmgren',
    expectedKind: 'contains',
    tier: 'draft',
  },
  {
    id: 'new-075',
    q: 'Who was the first overall pick in the 2022 NBA draft?',
    expected: 'Paolo Banchero',
    expectedKind: 'contains',
    tier: 'draft',
  },
  {
    id: 'new-076',
    q: 'How many three-point attempts did Stephen Curry take in the 2015-16 regular season?',
    expected: '886',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-077',
    q: 'How many regular season career points does James Harden have?',
    expected: 'Harden',
    expectedKind: 'contains',
    tier: 'career_leaders',
  },
  {
    id: 'new-078',
    q: 'How many regular season career points does Giannis Antetokounmpo have?',
    expected: 'Giannis',
    expectedKind: 'contains',
    tier: 'career_leaders',
  },
  {
    id: 'new-079',
    q: "What percentage of LeBron James's made shots were at the rim in the 2023-24 season?",
    expected: 'LeBron',
    expectedKind: 'contains',
    tier: 'shot_charts',
  },
  {
    id: 'new-080',
    q: 'How many corner three-pointers did Klay Thompson attempt in the 2015-16 season?',
    expected: 'Klay',
    expectedKind: 'contains',
    tier: 'shot_charts',
  },
  {
    id: 'new-081',
    q: 'Who won the 2024 NBA Finals MVP?',
    expected: 'not available',
    expectedKind: 'not_available',
    tier: 'data_quality',
  },
  {
    id: 'new-082',
    q: 'Who won the NBA championship in 2023?',
    expected: 'not available',
    expectedKind: 'not_available',
    tier: 'data_quality',
  },
  {
    id: 'new-083',
    q: 'How many All-Star selections does LeBron James have?',
    expected: '22',
    expectedKind: 'contains',
    tier: 'data_quality',
  },
  {
    id: 'new-084',
    q: 'How many regular season career points does Bob Cousy have?',
    expected: 'Bob Cousy',
    expectedKind: 'contains',
    tier: 'career_leaders',
  },
  {
    id: 'new-085',
    q: 'How many regular season career points does Jerry West have?',
    expected: 'Jerry West',
    expectedKind: 'contains',
    tier: 'career_leaders',
  },
  {
    id: 'new-086',
    q: 'How many MVP awards did Bill Russell win?',
    expected: '5',
    expectedKind: 'contains',
    tier: 'awards',
  },
  {
    id: 'new-087',
    q: 'Does the database have a player named John Smith?',
    expected: 'not',
    expectedKind: 'contains',
    tier: 'identity',
  },
  {
    id: 'new-088',
    q: 'How many regular season career points does Dwyane Wade have?',
    expected: 'Wade',
    expectedKind: 'contains',
    tier: 'career_leaders',
  },
  {
    id: 'new-089',
    q: 'How many points per game did Michael Jordan average in the 1994-95 regular season?',
    expected: 'Jordan',
    expectedKind: 'contains',
    tier: 'season_leaders',
  },
  {
    id: 'new-090',
    q: "How many regular season career points does Shaquille O'Neal have?",
    expected: 'Shaq',
    expectedKind: 'contains',
    tier: 'career_leaders',
  },
  {
    id: 'new-091',
    q: 'Who is the best player in the NBA?',
    expected: 'clarification',
    expectedKind: 'clarification',
    tier: 'data_quality',
  },
  {
    id: 'new-092',
    q: 'Which team is better?',
    expected: 'clarification',
    expectedKind: 'clarification',
    tier: 'data_quality',
  },
  {
    id: 'new-093',
    q: 'Tell me about LeBron.',
    expected: 'clarification',
    expectedKind: 'clarification',
    tier: 'data_quality',
  },
  {
    id: 'new-094',
    q: 'What was the best season ever?',
    expected: 'clarification',
    expectedKind: 'clarification',
    tier: 'data_quality',
  },
  {
    id: 'new-095',
    q: 'How good was Jordan?',
    expected: 'clarification',
    expectedKind: 'clarification',
    tier: 'data_quality',
  },
  {
    id: 'new-096',
    q: 'How many points did LeBron James score in the 2023 playoffs?',
    expected: 'LeBron',
    expectedKind: 'contains',
    tier: 'games',
  },
  {
    id: 'new-097',
    q: 'Who won the NBA MVP award in the 2018-19 season?',
    expected: 'Giannis Antetokounmpo',
    expectedKind: 'contains',
    tier: 'awards',
  },
  {
    id: 'new-098',
    q: "What is Nikola Jokic's career regular season assist total?",
    expected: 'Jokic',
    expectedKind: 'contains',
    tier: 'career_leaders',
  },
  {
    id: 'new-099',
    q: "What is Michael Jordan's career regular season free throw percentage?",
    expected: 'Jordan',
    expectedKind: 'contains',
    tier: 'career_leaders',
  },
  {
    id: 'new-100',
    q: "What is LeBron James's career regular season field goal percentage?",
    expected: 'LeBron',
    expectedKind: 'contains',
    tier: 'career_leaders',
  },
];

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

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9.'"-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNumeric(value: string): string {
  return value.replace(/[^\d.-]+/g, '');
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

function detectDuplicateFinalAnswer(
  answer: string,
  expected: string,
): {
  duplicate: boolean;
  evidence?: string;
} {
  const normalized = normalizeText(answer);
  if (!normalized) return { duplicate: false };

  const expectedNorm = normalizeText(expected);
  if (expectedNorm && expectedNorm !== 'clarification' && expectedNorm !== 'not available') {
    const expectedMentions = countOccurrences(normalized, expectedNorm);
    if (expectedMentions >= 4) {
      return {
        duplicate: true,
        evidence: `expected token "${expected}" appears ${expectedMentions} times`,
      };
    }
  }

  const sentences = answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => normalizeText(s))
    .filter((s) => s.length >= 30);

  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    const count = (counts.get(sentence) || 0) + 1;
    counts.set(sentence, count);
    if (count >= 3) {
      return {
        duplicate: true,
        evidence: `sentence repeated ${count} times: ${sentence.slice(0, 100)}`,
      };
    }
  }

  const paragraphs = answer
    .split(/\n{2,}/)
    .map((p) => normalizeText(p))
    .filter((p) => p.length >= 40);

  const paragraphCounts = new Map<string, number>();
  for (const paragraph of paragraphs) {
    const count = (paragraphCounts.get(paragraph) || 0) + 1;
    paragraphCounts.set(paragraph, count);
    if (count >= 2) {
      return {
        duplicate: true,
        evidence: `paragraph repeated ${count} times: ${paragraph.slice(0, 100)}`,
      };
    }
  }

  return { duplicate: false };
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) return count;
    count++;
    index = found + needle.length;
  }
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
  const normalizedActual = normalizeText(answer);
  const normalizedExpected = normalizeText(question.expected);
  const duplicate = detectDuplicateFinalAnswer(answer, question.expected);

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

  if (question.expectedKind === 'clarification') {
    const passed =
      /\b(clarify|clarification|specific|specify|which|what scope|regular season|playoffs|season|player|team)\b/i.test(
        answer,
      ) && /\?/.test(answer);

    return {
      passed,
      verdict: passed ? 'Asked for clarification.' : 'Expected a clarification question.',
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

  if (question.expectedKind === 'numeric_contains') {
    const actualNumeric = normalizeNumeric(answer);
    const expectedNumeric = normalizeNumeric(question.expected);
    const passed = actualNumeric.includes(expectedNumeric);

    return {
      passed,
      verdict: passed
        ? 'Expected numeric answer found.'
        : `Expected numeric answer ${question.expected}.`,
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

  const passed = normalizedActual.includes(normalizedExpected);

  return {
    passed,
    verdict: passed
      ? 'Expected answer found.'
      : `Expected answer token "${question.expected}" not found.`,
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
    expected: params.q.expected,
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
          if (event.type) trace.nodeTransitions.push(`event:${event.type}`);
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
    writeLine(`┌─ ${modelId} — ${RUNS_PER_QUESTION} runs × ${QUESTIONS.length} questions`);
    writeLine(`├─ timeout: ${TOTAL_TIMEOUT_MS / 1000}s wall, ${RUN_TIMEOUT_MS / 1000}s per run`);
    writeLine(`├─ max tool calls per run: ${MAX_TOOL_CALLS}`);
    writeLine(`└${'─'.repeat(70)}`);
    writeLine();

    for (const q of QUESTIONS) {
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
    const totalExpected = QUESTIONS.length * RUNS_PER_QUESTION;
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

main();
