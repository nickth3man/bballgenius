#!/usr/bin/env bun
/**
 * Quick multi-model test - 5 questions, parallel execution
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getChatbotGraph, resetGraph } from '../packages/data/src/tabs/chatbot/agent/graph.js';
import { closeDb, initDb } from '../packages/data/src/tabs/chatbot/db.js';
import { setModel } from '../packages/data/src/tabs/chatbot/openrouter.js';
import { buildSystemPrompt } from '../packages/data/src/tabs/chatbot/systemPrompt.js';

const MODELS = [
  'openai/gpt-oss-120b',
  'deepseek/deepseek-v4-flash',
  'google/gemini-2.5-flash-lite',
];

const QUESTIONS = [
  {
    id: 'simple-001',
    q: 'Who is the all-time NBA regular season scoring leader?',
    expected: 'LeBron James',
  },
  { id: 'simple-002', q: 'How many career points does LeBron James have?', expected: '43440' },
  { id: 'simple-003', q: 'Who won the NBA MVP award in the 2023-24 season?', expected: 'Nikola' },
  {
    id: 'multi-001',
    q: 'Who has more career points: Michael Jordan or Kobe Bryant?',
    expected: 'Kobe',
  },
  { id: 'vague-001', q: 'Who scored the most?', expected: 'CLARIFICATION' },
];

async function testModel(model: string, systemPrompt: string) {
  setModel(model);
  resetGraph();

  console.log(`\n=== ${model} ===`);

  for (const question of QUESTIONS) {
    try {
      const result = await getChatbotGraph().invoke(
        { messages: [new SystemMessage(systemPrompt), new HumanMessage(question.q)] },
        { configurable: { thread_id: `quick-${model}-${question.id}` }, recursionLimit: 50 },
      );

      const lastMsg = result.messages[result.messages.length - 1];
      const answer = String(lastMsg.content);
      const passed =
        answer.includes(question.expected) ||
        (question.expected === 'CLARIFICATION' && answer.toLowerCase().includes('clarif'));

      console.log(`${passed ? 'PASS' : 'FAIL'} ${question.id}: ${answer.slice(0, 60)}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`ERROR ${question.id}: ${msg.slice(0, 60)}`);
    }
  }
}

async function main() {
  await initDb();
  const prompt = await buildSystemPrompt();

  for (const model of MODELS) {
    await testModel(model, prompt);
  }

  await closeDb();
}

main();
