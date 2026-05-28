#!/usr/bin/env bun
/**
 * Multi-Model NBA Chatbot Evaluation Harness
 *
 * Tests multiple LLM models against the question matrix and iterates fixes
 * until all models return accurate results.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-v1-... bun run scripts/chatbot-eval-multi-model.ts
 *
 * Environment:
 *   OPENROUTER_API_KEY  Required
 *   NBA_DUCKDB_PATH     Optional (default: data/nba.duckdb)
 *   ITERATION_MAX       Optional (default: 5)
 *   PARALLEL_MODELS     Optional (default: true)
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getChatbotGraph, resetGraph } from '../src/chatbot/agent/graph.js';
import { closeDb, initDb } from '../src/chatbot/db.js';
import { type EvalQuestion, QUESTION_MATRIX } from '../src/chatbot/eval/question-matrix.js';
import { setModel } from '../src/chatbot/openrouter.js';
import { buildSystemPrompt } from '../src/chatbot/systemPrompt.js';

interface TestResult {
  questionId: string;
  model: string;
  question: string;
  answer: string;
  passed: boolean;
  failureType:
    | 'PASS'
    | 'WRONG_ANSWER'
    | 'SQL_ERROR'
    | 'LOOP'
    | 'TIMEOUT'
    | 'CLARIFICATION'
    | 'DATA_UNAVAILABLE';
  reasons: string[];
  toolCalls: number;
  durationMs: number;
  error?: string;
}

interface IterationResult {
  iteration: number;
  model: string;
  results: TestResult[];
  passCount: number;
  failCount: number;
  failurePatterns: Record<string, string[]>;
}

const MODELS = [
  'stepfun/step-3.5-flash',
  'google/gemini-2.5-flash-lite',
  'openai/gpt-oss-120b',
  'tencent/hy3-preview',
  'deepseek/deepseek-v4-flash',
];

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
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

function normalizeAnswer(answer: string): string {
  return answer
    .toLowerCase()
    .replace(/[^a-z0-9\s.,'-]/g, '')
    .trim();
}

function checkAnswer(
  answer: string,
  question: EvalQuestion,
): { passed: boolean; failureType: TestResult['failureType']; reasons: string[] } {
  const normalized = normalizeAnswer(answer);
  const reasons: string[] = [];

  // Check for clarification requests
  if (question.expectedClarification) {
    const hasClarification =
      normalized.includes('clarif') ||
      normalized.includes('need more') ||
      normalized.includes('could you specify') ||
      normalized.includes('what do you mean');

    if (hasClarification) {
      return { passed: true, failureType: 'PASS', reasons: ['asked for clarification'] };
    }
    return {
      passed: false,
      failureType: 'CLARIFICATION',
      reasons: ['failed to ask for clarification on vague question'],
    };
  }

  // Check for data not available
  if (question.expectedAnswer === 'DATA_NOT_AVAILABLE') {
    const hasUnavailable =
      normalized.includes('not available') ||
      normalized.includes('do not have') ||
      normalized.includes('cannot find') ||
      normalized.includes('not in the database');

    if (hasUnavailable) {
      return {
        passed: true,
        failureType: 'PASS',
        reasons: ['correctly stated data not available'],
      };
    }
    return {
      passed: false,
      failureType: 'DATA_UNAVAILABLE',
      reasons: ['should have stated data not available'],
    };
  }

  // Check for empty answer
  if (answer.trim().length === 0) {
    return { passed: false, failureType: 'WRONG_ANSWER', reasons: ['empty answer'] };
  }

  // Check for SQL errors in answer
  if (normalized.includes('sql error') || normalized.includes('validation failed')) {
    return { passed: false, failureType: 'SQL_ERROR', reasons: ['answer contains SQL error'] };
  }

  // Check for raw SQL leak
  if (/\bselect\b|\bwith\b/.test(normalized) && normalized.includes('from')) {
    return { passed: false, failureType: 'SQL_ERROR', reasons: ['answer leaked raw SQL'] };
  }

  // Check answer against expected
  if (typeof question.expectedAnswer === 'string') {
    const expectedNormalized = normalizeAnswer(question.expectedAnswer);
    if (normalized.includes(expectedNormalized)) {
      return { passed: true, failureType: 'PASS', reasons: ['answer contains expected value'] };
    }
    reasons.push(`expected "${question.expectedAnswer}" not found in answer`);
  } else if (typeof question.expectedAnswer === 'number') {
    const answerNum = parseFloat(answer.replace(/[^0-9.]/g, ''));
    if (!isNaN(answerNum)) {
      if (question.tolerance === 'exact') {
        if (answerNum === question.expectedAnswer) {
          return { passed: true, failureType: 'PASS', reasons: ['exact numeric match'] };
        }
        reasons.push(`expected ${question.expectedAnswer}, got ${answerNum}`);
      }
    } else {
      reasons.push('could not extract number from answer');
    }
  } else if (Array.isArray(question.expectedAnswer)) {
    const foundItems = question.expectedAnswer.filter((item) =>
      normalized.includes(normalizeAnswer(item)),
    );
    if (foundItems.length === question.expectedAnswer.length) {
      return { passed: true, failureType: 'PASS', reasons: ['all expected items found'] };
    }
    reasons.push(
      `only found ${foundItems.length}/${question.expectedAnswer.length} expected items`,
    );
  }

  return { passed: false, failureType: 'WRONG_ANSWER', reasons };
}

async function runTestForModel(
  model: string,
  question: EvalQuestion,
  systemPrompt: string,
  iteration: number,
): Promise<TestResult> {
  setModel(model);
  resetGraph();

  const startTime = Date.now();
  let toolCalls = 0;

  try {
    const graphResult = await withTimeout(
      getChatbotGraph().invoke(
        {
          messages: [new SystemMessage(systemPrompt), new HumanMessage(question.question)],
        },
        {
          configurable: { thread_id: `${question.id}-${model}-iter${iteration}` },
          recursionLimit: 50,
        },
      ),
      120000,
      question.id,
    );

    const messages = graphResult.messages;
    const lastMsg = messages[messages.length - 1];
    const answer = typeof lastMsg.content === 'string' ? lastMsg.content : String(lastMsg.content);

    // Count tool calls
    toolCalls = messages.filter((m) => {
      const rec = m as unknown as Record<string, unknown>;
      return 'tool_calls' in m && Array.isArray(rec['tool_calls']);
    }).length;

    const { passed, failureType, reasons } = checkAnswer(answer.trim(), question);

    return {
      questionId: question.id,
      model,
      question: question.question,
      answer: answer.trim(),
      passed,
      failureType,
      reasons,
      toolCalls,
      durationMs: Date.now() - startTime,
    };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const failureType = errorMsg.includes('timed out')
      ? 'TIMEOUT'
      : errorMsg.includes('Recursion limit')
        ? 'LOOP'
        : 'SQL_ERROR';

    return {
      questionId: question.id,
      model,
      question: question.question,
      answer: '',
      passed: false,
      failureType,
      reasons: [errorMsg],
      toolCalls,
      durationMs: Date.now() - startTime,
      error: errorMsg,
    };
  }
}

async function runIteration(
  iteration: number,
  questions: EvalQuestion[],
  systemPrompt: string,
): Promise<IterationResult[]> {
  console.log(`\n${BOLD}=== Iteration ${iteration} ===${RESET}\n`);

  const results: IterationResult[] = [];

  for (const model of MODELS) {
    console.log(`${BLUE}Testing model: ${model}${RESET}`);
    const modelResults: TestResult[] = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      process.stdout.write(
        `  [${i + 1}/${questions.length}] ${q.id} ${DIM}${q.question.slice(0, 50)}...${RESET} `,
      );

      const result = await runTestForModel(model, q, systemPrompt, iteration);
      modelResults.push(result);

      const status = result.passed ? `${GREEN}PASS${RESET}` : `${RED}${result.failureType}${RESET}`;
      console.log(status);

      if (!result.passed && result.reasons.length > 0) {
        console.log(`    ${DIM}${result.reasons.join('; ')}${RESET}`);
      }
    }

    const passCount = modelResults.filter((r) => r.passed).length;
    const failCount = modelResults.length - passCount;

    // Analyze failure patterns
    const failurePatterns: Record<string, string[]> = {};
    for (const r of modelResults.filter((r) => !r.passed)) {
      if (!failurePatterns[r.failureType]) {
        failurePatterns[r.failureType] = [];
      }
      failurePatterns[r.failureType].push(r.questionId);
    }

    results.push({
      iteration,
      model,
      results: modelResults,
      passCount,
      failCount,
      failurePatterns,
    });

    console.log(
      `\n  ${BOLD}Results: ${passCount}/${modelResults.length} PASS, ${failCount}/${modelResults.length} FAIL${RESET}`,
    );
    for (const [pattern, questionIds] of Object.entries(failurePatterns)) {
      console.log(`    ${YELLOW}${pattern}${RESET}: ${questionIds.length} questions`);
    }
    console.log();
  }

  return results;
}

function analyzeFailures(allResults: IterationResult[]): string[] {
  const fixes: string[] = [];

  // Check for common failure patterns across all models
  const loopFailures = allResults.flatMap((r) =>
    r.results.filter((res) => res.failureType === 'LOOP').map((res) => res.questionId),
  );

  const sqlErrors = allResults.flatMap((r) =>
    r.results.filter((res) => res.failureType === 'SQL_ERROR').map((res) => res.questionId),
  );

  const wrongAnswers = allResults.flatMap((r) =>
    r.results.filter((res) => res.failureType === 'WRONG_ANSWER').map((res) => res.questionId),
  );

  if (loopFailures.length > 0) {
    fixes.push('LOOP_DETECTION');
  }
  if (sqlErrors.length > 0) {
    fixes.push('SQL_IMPROVEMENT');
  }
  if (wrongAnswers.length > 0) {
    fixes.push('PROMPT_IMPROVEMENT');
  }

  return fixes;
}

async function main(): Promise<void> {
  const maxIterations = Number(process.env.ITERATION_MAX || 5);
  const parallelModels = process.env.PARALLEL_MODELS !== 'false';

  if (!process.env.OPENROUTER_API_KEY) {
    console.error(`${RED}${BOLD}ERROR:${RESET} OPENROUTER_API_KEY is not set.`);
    process.exit(1);
  }

  // Ensure results directory exists
  if (!existsSync('results')) {
    mkdirSync('results');
  }

  console.log(`${BOLD}=== Multi-Model NBA Chatbot Evaluation ===${RESET}`);
  console.log(`Models: ${MODELS.join(', ')}`);
  console.log(`Questions: ${QUESTION_MATRIX.length}`);
  console.log(`Max Iterations: ${maxIterations}`);
  console.log(`Parallel: ${parallelModels}`);
  console.log('');

  // Initialize DB
  try {
    await initDb();
  } catch (e: unknown) {
    console.error(`${RED}Failed to init DB: ${e instanceof Error ? e.message : String(e)}${RESET}`);
    process.exit(1);
  }

  // Build system prompt
  let systemPrompt: string;
  try {
    systemPrompt = await buildSystemPrompt();
    console.log(`${DIM}System prompt: ${systemPrompt.length} chars${RESET}\n`);
  } catch (e: unknown) {
    console.error(
      `${RED}Failed to build prompt: ${e instanceof Error ? e.message : String(e)}${RESET}`,
    );
    await closeDb();
    process.exit(1);
  }

  const allIterations: IterationResult[][] = [];
  const currentQuestions = [...QUESTION_MATRIX];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const iterationResults = await runIteration(iteration, currentQuestions, systemPrompt);
    allIterations.push(iterationResults);

    // Save iteration results
    writeFileSync(`results/iteration-${iteration}.json`, JSON.stringify(iterationResults, null, 2));

    // Check if all passed
    const totalPass = iterationResults.reduce((sum, r) => sum + r.passCount, 0);
    const totalQuestions = iterationResults.reduce((sum, r) => sum + r.results.length, 0);

    if (totalPass === totalQuestions) {
      console.log(
        `${GREEN}${BOLD}SUCCESS: All ${totalQuestions} tests passed across all models!${RESET}\n`,
      );
      break;
    }

    // Analyze failures and suggest fixes
    const fixes = analyzeFailures(iterationResults);
    console.log(`${YELLOW}Suggested fixes: ${fixes.join(', ')}${RESET}\n`);

    // For now, just report. In a full implementation, we would:
    // 1. Apply automatic fixes (e.g., bump recursion limit, add examples)
    // 2. Rebuild system prompt
    // 3. Continue to next iteration

    if (iteration === maxIterations) {
      console.log(`${RED}${BOLD}REACHED MAX ITERATIONS (${maxIterations})${RESET}`);
      console.log(`${RED}Some tests still failing. Manual intervention needed.${RESET}\n`);
    }
  }

  // Generate final report
  generateReport(allIterations);

  await closeDb();
}

function generateReport(allIterations: IterationResult[][]): void {
  const report: string[] = [];
  report.push('# Multi-Model NBA Chatbot Evaluation Report\n');
  report.push(`**Date:** ${new Date().toISOString()}\n`);
  report.push(`**Models Tested:** ${MODELS.join(', ')}\n`);
  report.push(`**Questions:** ${QUESTION_MATRIX.length}\n\n`);

  for (let i = 0; i < allIterations.length; i++) {
    const iteration = allIterations[i];
    report.push(`## Iteration ${i + 1}\n\n`);

    for (const modelResult of iteration) {
      report.push(`### ${modelResult.model}\n\n`);
      report.push(`- **Pass:** ${modelResult.passCount}/${modelResult.results.length}`);
      report.push(`- **Fail:** ${modelResult.failCount}/${modelResult.results.length}\n`);

      if (Object.keys(modelResult.failurePatterns).length > 0) {
        report.push('**Failure Patterns:**\n');
        for (const [pattern, questionIds] of Object.entries(modelResult.failurePatterns)) {
          report.push(`- ${pattern}: ${questionIds.join(', ')}`);
        }
        report.push('\n');
      }

      report.push('**Failed Questions:**\n');
      for (const result of modelResult.results.filter((r) => !r.passed)) {
        report.push(`- ${result.questionId}: ${result.failureType} - ${result.reasons.join('; ')}`);
      }
      report.push('\n');
    }
  }

  const reportContent = report.join('\n');
  writeFileSync('results/EVAL_REPORT.md', reportContent);
  console.log(`${GREEN}Report saved to results/EVAL_REPORT.md${RESET}`);
}

main().catch((err) => {
  console.error(`${RED}${BOLD}Fatal:${RESET}`, err);
  process.exit(1);
});
