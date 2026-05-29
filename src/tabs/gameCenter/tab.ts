import {
  BoxRenderable,
  type CliRenderer,
  type ScrollBoxRenderable,
  TextRenderable,
} from '@opentui/core';
import { getErrorMessage } from '../../core/errors.js';
import type { AppKeyEvent } from '../../core/input.js';
import {
  createPanel,
  createScrollPanel,
  FocusManager,
  focusScroll,
  resetBorderColors,
  scrollIntoView,
} from '../../shared/ui/index.js';
import { ansiToStyledText, drawHalfCourt, formatTable } from '../../shared/utils/formatters.js';
import { ansiBold, ansiGreen, ansiRed, ansiYellow, Theme } from '../../shared/utils/theme.js';
import {
  type BoxScoreRow,
  type GameShotRow,
  loadBoxScoreWithTeamDedup,
  loadGameShots,
  loadRecentGames,
  type RecentGameRow,
} from './queries.js';

const BOX_SCORE_HEADERS: string[] = ['Player', 'Team', 'MIN', 'PTS', 'AST', 'REB', 'STL', 'BLK'];
const BOX_SCORE_KEYS = [
  'full_name',
  'team_abbrev',
  'min',
  'points',
  'assists',
  'reb',
  'steals',
  'blocks',
];

function buildAllPlayersRow(isSelected: boolean) {
  return {
    full_name: isSelected ? '\u25b6 All Players' : '  All Players',
    team_abbrev: '\xb7',
    min: '\xb7',
    points: '\xb7',
    assists: '\xb7',
    reb: '\xb7',
    steals: '\xb7',
    blocks: '\xb7',
  };
}

function buildGameLine(game: RecentGameRow, idx: number, selectedIdx: number): string {
  const dateStr = String(game.game_date).substring(5, 10);
  const prefix = idx === selectedIdx ? ` ${ansiBold('\u25b6')} ` : '   ';
  const matchup = `${ansiBold(game.away_team)} @ ${ansiBold(game.home_team)}`;
  return `${prefix}[${dateStr}] ${matchup}`;
}

export class GameCenterTab {
  readonly id = 'game-center';
  readonly name = 'Game Center';
  readonly container: BoxRenderable;

  private readonly leftPanel: BoxRenderable;
  private readonly middlePanel: BoxRenderable;
  private readonly rightPanel: BoxRenderable;

  private readonly gameListScroll: ScrollBoxRenderable;
  private readonly gameListText: TextRenderable;

  private readonly boxScoreScroll: ScrollBoxRenderable;
  private readonly boxScoreText: TextRenderable;

  private readonly shotChartText: TextRenderable;

  private games: RecentGameRow[] = [];
  private selectedGameIdx = 0;

  private boxScores: BoxScoreRow[] = [];
  private selectedPlayerIdx = -1;

  private shots: GameShotRow[] = [];

  private readonly focusManager: FocusManager;

  constructor(renderer: CliRenderer) {
    this.container = new BoxRenderable(renderer, {
      id: 'game-center-container',
      width: '100%',
      height: '100%',
      flexDirection: 'row',
      gap: Theme.gap,
      backgroundColor: Theme.background,
    });

    const gamePanel = createScrollPanel(renderer, {
      id: 'game-directory-panel',
      title: 'Games',
      width: '22%',
    });
    this.leftPanel = gamePanel.panel;
    this.gameListScroll = gamePanel.scroll;
    this.gameListText = gamePanel.text;

    const boxPanel = createScrollPanel(renderer, {
      id: 'box-score-panel',
      title: 'Box Score',
      width: '42%',
    });
    this.middlePanel = boxPanel.panel;
    this.boxScoreScroll = boxPanel.scroll;
    this.boxScoreText = boxPanel.text;

    this.rightPanel = createPanel(renderer, {
      id: 'shot-chart-panel',
      title: 'Shot Chart',
      width: '36%',
    });

    this.shotChartText = new TextRenderable(renderer, {
      id: 'shot-chart-text',
      content: 'Select a game with shots to draw court.',
      wrapMode: 'none',
    });

    this.rightPanel.add(this.shotChartText);

    this.container.add(this.leftPanel);
    this.container.add(this.middlePanel);
    this.container.add(this.rightPanel);

    this.focusManager = new FocusManager([this.leftPanel, this.middlePanel, this.rightPanel]);
  }

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

  focus() {
    this.applyFocus();
  }

  cycleFocus() {
    this.focusManager.next();
    this.applyFocus();
  }

  cycleFocusBackward() {
    this.focusManager.prev();
    this.applyFocus();
  }

