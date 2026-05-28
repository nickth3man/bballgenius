import { describe, expect, test } from 'bun:test';
import { formatResultsTable } from '../utils/tableFormatter.js';

describe('formatResultsTable', () => {
  test('basic 2-column, 2-row table contains box-drawing characters', () => {
    const result = formatResultsTable([
      { player: 'LeBron James', points: 30 },
      { player: 'S. Curry', points: 28 },
    ]);
    expect(result).toContain('┌');
    expect(result).toContain('┐');
    expect(result).toContain('└');
    expect(result).toContain('┘');
    expect(result).toContain('├');
    expect(result).toContain('┤');
    expect(result).toContain('│');
    expect(result).toContain('─');
    expect(result).toContain('LeBron James');
    expect(result).toContain('S. Curry');
  });

  test('empty array returns no results message', () => {
    const result = formatResultsTable([]);
    expect(result).toBe('Query returned no results.');
  });

  test('numeric columns right-aligned', () => {
    const result = formatResultsTable([
      { player: 'LeBron', points: 30 },
      { player: 'Curry', points: 5 },
    ]);
    const lines = result.split('\n');
    const dataLine1 = lines[3]!;
    const dataLine2 = lines[4]!;
    expect(dataLine1).toContain('30 │');
    expect(dataLine2).toContain(' 5 │');
  });

  test('string columns left-aligned', () => {
    const result = formatResultsTable([
      { player: 'LeBron James', points: 30 },
      { player: 'Curry', points: 28 },
    ]);
    const lines = result.split('\n');
    const dataLine2 = lines[4]!;
    expect(dataLine2).toContain('│ Curry');
  });

  test('null and undefined values displayed as empty string', () => {
    const result = formatResultsTable([
      { name: 'Player A', team: null },
      { name: 'Player B', team: undefined },
    ]);
    expect(result).toContain('Player A');
    expect(result).toContain('Player B');
    const lines = result.split('\n');
    const dataLine1 = lines[3]!;
    expect(dataLine1).toMatch(/│\s+│/);
  });

  test('single row table', () => {
    const result = formatResultsTable([{ name: 'Test', value: 1 }]);
    const lines = result.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('┌');
    expect(lines[4]).toContain('└');
  });

  test('single column table', () => {
    const result = formatResultsTable([{ name: 'Alice' }, { name: 'Bob' }]);
    expect(result).toContain('Alice');
    expect(result).toContain('Bob');
    expect(result).not.toContain('┬');
    expect(result).not.toContain('┴');
  });

  test('21 rows shows truncation message and only 20 data rows', () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({ id: i + 1 }));
    const result = formatResultsTable(rows);
    expect(result).toContain('Rows: 21 (showing first 20)');
    const lines = result.split('\n');
    const dataLines = lines.filter((l) => l.startsWith('│') && !l.includes('id'));
    expect(dataLines).toHaveLength(20);
  });

  test('20 rows does not show truncation message', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 }));
    const result = formatResultsTable(rows);
    expect(result).not.toContain('showing first');
  });

  test('column widths adapt to content', () => {
    const result = formatResultsTable([{ x: 'a' }, { x: 'very long value here' }]);
    const lines = result.split('\n');
    const topLine = lines[0]!;
    expect(topLine.length).toBeGreaterThan(22);
  });

  test('special characters in values preserved', () => {
    const result = formatResultsTable([
      { text: 'hello │ world', num: 1 },
      { text: 'foo ─ bar', num: 2 },
    ]);
    expect(result).toContain('hello │ world');
    expect(result).toContain('foo ─ bar');
  });
});
