import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { closeDb, initDb } from '../db.js';
import { TimeMachineTab } from '../tabs/timeMachine.js';
import { assertNoAnsiLeaks, styledPlainText } from './helpers/ansi.js';
import { loadCareerStats, loadPlayerAwards } from './helpers/queries.js';

const LEBRON_PLAYER_ID = '2544';

const CAREER_STATS_COLUMNS = [
  'season_year',
  'is_playoffs',
  'gp',
  'gs',
  'min',
  'pts',
  'ast',
  'reb',
  'stl',
  'blk',
  'ts_pct',
  'per',
  'bpm',
  'vorp',
] as const;

describe('Career Time-Machine awards loading', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('awards query for LeBron (2544) succeeds without binder error', async () => {
    let awards: Record<string, unknown>[];
    try {
      awards = await loadPlayerAwards(LEBRON_PLAYER_ID);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      expect(message).not.toMatch(/binder|award_name|referenced column/i);
      throw e;
    }

    expect(Array.isArray(awards)).toBe(true);
    expect(awards.length).toBeGreaterThan(0);

    for (const row of awards) {
      expect(row).toHaveProperty('award');
      expect(row).toHaveProperty('season_year');
      expect(typeof row.award).toBe('string');
      expect(row.award).toBeTruthy();
      expect(row.season_year).toBeDefined();
    }
  });

  test('career stats query for LeBron returns all expected columns', async () => {
    const stats = await loadCareerStats(LEBRON_PLAYER_ID);

    expect(Array.isArray(stats)).toBe(true);
    expect(stats.length).toBeGreaterThan(0);

    // Verify every required column is present on the first row
    const row = stats[0];
    for (const col of CAREER_STATS_COLUMNS) {
      expect(row).toHaveProperty(col);
    }
  });

  test('career stats rows are ordered newest season first', async () => {
    const stats = await loadCareerStats(LEBRON_PLAYER_ID);
    expect(stats.length).toBeGreaterThan(1);

    // season_year is a string (e.g. "2024-25"); lexicographic comparison is
    // sufficient and correct — "2025-26" > "2024-25" > "2003-04" etc.
    const years = stats.map((r) => String(r.season_year));
    for (let i = 1; i < years.length; i++) {
      expect(years[i] <= years[i - 1]).toBe(true);
    }
  });

  test('renderStats shows plain message when careerStats is empty', () => {
    const statsText = { content: '' as string | { chunks: { text: string }[] } };
    const tab = Object.create(TimeMachineTab.prototype) as Record<string, unknown>;
    Object.assign(tab, {
      careerStats: [],
      statsText,
      container: { requestRender: () => {} },
    });

    (tab.renderStats as () => void)();

    const plain =
      typeof statsText.content === 'string'
        ? statsText.content
        : styledPlainText(statsText.content as Parameters<typeof styledPlainText>[0]);

    expect(plain.toLowerCase()).toContain('no');
    expect(plain.toLowerCase()).toMatch(/stat/);
    assertNoAnsiLeaks(plain);
  });

  test('loadCareerStats for Bob Cousy (77) allows null advanced metrics', async () => {
    const stats = await loadCareerStats('77');
    expect(stats.length).toBeGreaterThan(0);

    for (const row of stats) {
      for (const col of ['ts_pct', 'per', 'bpm', 'vorp'] as const) {
        const val = row[col];
        expect(val === null || typeof val === 'number').toBe(true);
      }
    }
  });
});
