import { describe, expect, test } from 'bun:test';

import {
  buildCareerChecks,
  formatExpected,
  loadAccuracyChecks,
  parseBbrCareerTotals,
} from './accuracy.js';

describe('accuracy check loader', () => {
  test('loads JSON checks with required fields', async () => {
    const checks = await loadAccuracyChecks(new URL('./accuracy-checks.json', import.meta.url));

    expect(checks.length).toBeGreaterThanOrEqual(79);
    expect(checks[0]).toMatchObject({
      name: 'career_pts_lebron',
      category: 'career',
      mode: 'exact',
      expected: 43440,
    });
  });

  test('formats threshold and approximate expected values', () => {
    expect(formatExpected({ mode: 'gte', expected: 10 })).toBe('>=10');
    expect(formatExpected({ mode: 'lte', expected: 10 })).toBe('<=10');
    expect(formatExpected({ mode: 'approx', expected: 10, tolerance: 0.5 })).toBe('10±0.5');
    expect(formatExpected({ mode: 'approx', expected: 10 })).toBe('10±0');
    expect(formatExpected({ mode: 'range', expected: 10, tolerance: 2 })).toBe('10±2');
  });

  test('parses BBR career totals from rawHtml tables', () => {
    const html = `
      <table id="totals">
        <tfoot>
          <tr>
            <th data-stat="season">Career</th>
            <td data-stat="g">456</td>
            <td data-stat="fg3">10</td>
            <td data-stat="trb">4011</td>
            <td data-stat="ast">1038</td>
            <td data-stat="stl">390</td>
            <td data-stat="blk">752</td>
            <td data-stat="pts">7039</td>
          </tr>
        </tfoot>
      </table>`;

    expect(parseBbrCareerTotals(html)).toEqual({
      g: 456,
      fg3: 10,
      trb: 4011,
      ast: 1038,
      stl: 390,
      blk: 752,
      pts: 7039,
    });
  });

  test('builds career checks from parsed BBR totals', () => {
    const checks = buildCareerChecks(
      { name: 'Ralph Sampson', bbrId: 'sampsra01' },
      { g: 456, pts: 7039, trb: 4011 },
      '.firecrawl/accuracy-sources/players/s/sampsra01.json',
    );

    expect(checks).toHaveLength(3);
    expect(checks[0]).toMatchObject({
      name: 'generated_ralph_sampson_career_g',
      category: 'generated_player_career',
      expected: 456,
      mode: 'exact',
    });
    expect(checks[0].sql).toContain("full_name = 'Ralph Sampson'");
  });
});
