import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  type KeyEvent,
  ScrollBoxRenderable,
  TextRenderable,
} from '@opentui/core';
import { query } from '../db.js';
import { getErrorMessage } from '../errors.js';
import {
  type CareerStatRow,
  findTeam,
  loadCareerStats,
  loadPlayerAwards,
  loadTeamRoster,
  loadTeamSeasonStats,
  type PlayerAwardRow,
  type TeamRosterRow,
} from '../queries/timeMachine.js';
import type { DbRow } from '../types.js';
import { parseTeamQuery } from '../utils/teamQuery.js';

interface PlayerSuggestion {
  player_id: string;
  full_name: string;
  from_year: number | string;
  to_year: number | string;
  is_active: boolean;
}

interface TeamComparisonData {
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

import { ansiToStyledText, formatTable } from '../utils/formatters.js';
import { Theme } from '../utils/theme.js';

export class TimeMachineTab {
  readonly id = 'time-machine';
  readonly name = 'Career Time-Machine';
  readonly container: BoxRenderable;

  // UI Panels
  private readonly leftColumn: BoxRenderable;
  private readonly searchPanel: BoxRenderable;
  private readonly dossierPanel: BoxRenderable;
  private readonly teamSearchPanel: BoxRenderable;
  private readonly statsPanel: BoxRenderable;

  // UI Widgets
  private readonly searchInput: InputRenderable;
  private readonly suggestionsText: TextRenderable;
  private readonly dossierText: TextRenderable;
  private readonly teamAInput: InputRenderable;
  private readonly teamBInput: InputRenderable;
  private readonly statsScroll: ScrollBoxRenderable;
  private readonly statsText: TextRenderable;

  // State
  private mode: 'player' | 'team' = 'player';
  private searchQuery = '';
  private suggestions: PlayerSuggestion[] = [];
  private selectedSuggestIdx = 0;

  private activePlayer: PlayerSuggestion | null = null;
  private careerStats: CareerStatRow[] = [];

  // Team comparison state
  private teamAQuery = 'LAL 2025';
  private teamBQuery = 'PHI 2025';
  private teamAData: TeamComparisonData | null = null;
  private teamBData: TeamComparisonData | null = null;
  private teamARoster: TeamRosterRow[] = [];
  private teamBRoster: TeamRosterRow[] = [];

  // Focus Management
  // 0 = Search Input, 1 = Career Stats Scroll
  private focusIndex = 0;
  private teamFocusIndex = 0; // 0 = Team A Input, 1 = Team B Input, 2 = Stats Scroll
  private focusablePanels: BoxRenderable[] = [];

