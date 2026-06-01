import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

export type CompareMode = 'exact' | 'gte' | 'lte' | 'range' | 'approx';

export type AccuracyCheck = {
  name: string;
  category: string;
  description: string;
  sql: string;
  expected: number;
  mode: CompareMode;
  tolerance?: number;
  source: string;
};

type ExpectedShape = Pick<AccuracyCheck, 'mode' | 'expected'> &
  Partial<Pick<AccuracyCheck, 'tolerance'>>;

export type Outcome = AccuracyCheck & {
  actual: number | null;
  passed: boolean;
  error: string | null;
};

export type BbrPlayerSeed = {
  name: string;
  bbrId: string;
  url?: string;
};

export type BbrCareerTotals = Partial<Record<BbrStatKey, number>>;

type BbrStatKey = 'g' | 'pts' | 'trb' | 'ast' | 'stl' | 'blk' | 'fg3';

const BBR_CAREER_STAT_LABELS = {
  g: 'games played',
  pts: 'points',
  trb: 'rebounds',
  ast: 'assists',
  stl: 'steals',
  blk: 'blocks',
  fg3: 'three-pointers made',
} satisfies Record<BbrStatKey, string>;

const BBR_TO_GOLDEN_METRIC = {
  g: 'GP',
  pts: 'PTS',
  trb: 'TRB',
  ast: 'AST',
  stl: 'STL',
  blk: 'BLK',
  fg3: 'FG3M',
} satisfies Record<BbrStatKey, string>;

const BBR_DATA_STAT_ALIASES = {
  g: ['games', 'g'],
  pts: ['pts'],
  trb: ['trb'],
  ast: ['ast'],
  stl: ['stl'],
  blk: ['blk'],
  fg3: ['fg3', 'fg3m'],
} satisfies Record<BbrStatKey, string[]>;

export async function loadAccuracyChecks(path: URL | string): Promise<AccuracyCheck[]> {
  const checks = await Bun.file(path).json();

  if (!Array.isArray(checks)) {
    throw new Error('Accuracy checks file must contain a JSON array');
  }

  return checks.map((check, index) => validateAccuracyCheck(check, index));
}

export function compareActual(check: AccuracyCheck, actual: number | null): boolean {
  if (actual === null) {
    return false;
  }

  switch (check.mode) {
    case 'exact':
      return actual === check.expected;
    case 'gte':
      return actual >= check.expected;
    case 'lte':
      return actual <= check.expected;
    case 'range':
      return (
        actual >= check.expected - (check.tolerance ?? 0) &&
        actual <= check.expected + (check.tolerance ?? 0)
      );
    case 'approx':
      return Math.abs(actual - check.expected) <= (check.tolerance ?? 0);
  }
}

export function formatExpected(check: ExpectedShape): string {
  const tolerance = check.tolerance ?? 0;

  switch (check.mode) {
    case 'gte':
      return `>=${check.expected}`;
    case 'lte':
      return `<=${check.expected}`;
    case 'approx':
    case 'range':
      return `${check.expected}±${tolerance}`;
    case 'exact':
      return String(check.expected);
  }
}

export function parseBbrCareerTotals(rawHtml: string): BbrCareerTotals {
  const html = rawHtml.replace(/<!--([\s\S]*?)-->/g, '$1');
  const $ = cheerio.load(html);
  const row = $('#totals_stats tfoot tr, #totals tfoot tr')
    .filter(
      (_, element) =>
        parseStatValue(findDataStatText($(element), BBR_DATA_STAT_ALIASES.g)) !== null,
    )
    .first();
  const totals: BbrCareerTotals = {};

  for (const stat of Object.keys(BBR_TO_GOLDEN_METRIC) as BbrStatKey[]) {
    const value = parseStatValue(findDataStatText(row, BBR_DATA_STAT_ALIASES[stat]));
    if (value !== null) {
      totals[stat] = value;
    }
  }

  return totals;
}

export function buildCareerChecks(
  player: BbrPlayerSeed,
  totals: BbrCareerTotals,
  sourcePath: string,
): AccuracyCheck[] {
  const checks: AccuracyCheck[] = [];
  const url = player.url ?? bbrPlayerUrl(player.bbrId);

  for (const stat of Object.keys(BBR_TO_GOLDEN_METRIC) as BbrStatKey[]) {
    const expected = totals[stat];
    if (expected === undefined) {
      continue;
    }

    checks.push({
      name: `generated_${slugName(player.name)}_career_${stat}`,
      category: 'generated_player_career',
      description: `${player.name} career ${BBR_CAREER_STAT_LABELS[stat]} = ${expected}`,
      sql: careerSumSql(BBR_TO_GOLDEN_METRIC[stat], player.name),
      expected,
      mode: 'exact',
      source: `Firecrawl BBR player page ${url} cached=${sourcePath} table=totals`,
    });
  }

  return checks;
}

