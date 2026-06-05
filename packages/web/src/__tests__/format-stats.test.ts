import { describe, expect, test } from 'bun:test';
import { formatMinutes, formatStatRow } from '../lib/format-stats.js';

describe('formatMinutes', () => {
  test('returns "-" for null or undefined', () => {
    expect(formatMinutes(null)).toBe('-');
    expect(formatMinutes(undefined)).toBe('-');
  });

  test('formats minutes:seconds for numeric values', () => {
    expect(formatMinutes(36.3)).toBe('36:18');
    expect(formatMinutes(0)).toBe('0:00');
  });

  test('passes through "-" for the string sentinel', () => {
    expect(formatMinutes('-')).toBe('-');
  });

  test('handles already-formatted strings (e.g. "30:48")', () => {
    expect(formatMinutes('30:48')).toBe('30:48');
  });
});

describe('formatStatRow', () => {
  test('renders a regular season row with mm:ss and dash for missing values', () => {
    const row = {
      season_year: '2024-25',
      is_playoffs: false,
      gp: 70,
      gs: 70,
      min: 2444,
      pts: 1710,
      ast: 575,
      reb: 546,
      stl: 70,
      blk: 39,
    };
    const out = formatStatRow(row);
    expect(out).toEqual({
      Season: '2024-25',
      Type: 'Regular',
      GP: 70,
      GS: 70,
      MIN: '40:44',
      PTS: 1710,
      AST: 575,
      REB: 546,
      STL: 70,
      BLK: 39,
    });
  });

  test('renders a playoffs row with "-" for missing rebounds', () => {
    const row = {
      season_year: '2024',
      is_playoffs: true,
      gp: 5,
      gs: 5,
      min: 204,
      pts: 127,
      ast: 28,
      reb: null,
      stl: 10,
      blk: 9,
    };
    const out = formatStatRow(row);
    expect(out).toMatchObject({
      Season: '2024',
      Type: 'Playoffs',
      GP: 5,
      GS: 5,
      MIN: '3:24',
      PTS: 127,
      AST: 28,
      REB: '-',
      STL: 10,
      BLK: 9,
    });
  });
});
