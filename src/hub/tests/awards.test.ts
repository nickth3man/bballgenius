import { describe, expect, test } from 'bun:test';
import {
  formatAwardLabel,
  formatAwardSeasonLines,
  groupPlayerAwards,
} from '../tabs/timeMachine/utils/awards.js';
import { canonicalSeasonKey } from '../tabs/timeMachine/utils/careerStats.js';

describe('formatAwardLabel', () => {
  test('formats common nbadb award slugs', () => {
    expect(formatAwardLabel('nba mvp')).toBe('NBA MVP');
    expect(formatAwardLabel('nba roy')).toBe('NBA Rookie of the Year');
    expect(formatAwardLabel('nba clutch_poy')).toBe('NBA Clutch Player of the Year');
  });
});

describe('groupPlayerAwards', () => {
  test('groups seasons under each award type', () => {
    const grouped = groupPlayerAwards([
      { award: 'nba mvp', season_year: '2024-25', count: 1 },
      { award: 'nba mvp', season_year: '2020-21', count: 1 },
      { award: 'nba roy', season_year: '2003-04', count: 1 },
    ]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].label).toBe('NBA MVP');
    expect(grouped[0].seasons).toEqual(['2024-25', '2020-21']);
  });

  test('dedupes calendar-year and hyphenated season labels for the same award', () => {
    expect(canonicalSeasonKey('2025')).toBe(canonicalSeasonKey('2024-25'));
    const grouped = groupPlayerAwards([
      { award: 'nba mvp', season_year: '2025', count: 1 },
      { award: 'nba mvp', season_year: '2024-25', count: 1 },
    ]);
    expect(grouped[0].seasons).toHaveLength(1);
    expect(grouped[0].seasons[0]).toBe('2024-25');
  });
});

describe('formatAwardSeasonLines', () => {
  test('chunks seasons for multi-line dossier display', () => {
    const lines = formatAwardSeasonLines(
      ['2024-25', '2021-22', '2020-21', '2019-20', '2018-19'],
      2,
    );
    expect(lines).toEqual(['2024-25, 2021-22', '2020-21, 2019-20', '2018-19']);
  });
});
