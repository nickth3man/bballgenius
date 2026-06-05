import { describe, expect, test } from 'bun:test';
import { extractSql, extractSqlFromMarkdown } from '../utils/sql.js';

describe('extractSql', () => {
  test('extracts SQL from a markdown code block', () => {
    const text = 'Here is the SQL:\n```sql\nSELECT * FROM fact_game LIMIT 5;\n```\nEnd.';
    expect(extractSql(text)).toBe('SELECT * FROM fact_game LIMIT 5;');
  });

  test('SQL block without trailing newline', () => {
    expect(extractSql('```sql\nSELECT 1;```')).toBe('SELECT 1;');
  });

  test('no SQL block returns null', () => {
    expect(extractSql('Just some text')).toBeNull();
  });

  test('empty code block returns empty string', () => {
    expect(extractSql('```sql\n```')).toBe('');
  });

  test('malformed fence without newline after ```sql returns null', () => {
    expect(extractSql('```sqlSELECT 1;```')).toBeNull();
  });

  test('SQL with backticks inside', () => {
    const text = '```sql\nSELECT `column` FROM `table`;\n```';
    expect(extractSql(text)).toBe('SELECT `column` FROM `table`;');
  });

  test('multiple SQL blocks returns first only', () => {
    const text = '```sql\nSELECT 1;\n```\n---\n```sql\nSELECT 2;\n```';
    expect(extractSql(text)).toBe('SELECT 1;');
  });

  test('leading/trailing whitespace around text', () => {
    expect(extractSql('  \n```sql\nSELECT 1;\n```\n  ')).toBe('SELECT 1;');
  });

  test('Unicode content around fences', () => {
    const text = 'Résultat:\n```sql\nSELECT * FROM players;\n```\nFin.';
    expect(extractSql(text)).toBe('SELECT * FROM players;');
  });

  test('raw text with no backticks returns null', () => {
    expect(extractSql('Just plain text')).toBeNull();
  });
});

describe('extractSqlFromMarkdown', () => {
  test('multiple SQL blocks returns all', () => {
    const text = 'First:\n```sql\nSELECT 1;\n```\nSecond:\n```sql\nSELECT 2;\n```';
    expect(extractSqlFromMarkdown(text)).toEqual(['SELECT 1;', 'SELECT 2;']);
  });

  test('no SQL blocks returns empty array', () => {
    expect(extractSqlFromMarkdown('Just plain text')).toEqual([]);
  });

  test('single block returns array with one item', () => {
    expect(extractSqlFromMarkdown('```sql\nSELECT 1;\n```')).toEqual(['SELECT 1;']);
  });

  test('mixed content with non-SQL code blocks', () => {
    const text = '```sql\nSELECT 1;\n```\n```python\nprint(1)\n```';
    expect(extractSqlFromMarkdown(text)).toEqual(['SELECT 1;']);
  });

  test('empty string returns empty array', () => {
    expect(extractSqlFromMarkdown('')).toEqual([]);
  });
});
