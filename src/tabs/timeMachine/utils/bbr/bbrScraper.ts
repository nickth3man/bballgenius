import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getMirroredRelativePath,
  readMirroredMarkdown,
  readMirroredMarkdownFromUrl,
} from './bbrMirroredStore.js';
import {
  type BbrPlayerPageType,
  type BbrSitePageType,
  buildBbrPlayerUrl,
} from './bbrSiteCatalog.js';

const FIRECRAWL_DIR = join(import.meta.dirname, '..', '..', '..', '..', '..', '..', '.firecrawl');

export type { BbrPlayerPageType };

function getMirroredCachePath(url: string): string | null {
  const relativePath = getMirroredRelativePath(url);
  if (!relativePath) {
    return null;
  }
  return join(FIRECRAWL_DIR, `${relativePath}.md`);
}

function readCacheIfExists(cachePath: string | null): string | null {
  if (cachePath && existsSync(cachePath)) {
    return readFileSync(cachePath, 'utf-8');
  }
  return null;
}

function getCachedFilePath(
  brefPlayerId: string,
  type: BbrPlayerPageType,
  year?: string,
): string | null {
  const normId = brefPlayerId.toLowerCase();

  if (normId === 'jamesle01' && type === 'profile') {
    return join(FIRECRAWL_DIR, 'bbr-player-lebron.md');
  }

  if (normId === 'tuckepj01') {
    if (type === 'profile') {
      return join(FIRECRAWL_DIR, 'bbr-tucker-profile.md');
    }
    if (year === '2024') {
      if (type === 'gamelog') return join(FIRECRAWL_DIR, 'bbr-tucker-gamelog-2024.md');
      if (type === 'splits') return join(FIRECRAWL_DIR, 'bbr-tucker-splits-2024.md');
      if (type === 'shooting') return join(FIRECRAWL_DIR, 'bbr-tucker-shooting-2024.md');
      if (type === 'lineups') return join(FIRECRAWL_DIR, 'bbr-tucker-lineups-2024.md');
      if (type === 'on-off') return join(FIRECRAWL_DIR, 'bbr-tucker-on-off-2024.md');
    }
  }

  if (type === 'profile') {
    const stdPath = join(FIRECRAWL_DIR, `bbr-player-${normId}.md`);
    if (existsSync(stdPath)) return stdPath;
  } else {
    const stdPath = join(FIRECRAWL_DIR, `bbr-${type}-${normId}-${year || 'current'}.md`);
    if (existsSync(stdPath)) return stdPath;
  }

  return null;
}

export function getBbrUrl(brefPlayerId: string, type: BbrPlayerPageType, year?: string): string {
  return buildBbrPlayerUrl(brefPlayerId, type, year);
}

export function fetchMirroredPage(relativePath: string): string {
  const cached = readMirroredMarkdown(relativePath);
  if (cached) {
    return cached;
  }

  const urlPath =
    relativePath.endsWith('.html') || relativePath.includes('.')
      ? relativePath
      : `${relativePath}/index.html`;
  const url = `https://www.basketball-reference.com/${urlPath}`;
  const stdCachePath = join(FIRECRAWL_DIR, `${relativePath.replace(/\\/g, '/')}.md`);

  try {
    execFileSync('firecrawl', ['scrape', url, '--format', 'markdown', '-o', stdCachePath], {
      stdio: 'ignore',
    });
    if (existsSync(stdCachePath)) {
      return readFileSync(stdCachePath, 'utf-8');
    }
  } catch {
    throw new Error(
      `Failed to scrape ${url} using Firecrawl. Ensure you are connected to the internet.`,
    );
  }

  throw new Error(`Content for mirrored path ${relativePath} is not available offline.`);
}

export async function fetchBbrPage(
  brefPlayerId: string,
  type: BbrPlayerPageType,
  year?: string,
): Promise<string> {
  const cachePath = getCachedFilePath(brefPlayerId, type, year);
  if (cachePath && existsSync(cachePath)) {
    return readFileSync(cachePath, 'utf-8');
  }

  const url = getBbrUrl(brefPlayerId, type, year);
  const normId = brefPlayerId.toLowerCase().trim();
  const stdCachePath =
    type === 'profile'
      ? join(FIRECRAWL_DIR, `bbr-player-${normId}.md`)
      : join(FIRECRAWL_DIR, `bbr-${type}-${normId}-${year || 'current'}.md`);

  const stdCached = readCacheIfExists(stdCachePath);
  if (stdCached) {
    return stdCached;
  }

  const mirroredFromUrl = readMirroredMarkdownFromUrl(url);
  if (mirroredFromUrl) {
    return mirroredFromUrl;
  }

  const mirroredCached = readCacheIfExists(getMirroredCachePath(url));
  if (mirroredCached) {
    return mirroredCached;
  }

  try {
    execFileSync('firecrawl', ['scrape', url, '--format', 'markdown', '-o', stdCachePath], {
      stdio: 'ignore',
    });
    if (existsSync(stdCachePath)) {
      return readFileSync(stdCachePath, 'utf-8');
    }
  } catch {
    throw new Error(
      `Failed to scrape ${url} using Firecrawl. Ensure you are connected to the internet.`,
    );
  }

  throw new Error(`Content for player ${brefPlayerId} (type: ${type}) is not available offline.`);
}

