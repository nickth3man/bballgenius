import type { ChainStageName } from '../agent/streaming.js';

const INPUT_PREVIEW_CHARS = 175;
const OUTPUT_PREVIEW_CHARS = 215;

export function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return '.'.repeat(maxChars);

  const keep = maxChars - 3;
  const startChars = Math.ceil(keep / 2);
  const endChars = Math.floor(keep / 2);
  return `${text.slice(0, startChars)}...${text.slice(text.length - endChars)}`;
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stringifyInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input).map(([key, value]) => `${key}: ${String(value)}`);
  return entries.length > 0 ? entries.join(', ') : 'no input';
}

export function formatChainStageStatus(stage: ChainStageName): string {
  switch (stage) {
    case 'prepare_turn':
      return 'Preparing question...';
    case 'classify_intent':
      return 'Classifying question...';
    case 'inject_schema':
      return 'Loading relevant schema...';
    case 'llm':
      return 'Composing answer...';
    case 'tools':
      return 'Preparing tool calls...';
    case 'tool_budget_guard':
      return 'Checking tool budget...';
    case 'sql_error_guard':
      return 'Checking SQL result...';
    case 'validate_answer':
      return 'Validating answer...';
    case 'finalize_turn':
      return 'Finalizing answer...';
    case 'orch_plan':
      return 'Planning sub-queries...';
    case 'orch_workers':
      return 'Running SQL agents...';
    case 'orch_synthesize':
      return 'Synthesizing answer...';
  }
}

export function summarizeToolInput(input: Record<string, unknown>): string {
  if (typeof input['sql'] === 'string') {
    return `SQL: ${truncateMiddle(compactWhitespace(input['sql']), INPUT_PREVIEW_CHARS)}`;
  }

  return `Input: ${truncateMiddle(compactWhitespace(stringifyInput(input)), INPUT_PREVIEW_CHARS)}`;
}

export function summarizeToolOutput(output: string): string {
  return truncateMiddle(compactWhitespace(output), OUTPUT_PREVIEW_CHARS);
}

export function formatToolStartBlock(name: string, input: Record<string, unknown>): string[] {
  return [`Tool ${name} started`, summarizeToolInput(input)];
}

export function formatToolEndBlock(name: string, output: string, durationMs?: number): string[] {
  const duration = durationMs === undefined ? '' : ` in ${durationMs}ms`;
  return [`Tool ${name} completed${duration}`, `Result: ${summarizeToolOutput(output)}`];
}
