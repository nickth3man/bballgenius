import {
  BoxRenderable,
  type CliRenderer,
  ScrollBoxRenderable,
  TextRenderable,
} from '@opentui/core';
import { getErrorMessage } from '../../core/errors.js';
import type { AppKeyEvent } from '../../core/input.js';
import { ansiToStyledText, drawHalfCourt, formatTable } from '../../shared/utils/formatters.js';
import { Theme } from '../../shared/utils/theme.js';
import {
  type BoxScoreRow,
  type GameShotRow,
  loadBoxScoreWithTeamDedup,
  loadGameShots,
  loadRecentGames,
  type RecentGameRow,
} from './queries.js';

export class GameCenterTab {
  readonly id = 'game-center';
  readonly name = 'Game Center';
  readonly container: BoxRenderable;

  // UI Components
  private readonly leftPanel: BoxRenderable;
  private readonly middlePanel: BoxRenderable;
  private readonly rightPanel: BoxRenderable;

  private readonly gameListScroll: ScrollBoxRenderable;
  private readonly gameListText: TextRenderable;

  private readonly boxScoreScroll: ScrollBoxRenderable;
  private readonly boxScoreText: TextRenderable;

  private readonly shotChartText: TextRenderable;

  // State
  private games: RecentGameRow[] = [];
  private selectedGameIdx = 0;

  private boxScores: BoxScoreRow[] = [];
  private selectedPlayerIdx = -1; // -1 means "All Players"

  private shots: GameShotRow[] = [];

  // Focus Management: 0 = games, 1 = box score, 2 = shot chart
  private focusIndex = 0;
  private focusablePanels: BoxRenderable[] = [];

  constructor(renderer: CliRenderer) {
    // Parent container spanning 100% of workspace width/height
    this.container = new BoxRenderable(renderer, {
      id: 'game-center-container',
      width: '100%',
      height: '100%',
      flexDirection: 'row',
      gap: Theme.gap,
      backgroundColor: Theme.background,
    });

    // Left Panel: Game Directory
    this.leftPanel = new BoxRenderable(renderer, {
      id: 'game-directory-panel',
      width: '22%',
      height: '100%',
      border: true,
      borderStyle: Theme.borderStyle,
      borderColor: Theme.borderNormal,
      focusable: true,
      focusedBorderColor: Theme.borderFocused,
      title: 'Games',
      titleAlignment: Theme.titleAlignment,
      paddingX: 1,
    });

    this.gameListScroll = new ScrollBoxRenderable(renderer, {
      id: 'game-list-scroll',
      width: '100%',
      height: '100%',
      viewportCulling: true,
    });

    this.gameListText = new TextRenderable(renderer, {
      id: 'game-list-text',
      content: 'Loading games...',
      wrapMode: 'none',
    });

    this.gameListScroll.add(this.gameListText);
    this.leftPanel.add(this.gameListScroll);

    // Middle Panel: Box Score Details
    this.middlePanel = new BoxRenderable(renderer, {
      id: 'box-score-panel',
      width: '42%',
      height: '100%',
      border: true,
      borderStyle: Theme.borderStyle,
      borderColor: Theme.borderNormal,
      focusable: true,
      focusedBorderColor: Theme.borderFocused,
      title: 'Box Score',
      titleAlignment: Theme.titleAlignment,
      paddingX: 1,
    });

    this.boxScoreScroll = new ScrollBoxRenderable(renderer, {
      id: 'box-score-scroll',
      width: '100%',
      height: '100%',
      viewportCulling: true,
    });

    this.boxScoreText = new TextRenderable(renderer, {
      id: 'box-score-text',
      content: 'Select a game to view box scores.',
      wrapMode: 'none',
    });

    this.boxScoreScroll.add(this.boxScoreText);
    this.middlePanel.add(this.boxScoreScroll);

    // Right Panel: Shot Chart Visualisation
    this.rightPanel = new BoxRenderable(renderer, {
      id: 'shot-chart-panel',
      width: '36%',
      height: '100%',
      border: true,
      borderStyle: Theme.borderStyle,
      borderColor: Theme.borderNormal,
      focusable: true,
      focusedBorderColor: Theme.borderFocused,
      title: 'Shot Chart',
      titleAlignment: Theme.titleAlignment,
      paddingX: 1,
    });

    this.shotChartText = new TextRenderable(renderer, {
      id: 'shot-chart-text',
      content: 'Select a game with shots to draw court.',
      wrapMode: 'none',
    });

    this.rightPanel.add(this.shotChartText);

    // Assembly
    this.container.add(this.leftPanel);
    this.container.add(this.middlePanel);
    this.container.add(this.rightPanel);

    // Focus arrays
    this.focusablePanels = [this.leftPanel, this.middlePanel, this.rightPanel];
  }

