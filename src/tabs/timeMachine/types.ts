import type {
  BoxRenderable,
  InputRenderable,
  ScrollBoxRenderable,
  TextRenderable,
} from '@opentui/core';
import type { DbRow } from '../../core/types.js';
import type { CareerStatRow, PlayerAwardRow } from './queries.js';
import type { BbrPlayerLinks } from './utils/bbr/bbrParser.js';
import type { BbrPlayerPageType } from './utils/bbr/bbrSiteCatalog.js';

export interface PlayerSuggestion {
  player_id: string;
  full_name: string;
  from_year: number | string;
  to_year: number | string;
  is_active: boolean;
}

export interface TeamComparisonData {
  team_id?: string;
  team_abbrev: string;
  team_name?: string;
  year: string;
  gp: number | string;
  ppg: number | string;
  apg: number | string;
  rpg: number | string;
  spg: number | string;
  bpg: number | string;
  errorMessage?: string;
}

export type TeamSubpageType =
  | 'comparison'
  | 'contracts'
  | 'season_summary'
  | 'playoffs'
  | 'awards'
  | 'leaders_index'
  | 'leagues_index'
  | 'team_season'
  | 'team_adv_gamelog'
  | 'game_boxscore'
  | 'game_shot_chart'
  | 'game_pbp'
  | 'teams_index'
  | 'team_a_profile'
  | 'team_b_profile';

/** Shared UI/state surface for player, team, and BBR mode controllers. */
export interface TimeMachineHost {
  readonly container: BoxRenderable;
  readonly searchPanel: BoxRenderable;
  readonly dossierPanel: BoxRenderable;
  readonly teamSearchPanel: BoxRenderable;
  readonly statsPanel: BoxRenderable;
  readonly searchInput: InputRenderable;
  readonly suggestionsText: TextRenderable;
  readonly dossierScroll: ScrollBoxRenderable;
  readonly dossierText: TextRenderable;
  readonly teamAInput: InputRenderable;
  readonly teamBInput: InputRenderable;
  readonly teamInstructions: TextRenderable;
  readonly statsScroll: ScrollBoxRenderable;
  readonly statsText: TextRenderable;

  mode: 'player' | 'team';
  searchQuery: string;
  suggestions: PlayerSuggestion[];
  selectedSuggestIdx: number;
  activePlayer: PlayerSuggestion | null;
  careerStats: CareerStatRow[];
  activeSubpage: BbrPlayerPageType | 'site';
  activePlayerMeta: DbRow | null;
  activePlayerAwards: PlayerAwardRow[];
  playerSublinks: BbrPlayerLinks | null;
  selectedYearIdx: number;
  selectedSiteSectionIdx: number;
  selectedSitePageIdx: number;
  siteCatalog: ReturnType<typeof import('./utils/bbr/bbrSiteCatalog.js').buildSiteCatalog>;
  activeTeamSubpage: TeamSubpageType;
  teamAQuery: string;
  teamBQuery: string;
  teamAData: TeamComparisonData | null;
  teamBData: TeamComparisonData | null;
  focusIndex: number;
  teamFocusIndex: number;
  focusablePanels: BoxRenderable[];

  requestRender(): void;
  focus(): void;
  isInputFocused(): boolean;
}
