import { type BbrMirroredPage, listMirroredPages } from './bbrMirroredStore.js';

export type BbrPlayerPageType =
  | 'profile'
  | 'gamelog'
  | 'gamelog-advanced'
  | 'gamelog-playoffs'
  | 'gamelog-playoffs-advanced'
  | 'splits'
  | 'shooting'
  | 'lineups'
  | 'on-off';

export interface BbrPlayerSubpageDef {
  id: BbrPlayerPageType;
  key: string;
  label: string;
  yearNav: boolean;
}

/** Player sub-pages mirroring basketball-reference.com profile navigation. */
export const BBR_PLAYER_SUBPAGES: BbrPlayerSubpageDef[] = [
  { id: 'profile', key: 'P', label: 'Profile', yearNav: false },
  { id: 'gamelog', key: 'G', label: 'Game Logs', yearNav: true },
  { id: 'gamelog-advanced', key: 'E', label: 'Advanced Logs', yearNav: true },
  { id: 'gamelog-playoffs', key: 'F', label: 'Playoff Logs', yearNav: false },
  { id: 'gamelog-playoffs-advanced', key: 'N', label: 'Playoff Adv Logs', yearNav: false },
  { id: 'splits', key: 'S', label: 'Splits', yearNav: true },
  { id: 'shooting', key: 'H', label: 'Shooting', yearNav: true },
  { id: 'lineups', key: 'L', label: 'Lineups', yearNav: true },
  { id: 'on-off', key: 'O', label: 'On-Off', yearNav: true },
];

export type BbrSitePageType =
  | 'draft'
  | 'allstar'
  | 'leaders_career'
  | 'leaders_season'
  | 'playoffs'
  | 'awards'
  | 'contracts'
  | 'season_summary'
  | 'game_boxscore'
  | 'game_shot_chart'
  | 'game_pbp'
  | 'teams_index'
  | 'team_profile'
  | 'players_index'
  | 'leagues_games'
  | 'boxscores_index'
  | 'coaches_index'
  | 'executives_index'
  | 'referees_index'
  | 'friv_index'
  | 'gleague_index'
  | 'international_index'
  | 'nbl_index'
  | 'wnba_index'
  | 'stathead_index'
  | 'tools_index'
  | 'play_index'
  | 'about_index'
  | 'mirrored';

export interface BbrSitePageDef {
  id: BbrSitePageType;
  key: string;
  label: string;
  defaultParam?: string;
  mirroredPath?: string;
}

/** Site-wide pages from the screenshot mirror (M key opens this menu). */
export const BBR_SITE_PAGES: BbrSitePageDef[] = [
  { id: 'players_index', key: '1', label: 'Players Index', mirroredPath: 'players/index.html' },
  { id: 'teams_index', key: '2', label: 'Teams Index', mirroredPath: 'teams/index.html' },
  { id: 'leaders_career', key: '3', label: 'Leaders Index', mirroredPath: 'leaders/index.html' },
  {
    id: 'leaders_season',
    key: '4',
    label: 'Active AST Leaders',
    mirroredPath: 'leaders/ast_active_c.html',
  },
  { id: 'season_summary', key: '5', label: 'Leagues Index', mirroredPath: 'leagues/index.html' },
  {
    id: 'leagues_games',
    key: '6',
    label: 'Season Schedule',
    mirroredPath: 'leagues/NBA_2009_games.html',
  },
  { id: 'boxscores_index', key: '7', label: 'Box Scores', mirroredPath: 'boxscores/index.html' },
  { id: 'playoffs', key: '8', label: 'Playoffs', defaultParam: '2024' },
  { id: 'draft', key: '9', label: 'Draft', defaultParam: '2024' },
  { id: 'allstar', key: 'A', label: 'All-Star', defaultParam: '2016' },
  { id: 'awards', key: 'W', label: 'Awards Index', mirroredPath: 'awards/index.html' },
  {
    id: 'mirrored',
    key: 'D',
    label: '1977 Awards Voting',
    mirroredPath: 'awards/awards_1977.html',
  },
  {
    id: 'mirrored',
    key: 'K',
    label: 'Kareem Profile (mirror)',
    mirroredPath: 'players/a/abdulka01.html',
  },
  { id: 'contracts', key: 'T', label: 'Contracts', defaultParam: 'CLE' },
  { id: 'coaches_index', key: 'C', label: 'Coaches', mirroredPath: 'coaches/index.html' },
  { id: 'executives_index', key: 'X', label: 'Executives', mirroredPath: 'executives/index.html' },
  { id: 'referees_index', key: 'R', label: 'Referees', mirroredPath: 'referees/index.html' },
  { id: 'friv_index', key: 'I', label: 'Fun & Games', mirroredPath: 'friv/index.html' },
  { id: 'gleague_index', key: 'J', label: 'G League', mirroredPath: 'gleague/index.html' },
  {
    id: 'international_index',
    key: 'U',
    label: 'International',
    mirroredPath: 'international/index.html',
  },
  { id: 'nbl_index', key: 'B', label: 'NBL', mirroredPath: 'nbl/index.html' },
  { id: 'wnba_index', key: 'Y', label: 'WNBA', mirroredPath: 'wnba/index.html' },
  {
    id: 'stathead_index',
    key: 'H',
    label: 'Stathead',
    mirroredPath: 'stathead/players/index.html',
  },
  { id: 'tools_index', key: 'Q', label: 'Tools', mirroredPath: 'tools/event_finder.cgi' },
  { id: 'play_index', key: 'Z', label: 'Play Index', mirroredPath: 'play-index/pgl_finder.cgi' },
  { id: 'about_index', key: 'V', label: 'About', mirroredPath: 'about/index.html' },
  { id: 'game_boxscore', key: '0', label: 'Sample Boxscore', defaultParam: '202406060BOS' },
];