  getStatusLine(): string {
    const gameCount = this.games.length;
    const gamePos = gameCount > 0 ? `${this.selectedGameIdx + 1}/${gameCount}` : '0/0';
    const panelLabels = ['Games', 'Box score', 'Shot chart'];
    const panel = panelLabels[this.focusManager.currentIndex] ?? 'Games';

    let playerLabel = 'All Players';
    if (this.selectedPlayerIdx >= 0 && this.boxScores[this.selectedPlayerIdx]) {
      playerLabel = this.boxScores[this.selectedPlayerIdx].full_name;
    }

    const idx = this.focusManager.currentIndex;
    const moveHint =
      idx === 0 ? '\u2191\u2193 move game' : idx === 1 ? '\u2191\u2193 move player' : 'read-only';

    return `Games ${gamePos} | ${panel} | Player: ${playerLabel} | ${moveHint}`;
  }

  private applyFocus() {
    resetBorderColors(this.focusManager.panels);
    this.focusManager.focusActive();

    const idx = this.focusManager.currentIndex;
    if (idx === 0) {
      focusScroll(this.gameListScroll);
    } else if (idx === 1) {
      focusScroll(this.boxScoreScroll);
    }

    this.container.requestRender();
  }

  isInputFocused(): boolean {
    return false;
  }

  blurInput() {
    // Game Center doesn't have an input field to blur
  }

  handleKeyPress(event: AppKeyEvent): boolean {
    const idx = this.focusManager.currentIndex;

    if (idx === 0) {
      return this.handleGameNav(event);
    }

    if (idx === 1) {
      return this.handleBoxScoreNav(event);
    }

    return false;
  }

  private changeGame(delta: number): boolean {
    const newIdx = this.selectedGameIdx + delta;
    if (newIdx < 0 || newIdx >= this.games.length) return false;

    this.selectedGameIdx = newIdx;
    this.selectedPlayerIdx = -1;
    this.renderGameList();
    scrollIntoView(this.gameListScroll, this.selectedGameIdx);
    this.loadGameDetails();
    return true;
  }

  private changePlayer(delta: number): boolean {
    const newIdx = this.selectedPlayerIdx + delta;
    if (newIdx < -1 || newIdx >= this.boxScores.length) return false;

    this.selectedPlayerIdx = newIdx;
    this.renderBoxScore();
    scrollIntoView(this.boxScoreScroll, this.selectedPlayerIdx + 3);
    this.renderShotChart();
    return true;
  }

  private handleGameNav(event: AppKeyEvent): boolean {
    if (event.name === 'up') return this.changeGame(-1);
    if (event.name === 'down') return this.changeGame(1);
    return false;
  }

  private handleBoxScoreNav(event: AppKeyEvent): boolean {
    if (event.name === 'up') return this.changePlayer(-1);
    if (event.name === 'down') return this.changePlayer(1);
    return false;
  }

  private async loadGameDetails() {
    const activeGame = this.games[this.selectedGameIdx];
    if (!activeGame) return;

    this.boxScoreText.content = ansiToStyledText('Loading box scores...');
    this.shotChartText.content = ansiToStyledText('Loading shots...');
    this.container.requestRender();

    try {
      this.boxScores = await loadBoxScoreWithTeamDedup(String(activeGame.game_id));

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

  private renderGameList() {
    const lines = this.games.map((game, idx) => buildGameLine(game, idx, this.selectedGameIdx));
    this.gameListText.content = ansiToStyledText(lines.join('\n'));
    this.container.requestRender();
  }

  private renderBoxScore() {
    if (this.boxScores.length === 0) {
      this.boxScoreText.content = 'No box score data available.';
      this.container.requestRender();
      return;
    }

    const mappedRows = this.boxScores.map((player, idx) => {
      const isSelected = idx === this.selectedPlayerIdx;
      return {
        ...player,
        full_name: isSelected ? `\u25b6 ${player.full_name}` : `  ${player.full_name}`,
      };
    });

    const allRow = buildAllPlayersRow(this.selectedPlayerIdx === -1);
    const tableLines = formatTable(BOX_SCORE_HEADERS, [allRow, ...mappedRows], {
      colKeys: BOX_SCORE_KEYS,
    });
    this.boxScoreText.content = ansiToStyledText(tableLines.join('\n'));
    this.container.requestRender();
  }

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
    const titleOverlay = `${ansiYellow(selectedPlayerName)}\nShots: ${ansiGreen(String(makes))}/${ansiRed(String(total - makes))} (${pct}% FG)\n${zoneSummary}`;

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