export type BbrGeneralType =
  | 'playoffs'
  | 'draft'
  | 'contracts'
  | 'allstar'
  | 'awards'
  | 'leaders_career'
  | 'leaders_season'
  | 'season_summary'
  | 'game_boxscore'
  | 'game_shot_chart'
  | 'game_pbp';

export function getBbrGeneralUrlAndCachePath(
  type: BbrGeneralType,
  param: string,
): { url: string; cachePath: string } {
  const normParam = param.trim();
  let url = '';
  let cacheFileName = '';

  switch (type) {
    case 'playoffs':
      url = `https://www.basketball-reference.com/playoffs/NBA_${normParam}.html`;
      cacheFileName = `bbr-playoffs-${normParam}.md`;
      break;
    case 'draft':
      url = `https://www.basketball-reference.com/draft/NBA_${normParam}.html`;
      cacheFileName = `bbr-draft-${normParam}.md`;
      break;
    case 'contracts':
      url = `https://www.basketball-reference.com/contracts/${normParam.toUpperCase()}.html`;
      cacheFileName = `bbr-contracts-${normParam.toLowerCase()}.md`;
      break;
    case 'allstar':
      url = `https://www.basketball-reference.com/allstar/NBA_${normParam}.html`;
      cacheFileName = `bbr-allstar-${normParam}.md`;
      break;
    case 'awards':
      url = `https://www.basketball-reference.com/awards/awards_${normParam}.html`;
      cacheFileName = `bbr-awards-${normParam}.md`;
      break;
    case 'leaders_career':
      url = `https://www.basketball-reference.com/leaders/${normParam}_career.html`;
      cacheFileName = `bbr-leaders-career-${normParam}.md`;
      break;
    case 'leaders_season':
      url = `https://www.basketball-reference.com/leagues/NBA_${normParam}_leaders.html`;
      cacheFileName = `bbr-leaders-season-${normParam}.md`;
      break;
    case 'season_summary':
      url = `https://www.basketball-reference.com/leagues/NBA_${normParam}.html`;
      cacheFileName = `bbr-season-${normParam}.md`;
      break;
    case 'game_boxscore':
      url = `https://www.basketball-reference.com/boxscores/${normParam}.html`;
      cacheFileName = 'bbr-game-boxscore.md';
      break;
    case 'game_shot_chart':
      url = `https://www.basketball-reference.com/boxscores/shot-chart/${normParam}.html`;
      cacheFileName = 'bbr-game-shot-chart.md';
      break;
    case 'game_pbp':
      url = `https://www.basketball-reference.com/boxscores/pbp/${normParam}.html`;
      cacheFileName = 'bbr-game-pbp.md';
      break;
  }

  return {
    url,
    cachePath: join(FIRECRAWL_DIR, cacheFileName),
  };
}

export async function fetchBbrSitePage(
  pageId: BbrSitePageType,
  param?: string,
  mirroredPath?: string,
): Promise<string> {
  if (pageId === 'mirrored' && mirroredPath) {
    return fetchMirroredPage(mirroredPath);
  }

  if (mirroredPath) {
    const mirrored = readMirroredMarkdown(mirroredPath);
    if (mirrored) {
      return mirrored;
    }
    return fetchMirroredPage(mirroredPath);
  }

  const generalMap: Partial<Record<BbrSitePageType, BbrGeneralType>> = {
    draft: 'draft',
    allstar: 'allstar',
    leaders_career: 'leaders_career',
    leaders_season: 'leaders_season',
    playoffs: 'playoffs',
    awards: 'awards',
    contracts: 'contracts',
    season_summary: 'season_summary',
    game_boxscore: 'game_boxscore',
    game_shot_chart: 'game_shot_chart',
    game_pbp: 'game_pbp',
  };

  const generalType = generalMap[pageId];
  if (generalType && param) {
    return fetchBbrGeneralPage(generalType, param);
  }

  throw new Error(`Site page ${pageId} is not available offline.`);
}

export async function fetchBbrGeneralPage(type: BbrGeneralType, param: string): Promise<string> {
  const { url, cachePath } = getBbrGeneralUrlAndCachePath(type, param);

  const cached = readCacheIfExists(cachePath);
  if (cached) {
    return cached;
  }

  const mirroredFromUrl = readMirroredMarkdownFromUrl(url);
  if (mirroredFromUrl) {
    return mirroredFromUrl;
  }

  const mirroredCached = readCacheIfExists(getMirroredCachePath(url));
  if (mirroredCached) {
    return mirroredCached;
  }

  try {
    execFileSync('firecrawl', ['scrape', url, '--format', 'markdown', '-o', cachePath], {
      stdio: 'ignore',
    });
    if (existsSync(cachePath)) {
      return readFileSync(cachePath, 'utf-8');
    }
  } catch {
    throw new Error(
      `Failed to scrape BBR category page ${url} using Firecrawl. Ensure you are connected to the internet.`,
    );
  }

  throw new Error(`Content for general BBR page type ${type} (${param}) is not available offline.`);
}

export async function fetchBbrTeamPage(teamAbbrev: string): Promise<string> {
  const abbrev = teamAbbrev.toUpperCase();
  const relativePath = `teams/${abbrev}/index.html`;
  const mirrored = readMirroredMarkdown(relativePath);
  if (mirrored) {
    return mirrored;
  }
  return fetchMirroredPage(relativePath);
}
