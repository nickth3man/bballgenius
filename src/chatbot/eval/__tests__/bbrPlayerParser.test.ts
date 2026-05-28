import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBbrCareerTotals } from '../bbrPlayerParser.js';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dir, '..', '__fixtures__', name), 'utf8');

describe('parseBbrCareerTotals', () => {
  it('reads the overall NBA career-totals (N Yrs) row from a live player page', () => {
    // LeBron James totals_stats table captured 2026-05-28 from basketball-reference.com.
    const totals = parseBbrCareerTotals(fixture('bbr-jamesle01-totals.html'), 'NBA');
    expect(totals).toEqual({
      games: 1622,
      points: 43440,
      rebounds: 12095,
      assists: 12016,
      steals: 2417,
      blocks: 1185,
    });
  });

  it('still finds the table when comment markers wrap it (un-rendered HTML)', () => {
    const wrapped = `<div><!-- ${fixture('bbr-jamesle01-totals.html')} --></div>`;
    expect(parseBbrCareerTotals(wrapped)?.points).toBe(43440);
  });

  it('returns null when no totals table is present', () => {
    expect(parseBbrCareerTotals('<html><body>no tables here</body></html>')).toBeNull();
  });
});
