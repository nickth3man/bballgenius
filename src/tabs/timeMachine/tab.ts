import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  type ScrollBoxRenderable,
  TextRenderable,
} from '@opentui/core';
import type { AppKeyEvent } from '../../core/input.js';
import type { DbRow } from '../../core/types.js';
import { createPanel, createScrollPanel } from '../../shared/ui/index.js';
import { ansiToStyledText } from '../../shared/utils/formatters.js';
import { ansiMagenta, ansiYellow, Theme } from '../../shared/utils/theme.js';
import { BbrViewController } from './bbrView.js';
import { PlayerModeController } from './playerMode.js';
import type { CareerStatRow, PlayerAwardRow } from './queries.js';
import { loadDefaultPlayer } from './queries.js';
import { TeamModeController } from './teamMode.js';
import type {
  PlayerSuggestion,
  TeamComparisonData,
  TeamSubpageType,
  TimeMachineHost,
} from './types.js';
import type { BbrPlayerLinks } from './utils/bbr/bbrParser.js';
import type { BbrPlayerPageType } from './utils/bbr/bbrSiteCatalog.js';
import { buildSiteCatalog } from './utils/bbr/bbrSiteCatalog.js';

const PLAYER_FOCUS_PANELS = 3;
const TEAM_FOCUS_PANELS = 3;

function panelLabel(idx: number, mode: 'player' | 'team', teamFocusIdx: number): string {
  const playerLabels = ['Search', 'Dossier', 'Career stats'];
  const teamLabels = ['Team A', 'Team B', 'Comparison'];
  if (mode === 'player') return playerLabels[idx] ?? 'Search';
  return teamLabels[teamFocusIdx] ?? 'Team A';
}

function moveHint(idx: number, mode: 'player' | 'team', teamFocusIdx: number): string {
  if (mode === 'player') {
    const hints = [
      '\u2191\u2193 pick \xb7 Enter select \xb7 Tab\u2192dossier \xb7 C\u2192Team Compare',
      '\u2191\u2193 scroll \xb7 Tab\u2192stats',
      '\u2191\u2193 scroll \xb7 Tab\u2192search \xb7 C\u2192Team Compare',
    ];
    return hints[idx] ?? '';
  }
  const hints = [
    'Type & Enter to lock \xb7 Tab\u2192Team B \xb7 C\u2192Player Mode',
    'Type & Enter to lock \xb7 Tab\u2192ratios \xb7 C\u2192Player Mode',
    '\u2191\u2193 scroll \xb7 Tab\u2192Team A \xb7 C\u2192Player Mode',
  ];
  return hints[teamFocusIdx] ?? '';
}

export class TimeMachineTab implements TimeMachineHost {
  readonly id = 'time-machine';
  readonly name = 'Career Time-Machine';
  readonly container: BoxRenderable;

  readonly leftColumn: BoxRenderable;
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

  private readonly playerMode: PlayerModeController;
  private readonly teamMode: TeamModeController;
  private readonly bbrView: BbrViewController;

  mode: 'player' | 'team' = 'player';
  searchQuery = '';
  suggestions: PlayerSuggestion[] = [];
  selectedSuggestIdx = 0;

  activePlayer: PlayerSuggestion | null = null;
  careerStats: CareerStatRow[] = [];

  activeSubpage: BbrPlayerPageType | 'site' = 'profile';
  activePlayerMeta: DbRow | null = null;
  activePlayerAwards: PlayerAwardRow[] = [];
  playerSublinks: BbrPlayerLinks | null = null;
  selectedYearIdx = 0;
  selectedSiteSectionIdx = 0;
  selectedSitePageIdx = 0;
  siteCatalog = buildSiteCatalog();

  activeTeamSubpage: TeamSubpageType = 'comparison';

  teamAQuery = 'LAL 2025';
  teamBQuery = 'PHI 2025';
  teamAData: TeamComparisonData | null = null;
  teamBData: TeamComparisonData | null = null;