/**
 * Extract a player's overall draft pick from a BBR player page's meta block.
 * The "Draft:" line reads e.g. "… 1st round (16th pick, 16th overall), 2021 NBA Draft".
 * Returns null for undrafted players (no "overall" token).
 */
export function parseBbrDraftPick(rawHtml: string): number | null {
  const html = rawHtml.replace(/<!--([\s\S]*?)-->/g, '$1');
  const $ = cheerio.load(html);
  let draftText = '';
  $('p').each((_, element) => {
    const text = $(element).text();
    if (/Draft:/i.test(text) && /overall/i.test(text)) {
      draftText = text;
    }
  });
  const match = draftText.match(/(\d+)(?:st|nd|rd|th)\s+overall/i);
  return match?.[1] ? Number(match[1]) : null;
}

/** Build an exact draft-pick check (DB overall_pick vs BBR meta) for a control player. */
export function buildDraftCheck(
  player: BbrPlayerSeed,
  pick: number,
  sourcePath: string,
): AccuracyCheck {
  const url = player.url ?? bbrPlayerUrl(player.bbrId);
  return {
    name: `generated_${slugName(player.name)}_draft_pick`,
    category: 'generated_player_draft',
    description: `${player.name} drafted #${pick} overall`,
    sql: `SELECT overall_pick AS val FROM nbadb.fact_draft WHERE player_name = '${escapeSql(player.name)}'`,
    expected: pick,
    mode: 'exact',
    source: `Firecrawl BBR player page ${url} cached=${sourcePath} meta=draft`,
  };
}

export function bbrPlayerUrl(bbrId: string): string {
  return `https://www.basketball-reference.com/players/${bbrId[0]}/${bbrId}.html`;
}

function validateAccuracyCheck(value: unknown, index: number): AccuracyCheck {
  if (!isObject(value)) {
    throw new Error(`Accuracy check at index ${index} must be an object`);
  }

  const check = value as Record<string, unknown>;
  const mode = check['mode'];

  if (!isCompareMode(mode)) {
    throw new Error(`Accuracy check at index ${index} has invalid mode`);
  }

  const result: AccuracyCheck = {
    name: requireString(check, 'name', index),
    category: requireString(check, 'category', index),
    description: requireString(check, 'description', index),
    sql: requireString(check, 'sql', index),
    expected: requireNumber(check, 'expected', index),
    mode,
    source: requireString(check, 'source', index),
  };

  if (check['tolerance'] !== undefined) {
    result.tolerance = requireNumber(check, 'tolerance', index);
  }

  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCompareMode(value: unknown): value is CompareMode {
  return (
    value === 'exact' ||
    value === 'gte' ||
    value === 'lte' ||
    value === 'range' ||
    value === 'approx'
  );
}

function requireString(check: Record<string, unknown>, field: string, index: number): string {
  const value = check[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Accuracy check at index ${index} requires string field ${field}`);
  }
  return value;
}

function requireNumber(check: Record<string, unknown>, field: string, index: number): number {
  const value = check[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Accuracy check at index ${index} requires numeric field ${field}`);
  }
  return value;
}

function careerSumSql(metric: string, name: string): string {
  return `SELECT sum(${metric}_golden) AS val FROM api.v_golden_player_season_totals WHERE master_id = (SELECT CAST(player_id AS VARCHAR) FROM nbadb.dim_player WHERE full_name = '${escapeSql(name)}' LIMIT 1)`;
}

function parseStatValue(value: string): number | null {
  const normalized = value.replaceAll(',', '').trim();
  if (normalized.length === 0) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function findDataStatText(row: cheerio.Cheerio<AnyNode>, stats: string[]): string {
  for (const stat of stats) {
    const value = row.find(`[data-stat="${stat}"]`).first().text();
    if (value.trim().length > 0) {
      return value;
    }
  }

  return '';
}

function escapeSql(value: string): string {
  return value.replaceAll("'", "''");
}

function slugName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
