import { describe, expect, test } from 'bun:test';
import { formatResultsPretty } from '../utils/sql.js';

describe('formatResultsPretty', () => {
  test('formats normal results with headers and values', () => {
    const result = formatResultsPretty([
      { player: 'LeBron James', points: 30 },
      { player: 'Stephen Curry', points: 28 },
    ]);
    expect(result).toContain('player');
    expect(result).toContain('points');
    expect(result).toContain('LeBron James');
    expect(result).toContain('30');
    expect(result).toContain('Stephen Curry');
    expect(result).toContain('28');
    expect(result).toContain('┌');
    expect(result).toContain('┘');
  });

  test('empty array returns no results message', () => {
    const result = formatResultsPretty([]);
    expect(result).toBe('Query returned no results.');
  });

  test('null values displayed as empty string', () => {
    const result = formatResultsPretty([
      { name: 'Player A', team: null, pts: 10 },
      { name: 'Player B', team: 'Lakers', pts: null },
    ]);
    expect(result).toContain('Player A');
    expect(result).toContain('Player B');
    expect(result).toContain('Lakers');
    expect(result).toContain('10');
    expect(result).toContain('│ Player A');
    expect(result).toContain('│ 10');
  });

  test('undefined values handled gracefully', () => {
    const result = formatResultsPretty([
      { name: 'Test', points: 5 } as Record<string, unknown>,
      { name: 'Missing' } as Record<string, unknown>,
    ]);
    expect(result).toContain('Test');
    expect(result).toContain('Missing');
    expect(result).toContain('5');
  });

  test('special characters in values', () => {
    const result = formatResultsPretty([{ item: 'pipe | char', desc: 'dash - test' }]);
    expect(result).toContain('pipe | char');
    expect(result).toContain('dash - test');
  });

  test('single row', () => {
    const result = formatResultsPretty([{ col: 'value' }]);
    expect(result).toContain('col');
    expect(result).toContain('value');
    const lines = result.split('\n');
    expect(lines).toHaveLength(5);
  });

  test('very long cell value', () => {
    const long = 'a'.repeat(150);
    const result = formatResultsPretty([{ data: long }]);
    expect(result).toContain(long);
  });

  test('many columns includes all headers', () => {
    const row: Record<string, unknown> = {};
    for (let i = 0; i < 12; i++) {
      row[`col${i}`] = i;
    }
    const result = formatResultsPretty([row]);
    for (let i = 0; i < 12; i++) {
      expect(result).toContain(`col${i}`);
    }
  });

  test('numbers displayed correctly', () => {
    const result = formatResultsPretty([{ int: 42, float: 3.14, negative: -5 }]);
    expect(result).toContain('42');
    expect(result).toContain('3.14');
    expect(result).toContain('-5');
  });

  test('exactly 20 rows does not show count message', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: i }));
    const result = formatResultsPretty(rows);
    expect(result).not.toContain('showing first');
    expect(result).not.toContain('Rows:');
  });

  test('21 rows shows showing first 20 message', () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({ id: i }));
    const result = formatResultsPretty(rows);
    expect(result).toContain('Rows: 21 (showing first 20)');
  });

  test('single column', () => {
    const result = formatResultsPretty([{ name: 'Alice' }, { name: 'Bob' }]);
    expect(result).toContain('name');
    expect(result).toContain('Alice');
    expect(result).toContain('Bob');
    const lines = result.split('\n');
    expect(lines[0]).toContain('┌');
    expect(lines[1]).toContain('name');
    expect(lines[2]).toContain('├');
  });
});