  /**
   * Initializes the tab by loading recent games from the database.
   */
  async init() {
    try {
      this.games = await loadRecentGames();

      if (this.games.length > 0) {
        this.selectedGameIdx = 0;
        this.renderGameList();
        await this.loadGameDetails();
      } else {
        this.gameListText.content = ansiToStyledText('No games found in database.');
        this.container.requestRender();
      }
    } catch (e: unknown) {
      this.gameListText.content = ansiToStyledText(`Error loading games:\n${getErrorMessage(e)}`);
      this.container.requestRender();
    }
  }

  /**
   * Switches focus to the current sub-panel and wires scroll focus.
   */
  focus() {
    this.focusActivePanel();
  }

  /**
   * Cycles focus forward: games → box score → shot chart.
   */
  cycleFocus() {
    this.focusIndex = (this.focusIndex + 1) % this.focusablePanels.length;
    this.focus();
  }

  /**
   * Cycles focus backward (reverse of cycleFocus).
   */
  cycleFocusBackward() {
    this.focusIndex =
      (this.focusIndex - 1 + this.focusablePanels.length) % this.focusablePanels.length;
    this.focus();
  }

  /**
   * Footer status line for the app shell.
   */
  getStatusLine(): string {
    const gameCount = this.games.length;
    const gamePos = gameCount > 0 ? `${this.selectedGameIdx + 1}/${gameCount}` : '0/0';
    const panelLabels = ['Games', 'Box score', 'Shot chart'];
    const panel = panelLabels[this.focusIndex] ?? 'Games';

    let playerLabel = 'All Players';
    if (this.selectedPlayerIdx >= 0 && this.boxScores[this.selectedPlayerIdx]) {
      playerLabel = this.boxScores[this.selectedPlayerIdx].full_name;
    }

    const moveHint =
      this.focusIndex === 0
        ? '↑↓ move game'
        : this.focusIndex === 1
          ? '↑↓ move player'
          : 'read-only';

    return `Games ${gamePos} | ${panel} | Player: ${playerLabel} | ${moveHint}`;
  }

  private focusActivePanel() {
    this.focusablePanels.forEach((panel, idx) => {
      if (idx === this.focusIndex) {
        panel.focus();
      } else {
        panel.blur();
        panel.borderColor = Theme.borderNormal;
      }
    });

    if (this.focusIndex === 0) {
      this.gameListScroll.focus();
    } else if (this.focusIndex === 1) {
      this.boxScoreScroll.focus();
    }

    this.container.requestRender();
  }

  isInputFocused(): boolean {
    return false;
  }

  blurInput() {
    // Game Center doesn't have an input field to blur
  }

  /**
   * Handles keyboard navigation within the Game Center tab.
   * Returns true if the key was handled, false otherwise.
   */
  handleKeyPress(event: AppKeyEvent): boolean {
    if (this.focusIndex === 0) {
      // Game Directory focused
      if (event.name === 'up') {
        if (this.selectedGameIdx > 0) {
          this.selectedGameIdx--;
          this.selectedPlayerIdx = -1; // Reset player filter on game change
          this.renderGameList();
          this.scrollGameListIntoView();
          this.loadGameDetails();
        }
        return true;
      }
      if (event.name === 'down') {
        if (this.selectedGameIdx < this.games.length - 1) {
          this.selectedGameIdx++;
          this.selectedPlayerIdx = -1; // Reset player filter on game change
          this.renderGameList();
          this.scrollGameListIntoView();
          this.loadGameDetails();
        }
        return true;
      }
    } else if (this.focusIndex === 1) {
      // Box Score / Player List focused
      if (event.name === 'up') {
        if (this.selectedPlayerIdx > -1) {
          this.selectedPlayerIdx--;
          this.renderBoxScore();
          this.scrollBoxScoreIntoView();
          this.renderShotChart();
        }
        return true;
      }
      if (event.name === 'down') {
        if (this.selectedPlayerIdx < this.boxScores.length - 1) {
          this.selectedPlayerIdx++;
          this.renderBoxScore();
          this.scrollBoxScoreIntoView();
          this.renderShotChart();
        }
        return true;
      }
    } else if (this.focusIndex === 2) {
      // Shot chart panel: read-only, no navigation keys
      return false;
    }
    return false;
  }