  focusIndex = 0;
  teamFocusIndex = 0;
  readonly focusablePanels: BoxRenderable[] = [];

  constructor(renderer: CliRenderer) {
    this.bbrView = new BbrViewController(this);
    this.playerMode = new PlayerModeController(this, this.bbrView);
    this.teamMode = new TeamModeController(this);

    this.container = new BoxRenderable(renderer, {
      id: 'time-machine-container',
      width: '100%',
      height: '100%',
      flexDirection: 'row',
      gap: Theme.gap,
      backgroundColor: Theme.background,
    });

    this.leftColumn = new BoxRenderable(renderer, {
      id: 'tm-left-column',
      width: '42%',
      height: '100%',
      flexDirection: 'column',
      gap: Theme.gap,
    });

    this.searchPanel = createPanel(renderer, {
      id: 'tm-search-panel',
      title: 'Player Search  (C \u2192 Team Compare)',
      height: '38%',
    });

    this.searchInput = new InputRenderable(renderer, {
      id: 'tm-search-input',
      width: '100%',
      placeholder: 'Type player name (e.g. LeBron, Chet)...',
      backgroundColor: Theme.inputBg,
    });

    this.suggestionsText = new TextRenderable(renderer, {
      id: 'tm-suggestions-text',
      content: '\nType 2+ characters to search',
      wrapMode: 'none',
    });

    this.searchPanel.add(this.searchInput);
    this.searchPanel.add(this.suggestionsText);

    const dossier = createScrollPanel(renderer, {
      id: 'tm-dossier',
      title: 'Player Dossier',
      flexGrow: 1,
    });
    this.dossierPanel = dossier.panel;
    this.dossierScroll = dossier.scroll;
    this.dossierText = dossier.text;

    this.teamSearchPanel = createPanel(renderer, {
      id: 'tm-team-search-panel',
      title: 'Team Comparison  (C \u2192 Player Mode)',
      visible: false,
      flexDirection: 'column' as const,
    });

    const teamAHeader = new TextRenderable(renderer, {
      id: 'tm-team-a-header',
      content: ansiToStyledText(`\n${ansiYellow('Team A (e.g. Bulls 1996):')}`),
    });

    this.teamAInput = new InputRenderable(renderer, {
      id: 'tm-team-a-input',
      width: '100%',
      placeholder: 'Type Team A + Year...',
      backgroundColor: Theme.inputBg,
    });
    this.teamAInput.value = this.teamAQuery;

    const teamBHeader = new TextRenderable(renderer, {
      id: 'tm-team-b-header',
      content: ansiToStyledText(`\n${ansiMagenta('Team B (e.g. Warriors 2017):')}`),
    });

    this.teamBInput = new InputRenderable(renderer, {
      id: 'tm-team-b-input',
      width: '100%',
      placeholder: 'Type Team B + Year...',
      backgroundColor: Theme.inputBg,
    });
    this.teamBInput.value = this.teamBQuery;

    this.teamInstructions = new TextRenderable(renderer, {
      id: 'tm-team-instructions',
      content: '',
    });
    this.teamMode.renderTeamInstructions();

    this.teamSearchPanel.add(teamAHeader);
    this.teamSearchPanel.add(this.teamAInput);
    this.teamSearchPanel.add(teamBHeader);
    this.teamSearchPanel.add(this.teamBInput);
    this.teamSearchPanel.add(this.teamInstructions);

    this.leftColumn.add(this.searchPanel);
    this.leftColumn.add(this.dossierPanel);
    this.leftColumn.add(this.teamSearchPanel);

    const stats = createScrollPanel(renderer, {
      id: 'tm-stats',
      title: 'Career Statistics',
      width: '58%',
    });
    this.statsPanel = stats.panel;
    this.statsScroll = stats.scroll;
    this.statsText = stats.text;

    this.container.add(this.leftColumn);
    this.container.add(this.statsPanel);

    this.searchInput.on('input', () => {
      this.searchQuery = this.searchInput.value;
      void this.playerMode.searchPlayers();
    });

    this.searchInput.on('enter', () => {
      void this.playerMode.selectHighlightedSuggestion();
    });

    this.teamAInput.on('input', () => {
      this.teamAQuery = this.teamAInput.value;
    });

    this.teamAInput.on('enter', () => {
      void this.teamMode.loadTeamData('A');
    });

    this.teamBInput.on('input', () => {
      this.teamBQuery = this.teamBInput.value;
    });

    this.teamBInput.on('enter', () => {
      void this.teamMode.loadTeamData('B');
    });
  }

