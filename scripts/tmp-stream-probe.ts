import { HumanMessage } from '@langchain/core/messages';
import { streamQuery } from '../packages/data/src/tabs/chatbot/agent/streaming.js';

const q = process.argv[2] ?? 'Who led the NBA in total points in the 2022-23 regular season?';
let stage = '';
const reasoningByStage: Record<string, number> = {};
for await (const e of streamQuery([new HumanMessage(q)], crypto.randomUUID())) {
  if (e.type === 'chain_stage') stage = e.stage;
  if (e.type === 'tool_start') {
    console.log(
      'TOOL_START',
      e.name,
      'stage=',
      stage,
      'inputKeys=',
      Object.keys(e.input),
      JSON.stringify(e.input).slice(0, 200),
    );
  }
  if (e.type === 'reasoning') {
    reasoningByStage[stage] = (reasoningByStage[stage] ?? 0) + e.content.length;
  }
}
console.log('REASONING chars by stage:', reasoningByStage);
process.exit(0);
