import { describe, expect, test } from 'bun:test';
import type { CareerStatRow } from '../tabs/timeMachine/queries.js';
import { canonicalSeasonKey, dedupeCareerStats } from '../tabs/timeMachine/utils/careerStats.js';
import { formatCareerEndYear, isPlayerActive } from '../tabs/timeMachine/utils/playerStatus.js';

describe('canonicalSeasonKey', () => {
  test('maps calendar year to NBA season label', () => {
    expect(canonicalSeasonKey('2025')).toBe('2024-25');
    expect(canonicalSeasonKey('2024-25')).toBe('2024-25');
  });
});

describe('dedupeCareerStats', () => {
  test('collapses duplicate season labels even when nullable columns differ', () => {
    const rows: CareerStatRow[] = [
      {
        season_year: '2025',
        is_playoffs: false,
        gp: 70,
        gs: 70,
        min: 2444,
        pts: 1710,
        ast: 575,
        reb: null,
        stl: 70,
        blk: 39,
        ts_pct: 0.6,
        per: 25,
        bpm: 5,
        vorp: 3,
      },
      {
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
        ts_pct: 0.6,
        per: 25,
        bpm: 5,
        vorp: 3,
      },
    ];

    const deduped = dedupeCareerStats(rows);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].season_year).toBe('2024-25');
    expect(deduped[0].reb).toBe(546);
  });
});

describe('isPlayerActive', () => {
  test('treats null to_year as active even when is_active is false', () => {
    expect(
      isPlayerActive({
        is_active: false,
        to_year: null,
      }),
    ).toBe(true);
    expect(formatCareerEndYear({ is_active: false, to_year: null })).toBe('Present');
  });

  test('treats set to_year and inactive flag as retired', () => {
    expect(
      isPlayerActive({
        is_active: false,
        to_year: 2016,
      }),
    ).toBe(false);
  });
});