  requestRender(): void {
    this.container.requestRender();
  }

  async init(): Promise<void> {
    try {
      const defaultPlayer = await loadDefaultPlayer();
      if (defaultPlayer) {
        await this.playerMode.loadPlayerDetails(defaultPlayer);
      }
    } catch {
      // Quietly continue if default fail
    }
  }

  focus(): void {
    this.blurAllInputs();

    if (this.mode === 'player') {
      this.applyPlayerFocus();
    } else {
      this.applyTeamFocus();
    }
    this.requestRender();
  }

  private blurAllInputs(): void {
    this.searchInput.blur();
    this.teamAInput.blur();
    this.teamBInput.blur();
    this.statsScroll.blur();
    this.dossierScroll.blur();
  }

  private applyPlayerFocus(): void {
    const panels = [this.searchPanel, this.dossierPanel, this.statsPanel];
    this.blurAndFocusPanel(panels, this.focusIndex);

    if (this.focusIndex === 0) this.searchInput.focus();
    else if (this.focusIndex === 1) this.dossierScroll.focus();
    else this.statsScroll.focus();
  }

  private applyTeamFocus(): void {
    this.teamSearchPanel.blur();
    this.statsPanel.blur();

    if (this.teamFocusIndex === 0 || this.teamFocusIndex === 1) {
      this.teamSearchPanel.focus();
    } else {
      this.statsPanel.focus();
    }

    if (this.teamFocusIndex === 0) this.teamAInput.focus();
    else if (this.teamFocusIndex === 1) this.teamBInput.focus();
    else this.statsScroll.focus();
  }

  private blurAndFocusPanel(panels: BoxRenderable[], targetIdx: number): void {
    panels.forEach((panel, idx) => {
      if (idx === targetIdx) {
        panel.focus();
      } else {
        panel.blur();
      }
    });
  }

  cycleFocus(): void {
    if (this.mode === 'player') {
      this.focusIndex = (this.focusIndex + 1) % PLAYER_FOCUS_PANELS;
    } else {
      this.teamFocusIndex = (this.teamFocusIndex + 1) % TEAM_FOCUS_PANELS;
    }
    this.focus();
  }

  cycleFocusBackward(): void {
    if (this.mode === 'player') {
      this.focusIndex = (this.focusIndex - 1 + PLAYER_FOCUS_PANELS) % PLAYER_FOCUS_PANELS;
    } else {
      this.teamFocusIndex = (this.teamFocusIndex - 1 + TEAM_FOCUS_PANELS) % TEAM_FOCUS_PANELS;
    }
    this.focus();
  }

  getStatusLine(): string {
    const parts: string[] = [];
    const mode = this.mode;

    if (mode === 'player') {
      this.buildPlayerStatusLine(parts);
    } else {
      this.buildTeamStatusLine(parts);
    }

    return parts.join(' \xb7 ');
  }

