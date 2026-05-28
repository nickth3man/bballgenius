import { describe, expect, test } from 'bun:test';
import { aiLabel, dimOrPlain, errorLabel, sqlLabel, statusText, youLabel } from '../utils/theme.js';

describe('theme ANSI helpers', () => {
  test('dimOrPlain returns dimmed text', () => {
    const result = dimOrPlain('hello');
    expect(result).toContain('hello');
    if (process.env['NO_COLOR'] !== '') {
      expect(result).toBe('\x1b[2mhello\x1b[0m');
    }
  });

  test('youLabel returns blue bold label', () => {
    const result = youLabel();
    expect(result).toContain('[You]');
  });

  test('aiLabel returns green bold label', () => {
    const result = aiLabel();
    expect(result).toContain('[AI]');
  });

  test('sqlLabel returns cyan label', () => {
    const result = sqlLabel();
    expect(result).toContain('[SQL]');
  });

  test('errorLabel returns red bold label', () => {
    const result = errorLabel();
    expect(result).toContain('[Error]');
  });

  test('statusText keeps essential state text at normal intensity', () => {
    const result = statusText('Running query...');
    expect(result).toBe('Running query...');
    expect(result).not.toContain('\x1b[2m');
  });
});
