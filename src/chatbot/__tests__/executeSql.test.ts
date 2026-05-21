import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { closeDb, initDb } from '../db.js';
import { checkSql, executeSql } from '../utils/sql.js';

beforeAll(async () => {
  await initDb();
});

afterAll(async () => {
  await closeDb();
});

describe('executeSql', () => {
  test('checks valid SQL without executing it', async () => {
    const result = await checkSql('SELECT COUNT(*) AS cnt FROM dim_player');
    expect(result).toContain('OK');
  });

  test('checks invalid SQL without executing it', async () => {
    const result = await checkSql('SELECT * FROM nonexistent_table');
    expect(result).toContain('Schema validation failed');
  });

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
    expect(result).toContain('Schema validation failed');
    expect(result).toContain('does not exist');
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

  test('blocks external access function read_csv', async () => {
    const result = await executeSql("SELECT * FROM read_csv('file.csv')");
    expect(result).toContain('SQL Error');
    expect(result).toContain('blocked');
  });

  test('blocks external access function glob', async () => {
    const result = await executeSql("SELECT * FROM glob('*.db')");
    expect(result).toContain('SQL Error');
    expect(result).toContain('blocked');
  });

  test('blocks external access function httpfs', async () => {
    const result = await executeSql("SELECT * FROM httpfs('https://evil.com')");
    expect(result).toContain('SQL Error');
    expect(result).toContain('blocked');
  });

  test('blocks INSERT statements', async () => {
    const result = await executeSql("INSERT INTO dim_player VALUES (1, 'test')");
    expect(result).toContain('SQL Error');
    expect(result).toContain('read-only');
  });

  test('blocks DELETE statements', async () => {
    const result = await executeSql('DELETE FROM dim_player');
    expect(result).toContain('SQL Error');
    expect(result).toContain('read-only');
  });

  test('blocks CREATE TABLE statements', async () => {
    const result = await executeSql('CREATE TABLE hack (id INTEGER)');
    expect(result).toContain('SQL Error');
    expect(result).toContain('read-only');
  });

  test('blocks ALTER TABLE statements', async () => {
    const result = await executeSql('ALTER TABLE dim_player ADD COLUMN test VARCHAR');
    expect(result).toContain('SQL Error');
    expect(result).toContain('read-only');
  });

  test('blocks TRUNCATE statements', async () => {
    const result = await executeSql('TRUNCATE TABLE dim_player');
    expect(result).toContain('SQL Error');
    expect(result).toContain('read-only');
  });

  test('blocks ATTACH DATABASE statements', async () => {
    const result = await executeSql("ATTACH DATABASE 'evil.db'");
    expect(result).toContain('SQL Error');
    expect(result).toContain('read-only');
  });

  test('blocks DESCRIBE on nonexistent table', async () => {
    const result = await executeSql('DESCRIBE nonexistent_table');
    expect(result).toContain('Schema error');
  });
});
