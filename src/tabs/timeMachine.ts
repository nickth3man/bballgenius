import { BoxRenderable, TextRenderable, ScrollBoxRenderable, InputRenderable, KeyEvent } from '@opentui/core';
import { query } from '../db.js';
import { formatTable, ansiToStyledText } from '../utils/formatters.js';
import { Theme } from '../utils/theme.js';
import { loadPlayerAwards, loadCareerStats } from '../queries/timeMachine.js';

export class TimeMachineTab {
  readonly id = 'time-machine';
  readonly name = 'Career Time-Machine';
  readonly container: BoxRenderable;

  // UI Panels
  private readonly leftColumn: BoxRenderable;
  private readonly searchPanel: BoxRenderable;
  private readonly dossierPanel: BoxRenderable;
  private readonly statsPanel: BoxRenderable;

  // UI Widgets
  private readonly searchInput: InputRenderable;
  private readonly suggestionsText: TextRenderable;
  private readonly dossierText: TextRenderable;
  private readonly statsScroll: ScrollBoxRenderable;
  private readonly statsText: TextRenderable;

  // State
  private searchQuery = '';
  private suggestions: any[] = [];
  private selectedSuggestIdx = 0;

  private activePlayer: any = null;
  private careerStats: any[] = [];

  // Focus Management
  // 0 = Search Input, 1 = Career Stats Scroll
  private focusIndex = 0;
  private focusablePanels: BoxRenderable[] = [];

  constructor(renderer: any) {
    // Parent container
    this.container = new BoxRenderable(renderer, {
      id: 'time-machine-container',
      width: '100%',
      height: '100%',
      flexDirection: 'row',
      backgroundColor: Theme.background,
    });

    // Left Column: Search & Dossier
    this.leftColumn = new BoxRenderable(renderer, {
      id: 'tm-left-column',
      width: '45%',
      height: '100%',
      flexDirection: 'column',
    });

    // Search Panel
    this.searchPanel = new BoxRenderable(renderer, {
      id: 'tm-search-panel',
      width: '100%',
      height: '45%',
      border: true,
      borderStyle: Theme.borderStyle,
      borderColor: Theme.borderNormal,
      focusedBorderColor: Theme.borderFocused,
      title: 'Player Search',
      titleAlignment: Theme.titleAlignment,
    });

    // Interactive input
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

    // Dossier Panel
    this.dossierPanel = new BoxRenderable(renderer, {
      id: 'tm-dossier-panel',
      width: '100%',
      height: '55%',
      border: true,
      borderStyle: Theme.borderStyle,
      borderColor: Theme.borderNormal,
      title: 'Player Dossier',
      titleAlignment: Theme.titleAlignment,
    });

    this.dossierText = new TextRenderable(renderer, {
      id: 'tm-dossier-text',
      content: 'Select a player to view details.',
      wrapMode: 'none',
    });

    this.dossierPanel.add(this.dossierText);

    this.leftColumn.add(this.searchPanel);
    this.leftColumn.add(this.dossierPanel);

    // Right Column: Career Stats Grid
    this.statsPanel = new BoxRenderable(renderer, {
      id: 'tm-stats-panel',
      width: '55%',
      height: '100%',
      border: true,
      borderStyle: Theme.borderStyle,
      borderColor: Theme.borderNormal,
      focusedBorderColor: Theme.borderFocused,
      title: 'Career Statistics',
      titleAlignment: Theme.titleAlignment,
    });

    this.statsScroll = new ScrollBoxRenderable(renderer, {
      id: 'tm-stats-scroll',
      width: '100%',
      height: '100%',
    });

    this.statsText = new TextRenderable(renderer, {
      id: 'tm-stats-text',
      content: 'Career season averages will be listed here.',
      wrapMode: 'none',
    });

    this.statsScroll.add(this.statsText);
    this.statsPanel.add(this.statsScroll);

    // Combine
    this.container.add(this.leftColumn);
    this.container.add(this.statsPanel);

    this.focusablePanels = [this.searchPanel, this.statsPanel];

    // Wire events
    (this.searchInput as any).on('input', () => {
      this.searchQuery = this.searchInput.value;
      this.searchPlayers();
    });

    (this.searchInput as any).on('enter', () => {
      this.selectHighlightedSuggestion();
    });
  }

  /**
   * Initializes the tab.
   */
  async init() {
    // Optionally load a default popular player like LeBron James on startup
    try {
      const defaultSearch = await query(`
        SELECT player_id, full_name, from_year, to_year, is_active
        FROM dim_player
        WHERE full_name = 'LeBron James'
        LIMIT 1
      `);
      if (defaultSearch.length > 0) {
        await this.loadPlayerDetails(defaultSearch[0]);
      }
    } catch (e) {
      // Quietly continue if default fail
    }
  }