export interface BbrSiteSection {
  id: string;
  label: string;
  pages: BbrMirroredPage[];
}

const SECTION_LABELS: Record<string, string> = {
  about: 'About',
  allstar: 'All-Star',
  awards: 'Awards',
  'bbr-blog': 'BBR Blog',
  blog: 'Blog',
  boxscores: 'Box Scores',
  coaches: 'Coaches',
  contracts: 'Contracts',
  draft: 'Draft',
  email: 'Newsletter',
  executives: 'Executives',
  feedback: 'Feedback',
  friv: 'Fun & Games',
  gleague: 'G League',
  international: 'International',
  leaders: 'Leaders',
  leagues: 'Leagues / Seasons',
  linker: 'Linker',
  nbl: 'NBL',
  players: 'Players',
  'play-index': 'Play Index',
  playoffs: 'Playoffs',
  referees: 'Referees',
  stathead: 'Stathead',
  teams: 'Teams',
  tools: 'Tools',
  trailers: 'Trailers',
  wnba: 'WNBA',
};

/** Builds a section-grouped catalog from mirrored screenshot / firecrawl JSON files. */
export function buildSiteCatalog(): BbrSiteSection[] {
  const pages = listMirroredPages();
  const bySection = new Map<string, BbrMirroredPage[]>();

  for (const page of pages) {
    const list = bySection.get(page.section) ?? [];
    list.push(page);
    bySection.set(page.section, list);
  }

  return [...bySection.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, sectionPages]) => ({
      id,
      label: SECTION_LABELS[id] ?? id,
      pages: sectionPages.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    }));
}

export function getPlayerSubpageByKey(key: string): BbrPlayerSubpageDef | undefined {
  return BBR_PLAYER_SUBPAGES.find((p) => p.key.toLowerCase() === key.toLowerCase());
}

export function getSitePageByKey(key: string): BbrSitePageDef | undefined {
  return BBR_SITE_PAGES.find((p) => p.key.toLowerCase() === key.toLowerCase());
}

export function buildBbrPlayerUrl(
  brefPlayerId: string,
  type: BbrPlayerPageType,
  year?: string,
): string {
  const normId = brefPlayerId.toLowerCase().trim();
  const initial = normId.charAt(0);

  if (type === 'profile') {
    return `https://www.basketball-reference.com/players/${initial}/${normId}.html`;
  }

  if (type === 'gamelog-playoffs' || type === 'gamelog-playoffs-advanced') {
    return `https://www.basketball-reference.com/players/${initial}/${normId}/${type}`;
  }

  const suffix = year ? `/${year}` : '';
  return `https://www.basketball-reference.com/players/${initial}/${normId}/${type}${suffix}`;
}
