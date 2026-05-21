import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { closeDb, initDb } from '../db.js';
import { executeSql } from '../features/nlToSql.js';

beforeAll(async () => {
  await initDb();
});

afterAll(async () => {
  await closeDb();
});

describe('executeSql', () => {
  test('simple SELECT', async () => {
    const result = await executeSql('SELECT 1 AS num');
    expect(result).toContain('1');
    expect(result).toContain('num');
  });

  test('table query', async () => {
    const result = await executeSql('SELECT COUNT(*) AS cnt FROM dim_player');
    expect(result).toContain('cnt');
    expect(result).toMatch(/\d/);
  });

  test('empty result', async () => {
    const result = await executeSql('SELECT * FROM dim_player WHERE 1=0');
    expect(result).toContain('no results');
  });

  test('SQL syntax error', async () => {
    const result = await executeSql('SELECT INVALID');
    expect(result).toContain('SQL Error');
  });

  test('missing table', async () => {
    const result = await executeSql('SELECT * FROM nonexistent_table');
    expect(result).toContain('SQL Error');
  });

  test('blocks write statements', async () => {
    const result = await executeSql('DROP TABLE dim_player');
    expect(result).toContain('SQL Error');
    expect(result).toContain('read-only');
  });

  test('blocks multiple statements', async () => {
    const result = await executeSql('SELECT 1; SELECT 2');
    expect(result).toContain('SQL Error');
    expect(result).toContain('Only one SQL statement');
  });

  test('large result set', async () => {
    const result = await executeSql('SELECT * FROM dim_player');
    expect(result).toContain('showing first');
  });
});