  /**
   * Focuses the primary input widget.
   */
  focus() {
    if (this.focusIndex === 0) {
      this.searchInput.focus();
    } else {
      this.searchInput.blur();
      this.statsScroll.focus();
    }
    this.container.requestRender();
  }

  /**
   * Cycles focus between search input and stats grid.
   */
  cycleFocus() {
    this.focusIndex = (this.focusIndex + 1) % this.focusablePanels.length;
    this.focus();
  }

  /**
   * Cycles focus backward between stats grid and search input.
   */
  cycleFocusBackward(): void {
    this.focusIndex =
      (this.focusIndex - 1 + this.focusablePanels.length) % this.focusablePanels.length;
    this.focus();
  }

  /**
   * Context line for the app shell footer (query, player, keys).
   */
  getStatusLine(): string {
    const parts: string[] = [];

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
      parts.push('↑↓ pick · Enter select · Tab→stats');
    } else {
      parts.push('Career stats');
      if (this.activePlayer?.full_name) {
        parts.push(this.activePlayer.full_name);
      }
      parts.push('↑↓ scroll · Tab→search');
    }

    if (this.activePlayer?.full_name && this.focusIndex === 0) {
      const loaded = this.activePlayer.full_name;
      if (!parts.includes(loaded)) {
        parts.splice(1, 0, `loaded: ${loaded}`);
      }
    }