  constructor(renderer: CliRenderer) {
    // Parent container
    this.container = new BoxRenderable(renderer, {
      id: 'time-machine-container',
      width: '100%',
      height: '100%',
      flexDirection: 'row',
      backgroundColor: Theme.background,
    });

    // Left Column: Search & Dossier / Team Search
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
      title: 'Player Search (Press C to switch to Team Compare)',
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

    // Team Search Panel (hidden by default)
    this.teamSearchPanel = new BoxRenderable(renderer, {
      id: 'tm-team-search-panel',
      width: '100%',
      height: '100%',
      border: true,
      borderStyle: Theme.borderStyle,
      borderColor: Theme.borderNormal,
      focusedBorderColor: Theme.borderFocused,
      title: 'Team Comparison (Press C to switch to Player Mode)',
      titleAlignment: Theme.titleAlignment,
      flexDirection: 'column',
      visible: false,
    });

    const teamAHeader = new TextRenderable(renderer, {
      id: 'tm-team-a-header',
      content: '\n\x1b[1;33mTeam A (e.g. Bulls 1996):\x1b[0m',
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

    const teamInstructions = new TextRenderable(renderer, {
      id: 'tm-team-instructions',
      content:
        '\n\x1b[90mInstructions:\x1b[0m\nType Team name/abbreviation with a 4-digit year. Press [Enter] to fetch stats. Use [Tab] to move, [C] to toggle.',
    });

    this.teamSearchPanel.add(teamAHeader);
    this.teamSearchPanel.add(this.teamAInput);
    this.teamSearchPanel.add(teamBHeader);
    this.teamSearchPanel.add(this.teamBInput);
    this.teamSearchPanel.add(teamInstructions);

    this.leftColumn.add(this.searchPanel);
    this.leftColumn.add(this.dossierPanel);
    this.leftColumn.add(this.teamSearchPanel);

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
    this.searchInput.on('input', () => {
      this.searchQuery = this.searchInput.value;
      this.searchPlayers();
    });

    this.searchInput.on('enter', () => {
      this.selectHighlightedSuggestion();
    });

    this.teamAInput.on('input', () => {
      this.teamAQuery = this.teamAInput.value;
    });

    this.teamAInput.on('enter', () => {
      this.loadTeamData('A');
    });

    this.teamBInput.on('input', () => {
      this.teamBQuery = this.teamBInput.value;
    });

    this.teamBInput.on('enter', () => {
      this.loadTeamData('B');
    });
  }

  /**
   * Initializes the tab.
   */
  async init() {
    // Optionally load a default popular player like LeBron James on startup
    try {
      const defaultSearch = await query<PlayerSuggestion>(`
        SELECT player_id, full_name, from_year, to_year, is_active
        FROM dim_player
        WHERE full_name = 'LeBron James'
        LIMIT 1
      `);
      if (defaultSearch.length > 0) {
        await this.loadPlayerDetails(defaultSearch[0]);
      }
    } catch (_e) {
      // Quietly continue if default fail
    }
  }

  /**
   * Focuses the primary input widget.
   */
  focus() {
    this.searchInput.blur();
    this.teamAInput.blur();
    this.teamBInput.blur();
    this.statsScroll.blur();

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
      } else {
        this.statsScroll.focus();
      }
    } else {
      // Team mode focus
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
    this.container.requestRender();
  }

  /**
   * Cycles focus between active panels.
   */
  cycleFocus() {
    if (this.mode === 'player') {
      this.focusIndex = (this.focusIndex + 1) % this.focusablePanels.length;
    } else {
      this.teamFocusIndex = (this.teamFocusIndex + 1) % 3;
    }
    this.focus();
  }

  /**
   * Cycles focus backward.
   */
  cycleFocusBackward(): void {
    if (this.mode === 'player') {
      this.focusIndex =
        (this.focusIndex - 1 + this.focusablePanels.length) % this.focusablePanels.length;
    } else {
      this.teamFocusIndex = (this.teamFocusIndex - 1 + 3) % 3;
    }
    this.focus();
  }

  /**
   * Context line for the app shell footer (query, player, keys).
   */
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
        parts.push('↑↓ pick · Enter select · Tab→stats · C→Team Compare');
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
      // Team mode status line
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

  blurInput() {
    if (this.mode === 'player') {
      this.searchInput.blur();
      this.focusIndex = 1; // Move focus to Stats panel for review
      this.focus();
    } else {
      this.teamAInput.blur();
      this.teamBInput.blur();
      this.teamFocusIndex = 2; // Move focus to Right Panel
      this.focus();
    }
  }

  /**
   * Handles tab-specific keys.
   */
  handleKeyPress(event: KeyEvent): boolean {
    // Intercept 'c' key to toggle mode
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
    } else {
      // Team comparison mode key press
      if (this.teamFocusIndex === 0) {
        if (event.name === 'return' || event.name === 'enter') {
          this.loadTeamData('A');
          return true;
        }
      } else if (this.teamFocusIndex === 1) {
        if (event.name === 'return' || event.name === 'enter') {
          this.loadTeamData('B');
          return true;
        }
      } else if (this.teamFocusIndex === 2) {
        return this.statsScroll.handleKeyPress(event);
      }
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
      this.suggestions = await query<PlayerSuggestion>(
        `
        SELECT player_id, full_name, from_year, to_year, is_active
        FROM dim_player
        WHERE lower(full_name) LIKE lower($1)
        ORDER BY to_year DESC, full_name ASC
        LIMIT 8
      `,
        [`%${q}%`],
      );

      this.selectedSuggestIdx = 0;
      this.renderSuggestions();
    } catch (e: unknown) {
      this.suggestionsText.content = ansiToStyledText(`\nError: ${getErrorMessage(e)}`);
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

    this.suggestionsText.content = ansiToStyledText(`\n${lines.join('\n')}`);
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
  private async loadPlayerDetails(player: PlayerSuggestion) {
    this.activePlayer = player;
    this.dossierText.content = ansiToStyledText('Loading dossier...');
    this.statsText.content = ansiToStyledText('Loading career stats...');
    this.container.requestRender();

    try {
      // 1. Fetch detailed player metadata
      const details = await query<DbRow>(
        `
        SELECT * FROM dim_player WHERE player_id = $1 LIMIT 1
      `,
        [player.player_id],
      );

      const meta: DbRow = details[0] ?? { ...player };

      // 2. Fetch Awards (if any)
      const awards = await loadPlayerAwards(player.player_id);

      // 3. Fetch Season Averages
      this.careerStats = await loadCareerStats(player.player_id);

      // Render Dossier Card
      this.renderDossier(meta, awards);

      // Render Stats
      this.renderStats();
    } catch (e: unknown) {
      this.dossierText.content = ansiToStyledText(`Error loading details:\n${getErrorMessage(e)}`);
      this.statsText.content = ansiToStyledText('');
      this.container.requestRender();
    }
  }

  /**
   * Displays player profile.
   */
  private renderDossier(meta: DbRow, awards: PlayerAwardRow[]) {
    const fullName = String(meta.full_name ?? 'Unknown');
    const heightInches = Number(meta.height_inches ?? 0);
    const feet = Math.floor(heightInches / 12);
    const inches = heightInches % 12;
    const heightStr = heightInches ? `${feet}'${inches}"` : 'Unknown';
    const weightStr = meta.body_weight_lbs ? `${meta.body_weight_lbs} lbs` : 'Unknown';

    let draftStr = 'Undrafted';
    if (meta.draft_year) {
      draftStr = `${meta.draft_year} - Rd ${meta.draft_round}, Pick ${meta.draft_number}`;
    }

    let dossier = `\x1b[1;35m${fullName}\x1b[0m\n`;
    dossier += `${`═`.repeat(fullName.length)}\n`;
    dossier += `• \x1b[1mCareer Span:\x1b[0m ${meta.from_year} - ${meta.to_year} (${meta.is_active ? '\x1b[32mActive\x1b[0m' : 'Retired'})\n`;
    dossier += `• \x1b[1mPhysicals:\x1b[0m   ${heightStr} | ${weightStr}\n`;
    dossier += `• \x1b[1mBirth Date:\x1b[0m  ${meta.birth_date || 'Unknown'}\n`;
    dossier += `• \x1b[1mBackground:\x1b[0m  ${meta.country || 'USA'} | ${meta.school || 'High School'}\n`;
    dossier += `• \x1b[1mDraft Card:\x1b[0m  ${draftStr}\n`;

    if (awards.length > 0) {
      dossier += `\n\x1b[1;33mKey Career Accolades:\x1b[0m\n`;
      awards.forEach((aw) => {
        const countSuffix = Number(aw.count) > 1 ? ` (x${aw.count})` : '';
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

    const headers = [
      'Season',
      'Type',
      'GP',
      'GS',
      'MIN',
      'PTS',
      'AST',
      'REB',
      'STL',
      'BLK',
      'TS%',
      'PER',
      'BPM',
      'VORP',
    ];
    const keys = [
      'season_year',
      'playoff_str',
      'gp',
      'gs',
      'min',
      'pts',
      'ast',
      'reb',
      'stl',
      'blk',
      'ts_pct_str',
      'per',
      'bpm',
      'vorp',
    ];

    const formattedRows = this.careerStats.map((stat) => {
      return {
        ...stat,
        playoff_str: stat.is_playoffs ? 'Playoffs' : 'Reg Season',
        ts_pct_str: stat.ts_pct ? `${(stat.ts_pct * 100).toFixed(1)}%` : '.000',
        per: stat.per ? stat.per.toFixed(1) : '---',
        bpm: stat.bpm ? stat.bpm.toFixed(1) : '---',
        vorp: stat.vorp ? stat.vorp.toFixed(1) : '---',
      };
    });

    const lines = formatTable(headers, formattedRows, { colKeys: keys });

    // Calculate Regular Season Totals and Averages
    const regSeasonStats = this.careerStats.filter((s) => !s.is_playoffs);
    let summary = '';
    if (regSeasonStats.length > 0) {
      let totalGp = 0;
      let totalGs = 0;
      let totalMin = 0;
      let totalPts = 0;
      let totalAst = 0;
      let totalReb = 0;
      let totalStl = 0;
      let totalBlk = 0;
      let hasStl = false;
      let hasBlk = false;
      let hasGs = false;

      let tsSum = 0;
      let tsCount = 0;

      for (const stat of regSeasonStats) {
        const gp = Number(stat.gp || 0);
        totalGp += gp;

        if (stat.gs !== null && stat.gs !== undefined) {
          totalGs += Number(stat.gs);
          hasGs = true;
        }
        totalMin += Number(stat.min || 0);
        totalPts += Number(stat.pts || 0);
        totalAst += Number(stat.ast || 0);
        if (stat.reb !== null && stat.reb !== undefined) {
          totalReb += Number(stat.reb);
        }
        if (stat.stl !== null && stat.stl !== undefined) {
          totalStl += Number(stat.stl);
          hasStl = true;
        }
        if (stat.blk !== null && stat.blk !== undefined) {
          totalBlk += Number(stat.blk);
          hasBlk = true;
        }
        if (stat.ts_pct !== null && stat.ts_pct !== undefined) {
          tsSum += Number(stat.ts_pct);
          tsCount++;
        }
      }

      const avgMin = totalGp > 0 ? (totalMin / totalGp).toFixed(1) : '---';
      const avgPts = totalGp > 0 ? (totalPts / totalGp).toFixed(1) : '---';
      const avgAst = totalGp > 0 ? (totalAst / totalGp).toFixed(1) : '---';
      const avgReb = totalGp > 0 ? (totalReb / totalGp).toFixed(1) : '---';
      const avgStl = totalGp > 0 && hasStl ? (totalStl / totalGp).toFixed(1) : '---';
      const avgBlk = totalGp > 0 && hasBlk ? (totalBlk / totalGp).toFixed(1) : '---';
      const avgTs = tsCount > 0 ? `${((tsSum / tsCount) * 100).toFixed(1)}%` : '---';

      summary += '\n\x1b[1;33mRegular Season Career Totals & Averages:\x1b[0m\n';
      summary += `• \x1b[1mTotals:\x1b[0m   GP: ${totalGp} | GS: ${hasGs ? totalGs : '---'} | MIN: ${totalMin} | PTS: ${totalPts} | AST: ${totalAst} | REB: ${totalReb} | STL: ${hasStl ? totalStl : '---'} | BLK: ${hasBlk ? totalBlk : '---'}\n`;
      summary += `• \x1b[1mAverages:\x1b[0m MPG: ${avgMin} | PPG: ${avgPts} | APG: ${avgAst} | RPG: ${avgReb} | SPG: ${avgStl} | BPG: ${avgBlk} | TS%: ${avgTs}\n`;
    }

    // Playoffs Career Totals & Averages
    const playoffStats = this.careerStats.filter((s) => s.is_playoffs);
    if (playoffStats.length > 0) {
      let pTotalGp = 0;
      let pTotalGs = 0;
      let pTotalMin = 0;
      let pTotalPts = 0;
      let pTotalAst = 0;
      let pTotalReb = 0;
      let pTotalStl = 0;
      let pTotalBlk = 0;
      let pHasStl = false;
      let pHasBlk = false;
      let pHasGs = false;

      let pTsSum = 0;
      let pTsCount = 0;

      for (const stat of playoffStats) {
        const gp = Number(stat.gp || 0);
        pTotalGp += gp;

        if (stat.gs !== null && stat.gs !== undefined) {
          pTotalGs += Number(stat.gs);
          pHasGs = true;
        }
        pTotalMin += Number(stat.min || 0);
        pTotalPts += Number(stat.pts || 0);
        pTotalAst += Number(stat.ast || 0);
        if (stat.reb !== null && stat.reb !== undefined) {
          pTotalReb += Number(stat.reb);
        }
        if (stat.stl !== null && stat.stl !== undefined) {
          pTotalStl += Number(stat.stl);
          pHasStl = true;
        }
        if (stat.blk !== null && stat.blk !== undefined) {
          pTotalBlk += Number(stat.blk);
          pHasBlk = true;
        }
        if (stat.ts_pct !== null && stat.ts_pct !== undefined) {
          pTsSum += Number(stat.ts_pct);
          pTsCount++;
        }
      }

      const pAvgMin = pTotalGp > 0 ? (pTotalMin / pTotalGp).toFixed(1) : '---';
      const pAvgPts = pTotalGp > 0 ? (pTotalPts / pTotalGp).toFixed(1) : '---';
      const pAvgAst = pTotalGp > 0 ? (pTotalAst / pTotalGp).toFixed(1) : '---';
      const pAvgReb = pTotalGp > 0 ? (pTotalReb / pTotalGp).toFixed(1) : '---';
      const pAvgStl = pTotalGp > 0 && pHasStl ? (pTotalStl / pTotalGp).toFixed(1) : '---';
      const pAvgBlk = pTotalGp > 0 && pHasBlk ? (pTotalBlk / pTotalGp).toFixed(1) : '---';
      const pAvgTs = pTsCount > 0 ? `${((pTsSum / pTsCount) * 100).toFixed(1)}%` : '---';

      summary += `\n\x1b[1;35mPlayoffs Career Totals & Averages:\x1b[0m\n`;
      summary += `• \x1b[1mTotals:\x1b[0m   GP: ${pTotalGp} | GS: ${pHasGs ? pTotalGs : '---'} | MIN: ${pTotalMin} | PTS: ${pTotalPts} | AST: ${pTotalAst} | REB: ${pTotalReb} | STL: ${pHasStl ? pTotalStl : '---'} | BLK: ${pHasBlk ? pTotalBlk : '---'}\n`;
      summary += `• \x1b[1mAverages:\x1b[0m MPG: ${pAvgMin} | PPG: ${pAvgPts} | APG: ${pAvgAst} | RPG: ${pAvgReb} | SPG: ${pAvgStl} | BPG: ${pAvgBlk} | TS%: ${pAvgTs}\n`;
    }

    this.statsText.content = ansiToStyledText(`${lines.join('\n')}\n${summary}`);
    this.container.requestRender();
  }

  private toggleMode() {
    this.mode = this.mode === 'player' ? 'team' : 'player';

    if (this.mode === 'player') {
      this.searchPanel.visible = true;
      this.dossierPanel.visible = true;
      this.teamSearchPanel.visible = false;
      this.focusIndex = 0;
      this.renderStats();
    } else {
      this.searchPanel.visible = false;
      this.dossierPanel.visible = false;
      this.teamSearchPanel.visible = true;
      this.teamFocusIndex = 0;

      // Load default teams if not loaded
      if (!this.teamAData && this.teamAQuery) {
        this.loadTeamData('A');
      }
      if (!this.teamBData && this.teamBQuery) {
        this.loadTeamData('B');
      }
      this.renderTeamComparison();
    }
    this.focus();
  }

  private async loadTeamData(type: 'A' | 'B') {
    const inputStr = type === 'A' ? this.teamAQuery : this.teamBQuery;
    const parsed = parseTeamQuery(inputStr);
    if (!parsed) {
      if (type === 'A') {
        this.teamAData = null;
        this.teamARoster = [];
      } else {
        this.teamBData = null;
        this.teamBRoster = [];
      }
      this.renderTeamComparison();
      return;
    }

    try {
      const team = await findTeam(parsed.teamQuery);
      if (!team) {
        throw new Error(`Team "${parsed.teamQuery}" not found.`);
      }

      const stats = await loadTeamSeasonStats(team.team_id, parsed.year);
      const roster = await loadTeamRoster(team.team_id, parsed.year);

      const teamInfo: TeamComparisonData = {
        team_id: team.team_id,
        team_abbrev: team.team_abbrev,
        team_name: team.team_name,
        year: parsed.year,
        gp: stats?.gp ?? 0,
        ppg: stats?.ppg ?? 0,
        apg: stats?.apg ?? 0,
        rpg: stats?.rpg ?? 0,
        spg: stats?.spg ?? 0,
        bpg: stats?.bpg ?? 0,
      };

      if (type === 'A') {
        this.teamAData = teamInfo;
        this.teamARoster = roster;
      } else {
        this.teamBData = teamInfo;
        this.teamBRoster = roster;
      }

      this.renderTeamComparison();
    } catch (e: unknown) {
      const errorInfo: TeamComparisonData = {
        team_name: 'Error',
        team_abbrev: 'ERR',
        year: parsed.year,
        gp: 0,
        ppg: 0,
        apg: 0,
        rpg: 0,
        spg: 0,
        bpg: 0,
        errorMessage: getErrorMessage(e),
      };
      if (type === 'A') {
        this.teamAData = errorInfo;
        this.teamARoster = [];
      } else {
        this.teamBData = errorInfo;
        this.teamBRoster = [];
      }
      this.renderTeamComparison();
    }
  }

  private renderTeamComparison() {
    if (this.mode !== 'team') return;

    let content = '============================================================\n';
    content += '              HISTORICAL TEAM COMPARISON\n';
    content += '============================================================\n';

    const formatTeamHeader = (data: TeamComparisonData | null) => {
      if (!data) return 'No Team Loaded';
      if (data.errorMessage) return `Error: ${data.errorMessage}`;
      return `${data.team_abbrev} ${data.year} (${data.team_name})`;
    };

    const headerA = formatTeamHeader(this.teamAData);
    const headerB = formatTeamHeader(this.teamBData);

    const pad = (str: string, len: number) => {
      const s = String(str);
      return s + ' '.repeat(Math.max(0, len - s.length));
    };

    content += `${pad('Metric', 18)}│ ${pad(headerA, 28)}│ ${pad(headerB, 28)}\n`;
    content += `${'─'.repeat(18)}┼${'─'.repeat(29)}┼${'─'.repeat(29)}\n`;

    const getVal = (
      data: TeamComparisonData | null,
      key: keyof TeamComparisonData,
      isFloat = true,
    ) => {
      if (!data || data.errorMessage) return '---';
      const val = data[key];
      if (val === undefined || val === null) return '---';
      return isFloat ? Number(val).toFixed(1) : String(val);
    };

    content += `${pad('Games Played', 18)}│ ${pad(getVal(this.teamAData, 'gp', false), 28)}│ ${pad(getVal(this.teamBData, 'gp', false), 28)}\n`;
    content += `${pad('Points / Game', 18)}│ ${pad(getVal(this.teamAData, 'ppg'), 28)}│ ${pad(getVal(this.teamBData, 'ppg'), 28)}\n`;
    content += `${pad('Assists / Game', 18)}│ ${pad(getVal(this.teamAData, 'apg'), 28)}│ ${pad(getVal(this.teamBData, 'apg'), 28)}\n`;
    content += `${pad('Rebounds / Game', 18)}│ ${pad(getVal(this.teamAData, 'rpg'), 28)}│ ${pad(getVal(this.teamBData, 'rpg'), 28)}\n`;
    content += `${pad('Steals / Game', 18)}│ ${pad(getVal(this.teamAData, 'spg'), 28)}│ ${pad(getVal(this.teamBData, 'spg'), 28)}\n`;
    content += `${pad('Blocks / Game', 18)}│ ${pad(getVal(this.teamAData, 'bpg'), 28)}│ ${pad(getVal(this.teamBData, 'bpg'), 28)}\n`;

    content += '\n============================================================\n';
    content += '              ROSTER SIDE-BY-SIDE (PPG / APG / RPG)\n';
    content += '============================================================\n';

    const nameA =
      this.teamAData && !this.teamAData.errorMessage
        ? `${this.teamAData.team_abbrev} ${this.teamAData.year}`
        : 'Team A';
    const nameB =
      this.teamBData && !this.teamBData.errorMessage
        ? `${this.teamBData.team_abbrev} ${this.teamBData.year}`
        : 'Team B';

    content += `${pad(`${nameA} Roster`, 30)}│ ${pad(`${nameB} Roster`, 30)}\n`;
    content += `${'─'.repeat(30)}┼${'─'.repeat(31)}\n`;

    const maxRosterLen = Math.max(this.teamARoster.length, this.teamBRoster.length);
    if (maxRosterLen === 0) {
      content += ' No roster data available.    │  No roster data available.\n';
    } else {
      const truncate = (str: string, len: number) => {
        if (str.length <= len) return str;
        return `${str.slice(0, len - 3)}...`;
      };

      for (let i = 0; i < maxRosterLen; i++) {
        const pA = this.teamARoster[i];
        const pB = this.teamBRoster[i];

        const nameA_trunc = pA ? truncate(pA.full_name, 18) : '';
        const nameB_trunc = pB ? truncate(pB.full_name, 18) : '';
        const statsA = pA ? `(${Number(pA.ppg).toFixed(1)}/${Number(pA.apg).toFixed(1)})` : '';
        const statsB = pB ? `(${Number(pB.ppg).toFixed(1)}/${Number(pB.apg).toFixed(1)})` : '';

        const strA = pA ? `${nameA_trunc} ${statsA}` : '';
        const strB = pB ? `${nameB_trunc} ${statsB}` : '';

        content += `${pad(strA, 30)}│ ${pad(strB, 31)}\n`;
      }
    }

    this.statsText.content = ansiToStyledText(content);
    this.container.requestRender();
  }
}
