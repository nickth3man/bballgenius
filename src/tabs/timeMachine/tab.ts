import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  type ScrollBoxRenderable,
  TextRenderable,
} from '@opentui/core';
import type { AppKeyEvent } from '../../core/input.js';
import type { DbRow } from '../../core/types.js';
import {
  createPanel,
  createScrollPanel,
  dispatchKey,
  PaneFocusGroup,
  StatusLine,
} from '../../shared/ui/index.js';
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

  private playerGroup!: PaneFocusGroup;
  private teamGroup!: PaneFocusGroup;

  /** Player-mode focus index, backed by {@link playerGroup}; read/written by the mode controllers. */
  get focusIndex(): number {
    return this.playerGroup.index;
  }
  set focusIndex(value: number) {
    this.playerGroup.index = value;
  }

  /** Team-mode focus index, backed by {@link teamGroup}; read/written by the mode controllers. */
  get teamFocusIndex(): number {
    return this.teamGroup.index;
  }
  set teamFocusIndex(value: number) {
    this.teamGroup.index = value;
  }

  private activeGroup(): PaneFocusGroup {
    return this.mode === 'player' ? this.playerGroup : this.teamGroup;
  }

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

    this.playerGroup = new PaneFocusGroup([
      { panel: this.searchPanel, activate: () => this.searchInput.focus() },
      { panel: this.dossierPanel, activate: () => this.dossierScroll.focus() },
      { panel: this.statsPanel, activate: () => this.statsScroll.focus() },
    ]);
    this.teamGroup = new PaneFocusGroup([
      { panel: this.teamSearchPanel, activate: () => this.teamAInput.focus() },
      { panel: this.teamSearchPanel, activate: () => this.teamBInput.focus() },
      { panel: this.statsPanel, activate: () => this.statsScroll.focus() },
    ]);

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
    this.activeGroup().focusActive();
    this.requestRender();
  }

  private blurAllInputs(): void {
    this.searchInput.blur();
    this.teamAInput.blur();
    this.teamBInput.blur();
    this.statsScroll.blur();
    this.dossierScroll.blur();
  }

  cycleFocus(): void {
    this.activeGroup().next();
    this.focus();
  }

  cycleFocusBackward(): void {
    this.activeGroup().prev();
    this.focus();
  }

  getStatusLine(): string {
    const line = new StatusLine(' \xb7 ');

    if (this.mode === 'player') {
      this.buildPlayerStatusLine(line);
    } else {
      this.buildTeamStatusLine(line);
    }

    return line.toString();
  }

  private buildPlayerStatusLine(line: StatusLine): void {
    line.add(panelLabel(this.focusIndex, 'player', 0));

    const q = this.searchQuery.trim();
    if (this.focusIndex === 0) {
      if (q.length > 0) line.add(`query: "${q}"`);
      if (this.suggestions.length > 0) {
        line.add(`suggestion ${this.selectedSuggestIdx + 1}/${this.suggestions.length}`);
        const highlighted = this.suggestions[this.selectedSuggestIdx];
        if (highlighted?.full_name) line.add(highlighted.full_name);
      } else if (q.length < 2) {
        line.add('type 2+ chars to search');
      }
    }

    if (this.activePlayer?.full_name) {
      const loaded = this.activePlayer.full_name;
      if (!line.includes(loaded)) {
        line.add(`loaded: ${loaded}`);
      }
    }

    line.add(moveHint(this.focusIndex, 'player', 0));
  }

  private buildTeamStatusLine(line: StatusLine): void {
    line.add('Team Compare');

    if (this.teamFocusIndex === 0) {
      line.add(`Team A: "${this.teamAQuery}"`);
    } else if (this.teamFocusIndex === 1) {
      line.add(`Team B: "${this.teamBQuery}"`);
    } else {
      line.add('Comparison list');
    }

    line.add(moveHint(this.teamFocusIndex, 'team', this.teamFocusIndex));
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

    return dispatchKey(event, [
      (e) => this.tryBbrKeys(e, key),
      (e) => this.tryToggleMode(e),
      (e) => this.tryCycleFocus(e),
      (e) =>
        this.mode === 'player'
          ? this.playerMode.handleKeyPress(e)
          : this.teamMode.handleKeyPress(e),
    ]);
  }

  private tryToggleMode(event: AppKeyEvent): boolean {
    if (!this.isInputFocused() && (event.name === 'c' || event.sequence === 'c')) {
      this.toggleMode();
      return true;
    }
    return false;
  }

  private tryCycleFocus(event: AppKeyEvent): boolean {
    if (event.name === 'tab' && this.isInputFocused()) {
      if (event.shift) this.cycleFocusBackward();
      else this.cycleFocus();
      return true;
    }
    return false;
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