    return parts.join(' · ');
  }

  isInputFocused(): boolean {
    return this.searchInput.focused;
  }

  blurInput() {
    this.searchInput.blur();
    this.focusIndex = 1; // Move focus to Stats panel for review
    this.focus();
  }

  /**
   * Handles tab-specific keys.
   */
  handleKeyPress(event: KeyEvent): boolean {
    if (this.focusIndex === 0) {
      // Search Panel
      if (event.name === 'up') {
        if (this.selectedSuggestIdx > 0) {
          this.selectedSuggestIdx--;
          this.renderSuggestions();
        }
        return true;
      }
      if (event.name === 'down') {
        if (this.selectedSuggestIdx < this.suggestions.length - 1) {
          this.selectedSuggestIdx++;
          this.renderSuggestions();
        }
        return true;
      }
      if (event.name === 'return' || event.name === 'enter') {
        this.selectHighlightedSuggestion();
        return true;
      }
    } else if (this.focusIndex === 1) {
      // Stats Panel Scroll
      return this.statsScroll.handleKeyPress(event);
    }
    return false;
  }

  /**
   * Performs database search on players list.
   */
  private async searchPlayers() {
    const q = this.searchQuery.trim();
    if (q.length < 2) {
      this.suggestions = [];
      this.selectedSuggestIdx = 0;
      this.suggestionsText.content = ansiToStyledText('\nType 2+ characters to search');
      this.container.requestRender();
      return;
    }

    try {
      this.suggestions = await query(`
        SELECT player_id, full_name, from_year, to_year, is_active
        FROM dim_player
        WHERE lower(full_name) LIKE lower($1)
        ORDER BY to_year DESC, full_name ASC
        LIMIT 8
      `, [`%${q}%`]);

      this.selectedSuggestIdx = 0;
      this.renderSuggestions();
    } catch (e: any) {
      this.suggestionsText.content = ansiToStyledText(`\nError: ${e.message}`);
      this.container.requestRender();
    }
  }

  /**
   * Renders the auto-complete search suggestion list.
   */
  private renderSuggestions() {
    if (this.suggestions.length === 0) {
      this.suggestionsText.content = ansiToStyledText('\nNo matching players found.');
      this.container.requestRender();
      return;
    }

    const lines = this.suggestions.map((p, idx) => {
      const isSelected = idx === this.selectedSuggestIdx;
      const prefix = isSelected ? ' \x1b[1;35m▶\x1b[0m ' : '   ';
      const status = p.is_active ? '\x1b[32mActive\x1b[0m' : 'Retired';
      const seasons = `(${p.from_year}-${p.to_year})`;
      const name = isSelected ? `\x1b[1m${p.full_name}\x1b[0m` : p.full_name;
      return `${prefix}${name} ${seasons} - ${status}`;
    });

    this.suggestionsText.content = ansiToStyledText('\n' + lines.join('\n'));
    this.container.requestRender();
  }

  /**
   * Selects the currently highlighted auto-suggest player.
   */
  private async selectHighlightedSuggestion() {
    const selected = this.suggestions[this.selectedSuggestIdx];
    if (selected) {
      // Clear input and suggestions list, blur input
      this.searchInput.value = '';
      this.searchQuery = '';
      this.suggestions = [];
      this.suggestionsText.content = ansiToStyledText('\nSearch completed. Type to search again.');
      this.searchInput.blur();
      
      // Shift focus to Stats panel for review
      this.focusIndex = 1;
      this.focus();

      await this.loadPlayerDetails(selected);
    }
  }

  /**
   * Loads player metadata and their season averages.
   */
  private async loadPlayerDetails(player: any) {
    this.activePlayer = player;
    this.dossierText.content = ansiToStyledText('Loading dossier...');
    this.statsText.content = ansiToStyledText('Loading career stats...');
    this.container.requestRender();

    try {
      // 1. Fetch detailed player metadata
      const details = await query(`
        SELECT * FROM dim_player WHERE player_id = $1 LIMIT 1
      `, [player.player_id]);

      const meta = details[0] || player;

      // 2. Fetch Awards (if any)
      const awards = await loadPlayerAwards(player.player_id);

      // 3. Fetch Season Averages
      this.careerStats = await loadCareerStats(player.player_id);

      // Render Dossier Card
      this.renderDossier(meta, awards);

      // Render Stats
      this.renderStats();

    } catch (e: any) {
      this.dossierText.content = ansiToStyledText(`Error loading details:\n${e.message}`);
      this.statsText.content = ansiToStyledText('');
      this.container.requestRender();
    }
  }

  /**
   * Displays player profile.
   */
  private renderDossier(meta: any, awards: any[]) {
    const feet = Math.floor(meta.height_inches / 12);
    const inches = meta.height_inches % 12;
    const heightStr = meta.height_inches ? `${feet}'${inches}"` : 'Unknown';
    const weightStr = meta.body_weight_lbs ? `${meta.body_weight_lbs} lbs` : 'Unknown';
    
    let draftStr = 'Undrafted';
    if (meta.draft_year) {
      draftStr = `${meta.draft_year} - Rd ${meta.draft_round}, Pick ${meta.draft_number}`;
    }

    let dossier = `\x1b[1;35m${meta.full_name}\x1b[0m\n`;
    dossier += `═`.repeat(meta.full_name.length) + `\n`;
    dossier += `• \x1b[1mCareer Span:\x1b[0m ${meta.from_year} - ${meta.to_year} (${meta.is_active ? '\x1b[32mActive\x1b[0m' : 'Retired'})\n`;
    dossier += `• \x1b[1mPhysicals:\x1b[0m   ${heightStr} | ${weightStr}\n`;
    dossier += `• \x1b[1mBirth Date:\x1b[0m  ${meta.birth_date || 'Unknown'}\n`;
    dossier += `• \x1b[1mBackground:\x1b[0m  ${meta.country || 'USA'} | ${meta.school || 'High School'}\n`;
    dossier += `• \x1b[1mDraft Card:\x1b[0m  ${draftStr}\n`;

    if (awards.length > 0) {
      dossier += `\n\x1b[1;33mKey Career Accolades:\x1b[0m\n`;
      awards.forEach((aw) => {
        const countSuffix = aw.count > 1 ? ` (x${aw.count})` : '';
        dossier += ` * [award] [${aw.season_year}] ${aw.award}${countSuffix}\n`;
      });
    }

    this.dossierText.content = ansiToStyledText(dossier);
    this.container.requestRender();
  }

  /**
   * Renders the Career Stats Table.
   */
  private renderStats() {
    if (this.careerStats.length === 0) {
      this.statsText.content = ansiToStyledText('No career statistics recorded for this player.');
      this.container.requestRender();
      return;
    }

    const headers = ['Season', 'Type', 'GP', 'GS', 'MIN', 'PTS', 'AST', 'REB', 'STL', 'BLK', 'TS%', 'PER', 'BPM', 'VORP'];
    const keys = ['season_year', 'playoff_str', 'gp', 'gs', 'min', 'pts', 'ast', 'reb', 'stl', 'blk', 'ts_pct_str', 'per', 'bpm', 'vorp'];

    const formattedRows = this.careerStats.map((stat) => {
      return {
        ...stat,
        playoff_str: stat.is_playoffs ? 'Playoffs' : 'Reg Season',
        ts_pct_str: stat.ts_pct ? (stat.ts_pct * 100).toFixed(1) + '%' : '.000',
        per: stat.per ? stat.per.toFixed(1) : '---',
        bpm: stat.bpm ? stat.bpm.toFixed(1) : '---',
        vorp: stat.vorp ? stat.vorp.toFixed(1) : '---',
      };
    });

    const lines = formatTable(headers, formattedRows, { colKeys: keys });
    this.statsText.content = ansiToStyledText(lines.join('\n'));
    this.container.requestRender();
  }
}