  private scrollGameListIntoView() {
    const visibleHeight = this.gameListScroll.height || 20;
    const currentScroll = this.gameListScroll.scrollTop;
    const idx = this.selectedGameIdx;

    if (idx < currentScroll) {
      this.gameListScroll.scrollTop = idx;
    } else if (idx >= currentScroll + visibleHeight - 2) {
      this.gameListScroll.scrollTop = Math.max(0, idx - visibleHeight + 3);
    }
  }

  private scrollBoxScoreIntoView() {
    const visibleHeight = this.boxScoreScroll.height || 20;
    const currentScroll = this.boxScoreScroll.scrollTop;
    // Selected player is row index this.selectedPlayerIdx + 3 (+3 accounts for top border, header, separator)
    const lineIdx = this.selectedPlayerIdx + 3;

    if (lineIdx < currentScroll) {
      this.boxScoreScroll.scrollTop = Math.max(0, lineIdx - 2);
    } else if (lineIdx >= currentScroll + visibleHeight - 2) {
      this.boxScoreScroll.scrollTop = Math.max(0, lineIdx - visibleHeight + 3);
    }
  }

  /**
   * Loads rosters, stats, and shots for the selected game.
   */
  private async loadGameDetails() {
    const activeGame = this.games[this.selectedGameIdx];
    if (!activeGame) return;

    this.boxScoreText.content = ansiToStyledText('Loading box scores...');
    this.shotChartText.content = ansiToStyledText('Loading shots...');
    this.container.requestRender();

    try {
      // Fetch box scores with deduplicated team abbreviations
      this.boxScores = await loadBoxScoreWithTeamDedup(String(activeGame.game_id));

      // Fetch shots
      this.shots = await loadGameShots(String(activeGame.game_id));

      this.renderBoxScore();
      this.renderShotChart();
    } catch (e: unknown) {
      this.boxScoreText.content = ansiToStyledText(
        `Error loading game details:\n${getErrorMessage(e)}`,
      );
      this.shotChartText.content = ansiToStyledText('');
      this.container.requestRender();
    }
  }

  /**
   * Renders the game list text buffer with selection indicator.
   */
  private renderGameList() {
    const lines = this.games.map((game, idx) => {
      const dateStr = String(game.game_date).substring(5, 10); // MM-DD
      const prefix = idx === this.selectedGameIdx ? ' \x1b[1m▶\x1b[0m ' : '   ';
      const matchup = `\x1b[1m${game.away_team}\x1b[0m @ \x1b[1m${game.home_team}\x1b[0m`;
      const item = `${prefix}[${dateStr}] ${matchup}`;
      return item;
    });

    this.gameListText.content = ansiToStyledText(lines.join('\n'));
    this.container.requestRender();
  }

