import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { markdownToAnsi } from '../utils/markdown.js';

describe('markdownToAnsi', () => {
  let prevNoColor: string | undefined;

  beforeEach(() => {
    prevNoColor = process.env['NO_COLOR'];
    delete process.env['NO_COLOR'];
  });

  afterEach(() => {
    if (prevNoColor === undefined) {
      delete process.env['NO_COLOR'];
    } else {
      process.env['NO_COLOR'] = prevNoColor;
    }
  });

  test('bold: **hello** wraps in bold ANSI', () => {
    const result = markdownToAnsi('**hello**');
    expect(result).toContain('\x1b[1m');
    expect(result).toContain('hello');
    expect(result).toContain('\x1b[0m');
  });

  test('italic: *world* wraps in dim ANSI (italic unsupported)', () => {
    const result = markdownToAnsi('*world*');
    expect(result).toContain('\x1b[2m');
    expect(result).toContain('world');
    expect(result).toContain('\x1b[0m');
  });

  test('inline code: `SELECT` wraps in cyan ANSI', () => {
    const result = markdownToAnsi('`SELECT`');
    expect(result).toContain('\x1b[36m');
    expect(result).toContain('SELECT');
    expect(result).toContain('\x1b[0m');
  });

  test('code block: fenced block wraps in cyan ANSI', () => {
    const result = markdownToAnsi('```sql\nSELECT 1\n```');
    expect(result).toContain('\x1b[36m');
    expect(result).toContain('SELECT 1');
    expect(result).toContain('\x1b[0m');
  });

  test('headers: # Title wraps in bold ANSI', () => {
    const result = markdownToAnsi('# Title');
    expect(result).toContain('\x1b[1m');
    expect(result).toContain('Title');
    expect(result).toContain('\x1b[0m');
  });

  test('bullet lists: - item converts to bullet character', () => {
    const result = markdownToAnsi('- item');
    expect(result).toContain('\u2022 item');
  });

  test('blockquotes: > text wraps in dim with bar', () => {
    const result = markdownToAnsi('> text');
    expect(result).toContain('\x1b[2m');
    expect(result).toContain('\u2502 text');
    expect(result).toContain('\x1b[0m');
  });

  test('plain text passes through unchanged', () => {
    const result = markdownToAnsi('just plain text');
    expect(result).toBe('just plain text');
  });

  test('empty string returns empty string', () => {
    const result = markdownToAnsi('');
    expect(result).toBe('');
  });

  test('mixed formatting: bold and italic both present', () => {
    const result = markdownToAnsi('**bold** and *italic*');
    expect(result).toContain('\x1b[1m');
    expect(result).toContain('bold');
    expect(result).toContain('\x1b[2m');
    expect(result).toContain('italic');
  });

  test('NO_COLOR env: when set, no ANSI codes in output', () => {
    process.env['NO_COLOR'] = '1';
    const result = markdownToAnsi('**bold** and *italic* and `code`');
    expect(result).not.toContain('\x1b[');
    expect(result).toContain('bold');
    expect(result).toContain('italic');
    expect(result).toContain('code');
  });
});
