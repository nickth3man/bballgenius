import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  ScrollBoxRenderable,
  TextRenderable,
} from '@opentui/core';
import type { AppKeyEvent } from '../../core/input.js';
import type { DbRow } from '../../core/types.js';
import { ansiToStyledText } from '../../shared/utils/formatters.js';
import { Theme } from '../../shared/utils/theme.js';
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
  focusablePanels: BoxRenderable[] = [];

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

    this.searchPanel = new BoxRenderable(renderer, {
      id: 'tm-search-panel',
      width: '100%',
      height: '38%',
      border: true,
      borderStyle: Theme.borderStyle,
      borderColor: Theme.borderNormal,
      focusedBorderColor: Theme.borderFocused,
      title: 'Player Search  (C → Team Compare)',
      titleAlignment: Theme.titleAlignment,
      paddingX: 1,
    });

    this.searchInput = new InputRenderable(renderer, {
      id: 'tm-search-input',
      width: '100%',
      placeholder: 'Type player name (e.g. LeBron, Chet)...',
      backgroundColor: '#222530',
    });

    this.suggestionsText = new TextRenderable(renderer, {
      id: 'tm-suggestions-text',
      content: '\nType 2+ characters to search',
      wrapMode: 'none',
    });

    this.searchPanel.add(this.searchInput);
    this.searchPanel.add(this.suggestionsText);

    this.dossierPanel = new BoxRenderable(renderer, {
      id: 'tm-dossier-panel',
      width: '100%',
      flexGrow: 1,
      border: true,
      borderStyle: Theme.borderStyle,
      borderColor: Theme.borderNormal,
      focusedBorderColor: Theme.borderFocused,
      title: 'Player Dossier',
      titleAlignment: Theme.titleAlignment,
      paddingX: 1,
    });

    this.dossierScroll = new ScrollBoxRenderable(renderer, {
      id: 'tm-dossier-scroll',
      width: '100%',
      height: '100%',
      viewportCulling: true,
    });

    this.dossierText = new TextRenderable(renderer, {
      id: 'tm-dossier-text',
      content: 'Select a player to view details.',
      wrapMode: 'word',
    });

    this.dossierScroll.add(this.dossierText);
    this.dossierPanel.add(this.dossierScroll);

    this.teamSearchPanel = new BoxRenderable(renderer, {
      id: 'tm-team-search-panel',
      width: '100%',
      height: '100%',
      border: true,
      borderStyle: Theme.borderStyle,
      borderColor: Theme.borderNormal,
      focusedBorderColor: Theme.borderFocused,
      title: 'Team Comparison  (C → Player Mode)',
      titleAlignment: Theme.titleAlignment,
      flexDirection: 'column',
      paddingX: 1,
      visible: false,
    });

    const teamAHeader = new TextRenderable(renderer, {
      id: 'tm-team-a-header',
      content: ansiToStyledText('\n\x1b[1;33mTeam A (e.g. Bulls 1996):\x1b[0m'),
    });

    this.teamAInput = new InputRenderable(renderer, {
      id: 'tm-team-a-input',
      width: '100%',
      placeholder: 'Type Team A + Year...',
      backgroundColor: '#222530',
    });
    this.teamAInput.value = this.teamAQuery;

    const teamBHeader = new TextRenderable(renderer, {
      id: 'tm-team-b-header',
      content: '\n\x1b[1;35mTeam B (e.g. Warriors 2017):\x1b[0m',
    });

    this.teamBInput = new InputRenderable(renderer, {
      id: 'tm-team-b-input',
      width: '100%',
      placeholder: 'Type Team B + Year...',
      backgroundColor: '#222530',
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

    this.statsPanel = new BoxRenderable(renderer, {
      id: 'tm-stats-panel',
      width: '58%',
      height: '100%',
      border: true,
      borderStyle: Theme.borderStyle,
      borderColor: Theme.borderNormal,
      focusedBorderColor: Theme.borderFocused,
      title: 'Career Statistics',
      titleAlignment: Theme.titleAlignment,
      paddingX: 1,
    });

    this.statsScroll = new ScrollBoxRenderable(renderer, {
      id: 'tm-stats-scroll',
      width: '100%',
      height: '100%',
      viewportCulling: true,
    });

    this.statsText = new TextRenderable(renderer, {
      id: 'tm-stats-text',
      content: 'Career season averages will be listed here.',
      wrapMode: 'none',
    });

    this.statsScroll.add(this.statsText);
    this.statsPanel.add(this.statsScroll);

    this.container.add(this.leftColumn);
    this.container.add(this.statsPanel);

    this.focusablePanels = [this.searchPanel, this.dossierPanel, this.statsPanel];

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
    this.searchInput.blur();
    this.teamAInput.blur();
    this.teamBInput.blur();
    this.statsScroll.blur();
    this.dossierScroll.blur();

    if (this.mode === 'player') {
      this.focusablePanels.forEach((panel, idx) => {
        if (idx === this.focusIndex) {
          panel.focus();
        } else {
          panel.blur();
        }
      });

      if (this.focusIndex === 0) {
        this.searchInput.focus();
      } else if (this.focusIndex === 1) {
        this.dossierScroll.focus();
      } else {
        this.statsScroll.focus();
      }
    } else {
      this.teamSearchPanel.blur();
      this.statsPanel.blur();

      if (this.teamFocusIndex === 0 || this.teamFocusIndex === 1) {
        this.teamSearchPanel.focus();
      } else {
        this.statsPanel.focus();
      }

      if (this.teamFocusIndex === 0) {
        this.teamAInput.focus();
      } else if (this.teamFocusIndex === 1) {
        this.teamBInput.focus();
      } else {
        this.statsScroll.focus();
      }
    }
    this.requestRender();
  }

  cycleFocus(): void {
    if (this.mode === 'player') {
      this.focusIndex = (this.focusIndex + 1) % this.focusablePanels.length;
    } else {
      this.teamFocusIndex = (this.teamFocusIndex + 1) % 3;
    }
    this.focus();
  }

  cycleFocusBackward(): void {
    if (this.mode === 'player') {
      this.focusIndex =
        (this.focusIndex - 1 + this.focusablePanels.length) % this.focusablePanels.length;
    } else {
      this.teamFocusIndex = (this.teamFocusIndex - 1 + 3) % 3;
    }
    this.focus();
  }

  getStatusLine(): string {
    const parts: string[] = [];

    if (this.mode === 'player') {
      if (this.focusIndex === 0) {
        parts.push('Search');
        const q = this.searchQuery.trim();
        if (q.length > 0) {
          parts.push(`query: "${q}"`);
        }
        if (this.suggestions.length > 0) {
          parts.push(`suggestion ${this.selectedSuggestIdx + 1}/${this.suggestions.length}`);
          const highlighted = this.suggestions[this.selectedSuggestIdx];
          if (highlighted?.full_name) {
            parts.push(highlighted.full_name);
          }
        } else if (q.length < 2) {
          parts.push('type 2+ chars to search');
        }
        parts.push('↑↓ pick · Enter select · Tab→dossier · C→Team Compare');
      } else if (this.focusIndex === 1) {
        parts.push('Dossier');
        if (this.activePlayer?.full_name) {
          parts.push(this.activePlayer.full_name);
        }
        parts.push('↑↓ scroll accolades · Tab→stats');
      } else {
        parts.push('Career stats');
        if (this.activePlayer?.full_name) {
          parts.push(this.activePlayer.full_name);
        }
        parts.push('↑↓ scroll · Tab→search · C→Team Compare');
      }

      if (this.activePlayer?.full_name && this.focusIndex === 0) {
        const loaded = this.activePlayer.full_name;
        if (!parts.includes(loaded)) {
          parts.splice(1, 0, `loaded: ${loaded}`);
        }
      }
    } else {
      parts.push('Team Compare');
      if (this.teamFocusIndex === 0) {
        parts.push(`Team A: "${this.teamAQuery}"`);
        parts.push('Type & Enter to lock · Tab→Team B · C→Player Profile');
      } else if (this.teamFocusIndex === 1) {
        parts.push(`Team B: "${this.teamBQuery}"`);
        parts.push('Type & Enter to lock · Tab→ratios · C→Player Profile');
      } else {
        parts.push('Comparison list');
        parts.push('↑↓ scroll · Tab→Team A · C→Player Profile');
      }
    }

    return parts.join(' · ');
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
      this.focus();
    } else {
      this.teamAInput.blur();
      this.teamBInput.blur();
      this.teamFocusIndex = 2;
      this.focus();
    }
  }

  handleKeyPress(event: AppKeyEvent): boolean {
    const key = (event.sequence || event.name || '').toLowerCase();

    if (!this.isInputFocused() && this.mode === 'player' && this.activePlayerMeta?.bref_player_id) {
      if (this.bbrView.handlePlayerBbrKeys(key)) {
        if (this.activeSubpage === 'profile') {
          this.playerMode.renderDossier(this.activePlayerMeta, this.activePlayerAwards);
          this.playerMode.renderStats();
        } else if (this.activeSubpage === 'site') {
          this.playerMode.renderDossier(this.activePlayerMeta, this.activePlayerAwards);
          this.bbrView.renderSiteCatalog();
        } else if (this.activePlayerMeta) {
          this.playerMode.renderDossier(this.activePlayerMeta, this.activePlayerAwards);
        }
        return true;
      }
    }

    if (!this.isInputFocused() && this.mode === 'team') {
      if (this.bbrView.handleTeamBbrKeys(key)) {
        if (this.activeTeamSubpage === 'comparison') {
          this.teamMode.renderTeamComparison();
        } else {
          this.teamMode.renderTeamInstructions();
        }
        return true;
      }
    }

    if (!this.isInputFocused() && (event.name === 'c' || event.sequence === 'c')) {
      this.toggleMode();
      return true;
    }

    if (event.name === 'tab') {
      if (this.isInputFocused()) {
        if (event.shift) {
          this.cycleFocusBackward();
        } else {
          this.cycleFocus();
        }
        return true;
      }
    }

    if (this.mode === 'player') {
      return this.playerMode.handleKeyPress(event);
    }
    return this.teamMode.handleKeyPress(event);
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
