import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { closeDb, initDb } from '../db.js';
import type { PlayerAwardRow } from '../queries/timeMachine.js';
import { TimeMachineTab } from '../tabs/timeMachine.js';
import { parseTeamQuery } from '../utils/teamQuery.js';
import { assertNoAnsiLeaks, styledPlainText } from './helpers/ansi.js';
import {
  findTeam,
  loadCareerStats,
  loadPlayerAwards,
  loadTeamRoster,
  loadTeamSeasonStats,
} from './helpers/queries.js';

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
    let awards: PlayerAwardRow[];
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

  test('renderStats includes career totals and averages when stats exist', () => {
    const statsText = { content: '' as string | { chunks: { text: string }[] } };
    const tab = Object.create(TimeMachineTab.prototype) as Record<string, unknown>;
    Object.assign(tab, {
      careerStats: [
        {
          season_year: '2023-24',
          is_playoffs: false,
          gp: 10,
          gs: 10,
          min: 200,
          pts: 150,
          ast: 50,
          reb: 40,
          stl: 5,
          blk: 2,
          ts_pct: 0.55,
          per: 20,
          bpm: 5,
          vorp: 1,
        },
      ],
      statsText,
      container: { requestRender: () => {} },
    });

    (tab.renderStats as () => void)();

    const plain =
      typeof statsText.content === 'string'
        ? statsText.content
        : styledPlainText(statsText.content as Parameters<typeof styledPlainText>[0]);

    expect(plain).toContain('Regular Season Career Totals & Averages');
    expect(plain).toContain('GP: 10');
    expect(plain).toContain('PPG: 15.0');
    assertNoAnsiLeaks(plain);
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

  test('findTeam, loadTeamSeasonStats, and loadTeamRoster query functions are healthy', async () => {
    // Use LAL 2025 — present in the CI fixture boxscore slice (2025-26 season)
    const team = await findTeam('LAL');
    expect(team).not.toBeNull();
    if (!team) {
      return;
    }
    expect(team.team_abbrev).toBe('LAL');

    const stats = await loadTeamSeasonStats(team.team_id, '2025');
    expect(stats).not.toBeNull();
    if (!stats) {
      return;
    }
    expect(Number(stats.gp)).toBeGreaterThan(0);
    expect(Number(stats.ppg)).toBeGreaterThan(0);

    const roster = await loadTeamRoster(team.team_id, '2025');
    expect(Array.isArray(roster)).toBe(true);
    expect(roster.length).toBeGreaterThan(0);
    expect(roster[0]).toHaveProperty('full_name');
    expect(roster[0]).toHaveProperty('ppg');
  });

  test('parseTeamQuery parsing patterns are correctly extracted', () => {
    const res1 = parseTeamQuery('Bulls 1996');
    expect(res1).toEqual({ teamQuery: 'Bulls', year: '1996' });

    const res2 = parseTeamQuery('1996 Chicago Bulls');
    expect(res2).toEqual({ teamQuery: 'Chicago Bulls', year: '1996' });

    const res3 = parseTeamQuery('GSW 2024-25');
    expect(res3).toEqual({ teamQuery: 'GSW', year: '2024' });

    const res4 = parseTeamQuery('NoYearInThisQuery');
    expect(res4).toBeNull();
  });
});
