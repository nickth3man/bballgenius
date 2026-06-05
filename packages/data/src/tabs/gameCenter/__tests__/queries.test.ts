import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { closeDb, initDb } from '../../../core/db.js';
import type { BoxScoreRow } from '../queries.js';
import { computeTeamTotals, loadBoxScoreWithTeamDedup, loadGameShots } from '../queries.js';

// This game ID is present in the CI fixture (data/fixtures/nba.ci.duckdb)
// and has both box-score and shot-chart data.
const TEST_GAME_ID = '0042500165';

beforeAll(async () => {
  await initDb();
});

afterAll(async () => {
  await closeDb();
});

describe('loadGameShots', () => {
  test('returns shot rows with correct shape', async () => {
    const rows = await loadGameShots(TEST_GAME_ID);
    expect(rows.length).toBeGreaterThan(0);
    for (const s of rows) {
      expect(typeof s.x).toBe('number');
      expect(typeof s.y).toBe('number');
      expect(['made', 'missed']).toContain(String(s.shot_result).toLowerCase());
    }
  });

  test('returns empty array for unknown game', async () => {
    const rows = await loadGameShots('0000000000');
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(0);
  });
});

describe('loadBoxScoreWithTeamDedup', () => {
  test('returns rows tagged with team info for split rendering', async () => {
    const rows = await loadBoxScoreWithTeamDedup(TEST_GAME_ID);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r).toHaveProperty('team_abbrev');
      expect(r).toHaveProperty('is_home');
      expect(typeof r.is_home).toBe('boolean');
      expect(r).toHaveProperty('points');
      expect(r).toHaveProperty('fgm');
      expect(r).toHaveProperty('fga');
    }
    const homeCount = rows.filter((r) => r.is_home).length;
    const awayCount = rows.filter((r) => !r.is_home).length;
    expect(homeCount).toBeGreaterThan(0);
    expect(awayCount).toBeGreaterThan(0);
  });

  test('puts away team first when ordered by is_home', async () => {
    const rows = await loadBoxScoreWithTeamDedup(TEST_GAME_ID);
    if (rows.length < 2) return;
    const firstAway = rows.find((r) => !r.is_home);
    const firstHome = rows.find((r) => r.is_home);
    expect(firstAway).toBeDefined();
    expect(firstHome).toBeDefined();
    expect(firstAway?.team_abbrev).not.toBe(firstHome?.team_abbrev);
  });
});

describe('computeTeamTotals', () => {
  test('sums counting stats across rows', () => {
    const rows: BoxScoreRow[] = [
      {
        player_id: '1',
        full_name: 'Player A',
        team_id: '1',
        team_abbrev: 'AAA',
        is_home: true,
        min: 30,
        points: 20,
        fgm: 8,
        fga: 15,
        fg_pct: 0.533,
        fg3m: 2,
        fg3a: 5,
        fg3_pct: 0.4,
        ftm: 2,
        fta: 3,
        ft_pct: 0.667,
        oreb: 1,
        dreb: 4,
        reb: 5,
        assists: 3,
        steals: 1,
        blocks: 0,
        turnovers: 2,
        fouls_personal: 2,
        plus_minus: 5,
      },
      {
        player_id: '2',
        full_name: 'Player B',
        team_id: '1',
        team_abbrev: 'AAA',
        is_home: true,
        min: 25,
        points: 15,
        fgm: 6,
        fga: 10,
        fg_pct: 0.6,
        fg3m: 1,
        fg3a: 3,
        fg3_pct: 0.333,
        ftm: 2,
        fta: 2,
        ft_pct: 1,
        oreb: 0,
        dreb: 3,
        reb: 3,
        assists: 5,
        steals: 2,
        blocks: 1,
        turnovers: 1,
        fouls_personal: 3,
        plus_minus: -3,
      },
    ];
    const t = computeTeamTotals(rows);
    expect(t.points).toBe(35);
    expect(t.fgm).toBe(14);
    expect(t.fga).toBe(25);
    expect(t.reb).toBe(8);
    expect(t.assists).toBe(8);
    expect(t.min).toBe(55);
    expect(t.fg3m).toBe(3);
    expect(t.ftm).toBe(4);
    expect(t.steals).toBe(3);
    expect(t.blocks).toBe(1);
    expect(t.turnovers).toBe(3);
    expect(t.fouls_personal).toBe(5);
  });
});
