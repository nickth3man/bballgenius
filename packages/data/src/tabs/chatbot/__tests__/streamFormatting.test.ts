import { describe, expect, test } from 'bun:test';
import {
  formatChainStageStatus,
  formatToolEndBlock,
  formatToolStartBlock,
  summarizeToolInput,
  summarizeToolOutput,
  truncateMiddle,
} from '../utils/streamFormatting.js';

describe('stream formatting', () => {
  test('maps chain stages to safe status text', () => {
    expect(formatChainStageStatus('prepare_turn')).toBe('Preparing question...');
    expect(formatChainStageStatus('classify_intent')).toBe('Classifying question...');
    expect(formatChainStageStatus('inject_schema')).toBe('Loading relevant schema...');
    expect(formatChainStageStatus('llm')).toBe('Composing answer...');
    expect(formatChainStageStatus('tools')).toBe('Preparing tool calls...');
    expect(formatChainStageStatus('tool_budget_guard')).toBe('Checking tool budget...');
    expect(formatChainStageStatus('sql_error_guard')).toBe('Checking SQL result...');
    expect(formatChainStageStatus('validate_answer')).toBe('Validating answer...');
    expect(formatChainStageStatus('finalize_turn')).toBe('Finalizing answer...');
  });

  test('summarizes SQL input without exceeding display limit', () => {
    const summary = summarizeToolInput({
      sql: `SELECT ${'very_long_column_name, '.repeat(30)} player_name FROM dim_player`,
    });

    expect(summary).toStartWith('SQL: SELECT');
    expect(summary.length).toBeLessThanOrEqual(180);
    expect(summary).toContain('...');
  });

  test('formats tool start and end blocks with compact details', () => {
    const start = formatToolStartBlock('query_nba_db', { sql: 'SELECT 1' });
    const end = formatToolEndBlock('query_nba_db', 'rows\n1', 42);

    expect(start).toEqual(['Tool query_nba_db started', 'SQL: SELECT 1']);
    expect(end[0]).toBe('Tool query_nba_db completed in 42ms');
    expect(end[1]).toBe('Result: rows 1');
  });

  test('summarizes long output and strips excess whitespace', () => {
    const summary = summarizeToolOutput(`rows\n\n${'LeBron James '.repeat(50)}`);

    expect(summary).toStartWith('rows LeBron James');
    expect(summary.length).toBeLessThanOrEqual(220);
  });

  test('truncateMiddle preserves both ends of long text', () => {
    const text = `start-${'x'.repeat(80)}-end`;
    const truncated = truncateMiddle(text, 24);

    expect(truncated).toStartWith('start-');
    expect(truncated).toEndWith('-end');
    expect(truncated).toContain('...');
    expect(truncated.length).toBeLessThanOrEqual(24);
  });
});
