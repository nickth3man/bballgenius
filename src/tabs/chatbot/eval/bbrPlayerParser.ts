/**
 * Parser for basketball-reference.com player-page CAREER TOTALS.
 *
 * BBR serves the season/totals table inside an HTML comment that its JS
 * "uncomments" at runtime, so a plain fetch sees nothing until the comment
 * markers are stripped. Firecrawl's rawHtml format already renders the JS, but
 * we strip comment markers anyway so this also works on un-rendered HTML.
 *
 * Markup has drifted over time, so we handle both shapes:
 *   - legacy:  <table id="totals">      data-stat="g"      career row th text "Career"
 *   - current: <table id="totals_stats"> data-stat="games"  career row th text "23 Yrs"
 *
 * The career line lives in the table's <tfoot>. We pick the overall career row
 * (label "Career" or "<N> Yrs") for the requested league, skipping the
 * per-game-average row ("82 Game Avg") and per-team splits ("CLE (11 Yrs)").
 *
 * Source of the technique: roclark/sportsipy (utils._get_stats_table footer rows,
 * _remove_html_comment_tags) plus direct inspection of a live 2026 player page.
 */

import * as cheerio from 'cheerio';

export interface CareerTotals {
  games: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
}

/** data-stat aliases: [current, legacy]. First non-empty cell wins. */
const STAT_ALIASES: Record<keyof CareerTotals, string[]> = {
  games: ['games', 'g'],
  points: ['pts'],
  rebounds: ['trb'],
  assists: ['ast'],
  steals: ['stl'],
  blocks: ['blk'],
};

const CAREER_LABEL = /^(career|\d+\s+yrs?)$/i;
const SKIP_LABEL = /(game avg|\()/i; // "82 Game Avg" and team splits like "CLE (11 Yrs)"

function cellNumber($row: cheerio.Cheerio<never>, aliases: string[]): number | null {
  for (const stat of aliases) {
    const txt = $row.find(`[data-stat="${stat}"]`).first().text().trim();
    if (txt !== '') {
      const n = Number(txt.replace(/,/g, ''));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * Extract a player's regular-season career totals from BBR player-page HTML.
 * @param league which league's career line to read ("NBA" excludes ABA). When a
 *   row has no lg_id cell (single-league players) it is accepted regardless.
 * @returns the totals, or null if the table / career row could not be found.
 */
export function parseBbrCareerTotals(html: string, league = 'NBA'): CareerTotals | null {
  const unwrapped = html.replace(/<!--/g, '').replace(/-->/g, '');
  const $ = cheerio.load(unwrapped);

  const table = $('table#totals_stats').length ? $('table#totals_stats') : $('table#totals');
  if (table.length === 0) return null;

  const footRows = table.find('tfoot tr');
  if (footRows.length === 0) return null;

  // Candidate overall-career rows (correct league, not avg/team-split).
  const candidates: cheerio.Cheerio<never>[] = [];
  footRows.each((_, el) => {
    const $row = $(el) as cheerio.Cheerio<never>;
    const label = $row.find('[data-stat="year_id"], [data-stat="season"]').first().text().trim();
    if (!CAREER_LABEL.test(label) || SKIP_LABEL.test(label)) return;
    const lg = $row.find('[data-stat="lg_id"]').first().text().trim();
    if (lg && lg.toUpperCase() !== league.toUpperCase()) return;
    candidates.push($row);
  });

  // Prefer a league-tagged row; otherwise the first overall-career row found.
  const chosen = candidates[0];
  if (!chosen) return null;

  const get = (k: keyof CareerTotals) => cellNumber(chosen, STAT_ALIASES[k]);
  const games = get('games');
  const points = get('points');
  if (games == null || points == null) return null;

  return {
    games,
    points,
    rebounds: get('rebounds') ?? 0,
    assists: get('assists') ?? 0,
    steals: get('steals') ?? 0,
    blocks: get('blocks') ?? 0,
  };
}
