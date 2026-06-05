import { beforeEach, describe, expect, mock, test } from 'bun:test';

let queries: string[] = [];

mock.module('../../../core/db.js', () => ({
  query: async (sql: string) => {
    queries.push(sql);

    if (sql.includes('v_player_honors_full')) {
      return [
        {
          award: 'All-NBA 1st',
          season_year: 1977,
          count: 1,
        },
        {
          award: 'All-Rookie 1st',
          season_year: 1971,
          count: 1,
        },
      ];
    }

    return [
      { award: 'nba mvp', season_year: '1976-77', count: 1 },
      { award: 'nba roy', season_year: '1970-71', count: 1 },
    ];
  },
}));

mock.module('../../../core/dbHonors.js', () => ({
  isHonorsDbConfigured: () => false,
  queryHonors: async () => [],
}));

describe('loadPlayerAwards', () => {
  beforeEach(() => {
    queries = [];
  });

  test('loads actual honors from the primary DB and excludes non-winning award votes', async () => {
    const { loadPlayerAwards } = await import('../queries.js');

    const awards = await loadPlayerAwards('77459');

    expect(queries.some((sql) => sql.includes('v_player_honors_full'))).toBe(true);
    expect(awards).toEqual([
      { award: 'All-NBA 1st', season_year: '1976-77', count: 1 },
      { award: 'All-Rookie 1st', season_year: '1970-71', count: 1 },
    ]);
  });
});