  /**
   * Renders the box score table in the middle panel.
   */
  private renderBoxScore() {
    if (this.boxScores.length === 0) {
      this.boxScoreText.content = 'No box score data available.';
      this.container.requestRender();
      return;
    }

    // Build the grid headers and rows
    const headers = ['Player', 'Team', 'MIN', 'PTS', 'AST', 'REB', 'STL', 'BLK'];
    const keys = [
      'full_name',
      'team_abbrev',
      'min',
      'points',
      'assists',
      'reb',
      'steals',
      'blocks',
    ];

    // Map rows and insert a selection indicator on player rows
    const mappedRows = this.boxScores.map((player, idx) => {
      const isSelected = idx === this.selectedPlayerIdx;
      return {
        ...player,
        full_name: isSelected ? `▶ ${player.full_name}` : `  ${player.full_name}`,
      };
    });

    // Prepend a row representing "All Players"
    const isAllSelected = this.selectedPlayerIdx === -1;
    const allRow = {
      full_name: isAllSelected ? '▶ All Players' : '  All Players',
      team_abbrev: '·',
      min: '·',
      points: '·',
      assists: '·',
      reb: '·',
      steals: '·',
      blocks: '·',
    };

    const tableLines = formatTable(headers, [allRow, ...mappedRows], { colKeys: keys });
    this.boxScoreText.content = ansiToStyledText(tableLines.join('\n'));
    this.container.requestRender();
  }

  /**
   * Renders the shot chart in the right panel.
   */
  private renderShotChart() {
    const activeGame = this.games[this.selectedGameIdx];
    if (!activeGame) return;

    let filteredShots = this.shots;
    let selectedPlayerName = 'All Players';

    if (this.selectedPlayerIdx >= 0) {
      const selectedPlayer = this.boxScores[this.selectedPlayerIdx];
      if (selectedPlayer) {
        filteredShots = this.shots.filter(
          (s) => String(s.player_id) === String(selectedPlayer.player_id),
        );
        selectedPlayerName = selectedPlayer.full_name;
      }
    }

    const makes = filteredShots.filter(
      (s) => s.shot_result.toLowerCase().includes('made') || s.shot_result === '1',
    ).length;
    const total = filteredShots.length;
    const pct = total > 0 ? ((makes / total) * 100).toFixed(1) : '0.0';

    const courtLines = drawHalfCourt(
      filteredShots,
      this.selectedPlayerIdx >= 0 ? this.boxScores[this.selectedPlayerIdx].player_id : undefined,
    );

    const zoneSummary = total > 0 ? this.summarizeShotZones(filteredShots) : 'Zones: (no shots)';

    // Title / stats overlay
    const titleOverlay = `\x1b[1;33m${selectedPlayerName}\x1b[0m\nShots: \x1b[32m${makes}\x1b[0m/\x1b[31m${total - makes}\x1b[0m (${pct}% FG)\n${zoneSummary}`;

    this.shotChartText.content = ansiToStyledText(`${titleOverlay}\n\n${courtLines.join('\n')}`);
    this.container.requestRender();
  }

  /**
   * Maps shot x/y to court grid cells (same heuristics as drawHalfCourt).
   */
  private shotGridCoords(shot: { x: number; y: number }): { gridR: number; gridC: number } {
    let xHalf = shot.x;
    if (xHalf > 50) {
      xHalf = 100 - xHalf;
    }
    const rows = 18;
    const cols = 40;
    return {
      gridR: Math.floor((xHalf / 50) * (rows - 1)),
      gridC: Math.floor((shot.y / 100) * (cols - 1)),
    };
  }

  private classifyShotZone(shot: { x: number; y: number }): 'paint' | 'corner3' | 'three' | 'mid' {
    const { gridR, gridC } = this.shotGridCoords(shot);

    if (gridR >= 1 && gridR <= 7 && gridC > 13 && gridC < 26) {
      return 'paint';
    }
    if (gridR >= 1 && gridR <= 5 && (gridC <= 2 || gridC >= 37)) {
      return 'corner3';
    }

    let xHalf = shot.x;
    if (xHalf > 50) {
      xHalf = 100 - xHalf;
    }
    const dy = (gridR - 2) * (47 / 17);
    const dx = (gridC - 20) * (50 / 39);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (gridR >= 5 && dist >= 22) {
      return 'three';
    }
    return 'mid';
  }

  private summarizeShotZones(shots: { x: number; y: number }[]): string {
    const counts = { paint: 0, corner3: 0, three: 0, mid: 0 };
    for (const shot of shots) {
      counts[this.classifyShotZone(shot)]++;
    }
    return `Zones: paint ${counts.paint} | corner 3 ${counts.corner3} | 3PT ${counts.three} | mid ${counts.mid}`;
  }
}
