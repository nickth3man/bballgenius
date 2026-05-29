import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { closeDb, initDb } from '../core/db.js';
import { ansiToStyledText, drawHalfCourt } from '../shared/utils/formatters.js';
import { GameCenterTab } from '../tabs/gameCenter/index.js';
import { assertNoAnsiLeaks, styledPlainText } from './helpers/ansi.js';
import { loadBoxScoreWithTeamDedup, loadPlayerAwards, loadRecentGames } from './helpers/queries.js';

const LEBRON_PLAYER_ID = '2544';

describe('Regression guards (Level 1–2 user outcomes)', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('awards query uses award column for LeBron (player_id 2544)', async () => {
    const awards = await loadPlayerAwards(LEBRON_PLAYER_ID);
    expect(awards.length).toBeGreaterThan(0);
    expect(awards[0]).toHaveProperty('award');
    expect(awards[0].award).toBeTruthy();
    expect(awards[0]).not.toHaveProperty('award_name');
  });

  test('box score with team_dedup returns unique player_id per game', async () => {
    const games = await loadRecentGames(5);
    expect(games.length).toBeGreaterThan(0);

    const gameId = String(games[0].game_id);
    const rows = await loadBoxScoreWithTeamDedup(gameId);
    expect(rows.length).toBeGreaterThan(0);

    const playerIds = rows.map((r) => String(r.player_id));
    const unique = new Set(playerIds);
    expect(unique.size).toBe(rows.length);
  });

  test('ansiToStyledText strips raw escapes from shot chart content', () => {
    const shots = [
      { x: 12, y: 48, shot_result: 'made', player_id: '1' },
      { x: 30, y: 60, shot_result: 'missed', player_id: '2' },
    ];
    const courtLines = drawHalfCourt(shots);
    const titleOverlay =
      '\x1b[1;33mAll Players\x1b[0m\nShots: \x1b[32m5\x1b[0m/\x1b[31m3\x1b[0m (62.5% FG)';
    const styled = ansiToStyledText(`${titleOverlay}\n\n${courtLines.join('\n')}`);
    const plain = styledPlainText(styled);

    assertNoAnsiLeaks(plain);
    expect(plain).toContain('All Players');
    expect(plain).toContain('Shots:');
  });

  test('GameCenterTab shot chart render path has no ANSI leaks in styled content', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const gameCenter = new GameCenterTab(renderer);
    renderer.root.add(gameCenter.container);

    await gameCenter.init();
    gameCenter['renderShotChart']();
    await virtualUI.renderOnce();

    const shotContent = gameCenter['shotChartText'].content;
    const plain = typeof shotContent === 'string' ? shotContent : styledPlainText(shotContent);

    assertNoAnsiLeaks(plain);
    expect(plain.length).toBeGreaterThan(10);

    renderer.destroy();
  });

  test('loaded game matchup abbrev appears in game list styled text', async () => {
    const games = await loadRecentGames(1);
    const game = games[0];
    const matchupLine = `\x1b[1m${game.away_team}\x1b[0m @ \x1b[1m${game.home_team}\x1b[0m`;
    const styled = ansiToStyledText(matchupLine);
    const plain = styledPlainText(styled);

    expect(plain).toContain(String(game.away_team));
    expect(plain).toContain(String(game.home_team));
    assertNoAnsiLeaks(plain);
  });
});
