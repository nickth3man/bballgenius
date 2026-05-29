import { describe, expect, test } from 'bun:test';
import { formatToolErrorLine, shouldAutoScroll } from '../chatApp.js';
import { formatModelRow } from '../features/modelSelector.js';

describe('chatbot TUI accessibility helpers', () => {
  test('model selector rows include selected position and current model text', () => {
    const row = formatModelRow(
      { id: 'openai/gpt-4.1', name: 'GPT 4.1' },
      2,
      2,
      5,
      'openai/gpt-4.1',
    );

    expect(row).toContain('selected 3 of 5');
    expect(row).toContain('current model');
    expect(row).toContain('openai/gpt-4.1');
  });

  test('chat output auto-scrolls when input is focused', () => {
    expect(
      shouldAutoScroll({ scrollTop: 0, scrollHeight: 100, height: 20, inputFocused: true }),
    ).toBe(true);
  });

  test('chat output does not force scroll while user reviews earlier history', () => {
    expect(
      shouldAutoScroll({ scrollTop: 10, scrollHeight: 100, height: 20, inputFocused: false }),
    ).toBe(false);
  });

  test('tool errors are formatted as visible error lines', () => {
    const line = formatToolErrorLine('query_nba_db', 'table not found');
    expect(line).toContain('[Error]');
    expect(line).toContain('Tool query_nba_db failed');
    expect(line).toContain('table not found');
  });
});
