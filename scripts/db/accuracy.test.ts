import { describe, expect, test } from 'bun:test';

import {
  buildCareerChecks,
  buildDraftCheck,
  formatExpected,
  loadAccuracyChecks,
  parseBbrCareerTotals,
  parseBbrDraftPick,
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

  test('parses overall draft pick from the BBR meta block', () => {
    const html = `
      <div id="meta">
        <p><strong>Draft:</strong> Houston Rockets, 1st round (16th pick, 16th overall), 2021 NBA Draft</p>
      </div>`;

    expect(parseBbrDraftPick(html)).toBe(16);
  });

  test('returns null draft pick for undrafted players', () => {
    const html = '<div id="meta"><p><strong>Experience:</strong> 5 years</p></div>';

    expect(parseBbrDraftPick(html)).toBeNull();
  });

  test('builds an exact draft-pick check against fact_draft', () => {
    const check = buildDraftCheck(
      { name: 'Alperen Sengun', bbrId: 'sengual01' },
      16,
      '.firecrawl/accuracy-sources/players/s/sengual01.json',
    );

    expect(check).toMatchObject({
      name: 'generated_alperen_sengun_draft_pick',
      category: 'generated_player_draft',
      expected: 16,
      mode: 'exact',
    });
    expect(check.sql).toContain("player_name = 'Alperen Sengun'");
  });
});
