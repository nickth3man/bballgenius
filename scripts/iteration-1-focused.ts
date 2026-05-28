#!/usr/bin/env bun
/**
 * Focused iteration test - collects detailed failure data
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getChatbotGraph, resetGraph } from '../src/chatbot/agent/graph.js';
import { closeDb, initDb } from '../src/chatbot/db.js';
import { setModel } from '../src/chatbot/openrouter.js';
import { buildSystemPrompt } from '../src/chatbot/systemPrompt.js';

const MODELS = ['openai/gpt-oss-120b', 'deepseek/deepseek-v4-flash'];

const QUESTIONS = [
  {
    id: 'simple-001',
    q: 'Who is the all-time NBA regular season scoring leader?',
    expected: 'LeBron James',
    tier: 'simple',
  },
  {
    id: 'simple-002',
    q: 'How many career points does LeBron James have?',
    expected: '43440',
    tier: 'simple',
  },
  {
    id: 'simple-003',
    q: 'Who won the NBA MVP award in the 2023-24 season?',
    expected: 'Nikola',
    tier: 'simple',
  },
  {
    id: 'multi-001',
    q: 'Who has more career points: Michael Jordan or Kobe Bryant?',
    expected: 'Kobe',
    tier: 'multi-step',
  },
  {
    id: 'multi-004',
    q: 'Who are the top 3 all-time NBA scoring leaders and how many points does each have?',
    expected: 'LeBron',
    tier: 'multi-step',
  },
  { id: 'vague-001', q: 'Who scored the most?', expected: 'CLARIFICATION', tier: 'vague' },
  {
    id: 'vague-003',
    q: 'Tell me about the best season.',
    expected: 'CLARIFICATION',
    tier: 'vague',
  },
  {
    id: 'specific-001',
    q: 'What was Michael Jordan PER in the 1995 playoffs?',
    expected: 'NOT_AVAILABLE',
    tier: 'overly-specific',
  },
  {
    id: 'specific-003',
    q: 'What was the exact attendance for the 2016 NBA Finals Game 7?',
    expected: 'NOT_AVAILABLE',
    tier: 'overly-specific',
  },
];

async function testModel(model: string, systemPrompt: string) {
  setModel(model);
  resetGraph();

  console.log(`\n=== ${model} ===`);
  const results = [];

  for (const question of QUESTIONS) {
    const start = Date.now();
    try {
      const result = await getChatbotGraph().invoke(
        { messages: [new SystemMessage(systemPrompt), new HumanMessage(question.q)] },
        { configurable: { thread_id: `iter1-${model}-${question.id}` }, recursionLimit: 50 },
      );

      // Find the last non-empty message (could be ai, tool, or system)
      let answer = '';
      for (let i = result.messages.length - 1; i >= 0; i--) {
        const content = String(result.messages[i].content || '');
        if (content.trim().length > 0 && !content.includes('STOP. You have been calling')) {
          answer = content;
          break;
        }
      }
      const toolCount = result.messages.filter((m) => m._getType() === 'tool').length;
      const duration = Date.now() - start;

      let passed: boolean;
      if (question.expected === 'CLARIFICATION') {
        passed =
          answer.toLowerCase().includes('clarif') || answer.toLowerCase().includes('specify');
      } else if (question.expected === 'NOT_AVAILABLE') {
        passed =
          answer.toLowerCase().includes('not available') ||
          answer.toLowerCase().includes('do not have');
      } else {
        passed = answer.includes(question.expected);
      }

      results.push({
        question: question.id,
        passed,
        answer: answer.slice(0, 80),
        toolCount,
        duration,
      });
      console.log(
        `${passed ? 'PASS' : 'FAIL'} ${question.id} (${duration}ms, ${toolCount} tools): ${answer.slice(0, 60)}`,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ question: question.id, passed: false, error: msg.slice(0, 80) });
      console.log(`ERROR ${question.id}: ${msg.slice(0, 60)}`);
    }
  }

  return results;
}

async function main() {
  await initDb();
  const prompt = await buildSystemPrompt();

  const allResults: Record<string, unknown> = {};
  for (const model of MODELS) {
    allResults[model] = await testModel(model, prompt);
  }

  // Save results
  const fs = await import('node:fs');
  if (!fs.existsSync('results')) fs.mkdirSync('results');
  fs.writeFileSync('results/iteration-1-focused.json', JSON.stringify(allResults, null, 2));

  console.log('\n=== Summary ===');
  for (const [model, results] of Object.entries(allResults)) {
    const resultArray = results as Array<{ passed: boolean }>;
    const passCount = resultArray.filter((r: { passed: boolean }) => r.passed).length;
    console.log(`${model}: ${passCount}/${resultArray.length} PASS`);
  }

  await closeDb();
}

main();