  private buildPlayerStatusLine(parts: string[]): void {
    parts.push(panelLabel(this.focusIndex, 'player', 0));

    const q = this.searchQuery.trim();
    if (this.focusIndex === 0) {
      if (q.length > 0) parts.push(`query: "${q}"`);
      if (this.suggestions.length > 0) {
        parts.push(`suggestion ${this.selectedSuggestIdx + 1}/${this.suggestions.length}`);
        const highlighted = this.suggestions[this.selectedSuggestIdx];
        if (highlighted?.full_name) parts.push(highlighted.full_name);
      } else if (q.length < 2) {
        parts.push('type 2+ chars to search');
      }
    }

    if (this.activePlayer?.full_name) {
      const loaded = this.activePlayer.full_name;
      if (!parts.some((p) => p.includes(loaded))) {
        parts.push(`loaded: ${loaded}`);
      }
    }

    parts.push(moveHint(this.focusIndex, 'player', 0));
  }

  private buildTeamStatusLine(parts: string[]): void {
    parts.push('Team Compare');

    if (this.teamFocusIndex === 0) {
      parts.push(`Team A: "${this.teamAQuery}"`);
    } else if (this.teamFocusIndex === 1) {
      parts.push(`Team B: "${this.teamBQuery}"`);
    } else {
      parts.push('Comparison list');
    }

    parts.push(moveHint(this.teamFocusIndex, 'team', this.teamFocusIndex));
  }

  isInputFocused(): boolean {
    if (this.mode === 'player') {
      return this.searchInput.focused;
    }
    return this.teamAInput.focused || this.teamBInput.focused;
  }

  blurInput(): void {
    if (this.mode === 'player') {
      this.searchInput.blur();
      this.focusIndex = 1;
    } else {
      this.teamAInput.blur();
      this.teamBInput.blur();
      this.teamFocusIndex = 2;
    }
    this.focus();
  }

  handleKeyPress(event: AppKeyEvent): boolean {
    const key = (event.sequence || event.name || '').toLowerCase();

    if (this.tryBbrKeys(event, key)) return true;

    if (!this.isInputFocused() && (event.name === 'c' || event.sequence === 'c')) {
      this.toggleMode();
      return true;
    }

    if (event.name === 'tab') {
      if (this.isInputFocused()) {
        if (event.shift) this.cycleFocusBackward();
        else this.cycleFocus();
        return true;
      }
    }

    if (this.mode === 'player') return this.playerMode.handleKeyPress(event);
    return this.teamMode.handleKeyPress(event);
  }

  private tryBbrKeys(_event: AppKeyEvent, key: string): boolean {
    if (this.isInputFocused()) return false;

    if (this.mode === 'player' && this.activePlayerMeta?.bref_player_id) {
      if (this.bbrView.handlePlayerBbrKeys(key)) {
        this.handleBbrPostAction();
        return true;
      }
    }

    if (this.mode === 'team' && this.bbrView.handleTeamBbrKeys(key)) {
      if (this.activeTeamSubpage === 'comparison') {
        this.teamMode.renderTeamComparison();
      } else {
        this.teamMode.renderTeamInstructions();
      }
      return true;
    }

    return false;
  }

  private handleBbrPostAction(): void {
    if (!this.activePlayerMeta) return;
    if (this.activeSubpage === 'profile') {
      this.playerMode.renderDossier(this.activePlayerMeta, this.activePlayerAwards);
      this.playerMode.renderStats();
    } else if (this.activeSubpage === 'site') {
      this.playerMode.renderDossier(this.activePlayerMeta, this.activePlayerAwards);
      this.bbrView.renderSiteCatalog();
    } else {
      this.playerMode.renderDossier(this.activePlayerMeta, this.activePlayerAwards);
    }
  }

  private toggleMode(): void {
    this.mode = this.mode === 'player' ? 'team' : 'player';

    if (this.mode === 'player') {
      this.teamMode.hidePanels();
      this.focusIndex = 0;
      this.playerMode.renderStats();
    } else {
      this.teamMode.showPanels();
      this.teamMode.ensureDefaultTeamsLoaded();
      this.teamMode.renderTeamInstructions();
      this.teamMode.renderTeamComparison();
    }
    this.focus();
  }

  /** @internal Test access for team roster loads */
  async loadTeamData(type: 'A' | 'B'): Promise<void> {
    return this.teamMode.loadTeamData(type);
  }
}
