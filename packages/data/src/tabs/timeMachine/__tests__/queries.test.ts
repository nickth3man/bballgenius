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

    if (sql.includes('FROM main.dim_player')) {
      if (
        sql.includes('WHERE lower(full_name)') ||
        sql.includes('SELECT player_id, full_name') ||
        sql.includes('SELECT player_id, first_name')
      ) {
        throw new Error('dim_player has first_name/last_name, not full_name');
      }

      return [
        {
          player_id: '201939',
          full_name: 'Stephen Curry',
          from_year: 2009,
          to_year: 2026,
          is_active: true,
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

describe('searchPlayerSuggestions', () => {
  beforeEach(() => {
    queries = [];
  });

  test('builds player names from first and last name columns', async () => {
    const { searchPlayerSuggestions } = await import('../queries.js');

    const players = await searchPlayerSuggestions('curry');

    expect(queries.some((sql) => sql.includes('person_id AS player_id'))).toBe(true);
    expect(queries.some((sql) => sql.includes("first_name || ' ' || last_name AS full_name"))).toBe(
      true,
    );
    expect(players).toEqual([
      {
        player_id: '201939',
        full_name: 'Stephen Curry',
        from_year: 2009,
        to_year: 2026,
        is_active: true,
      },
    ]);
  });
});
