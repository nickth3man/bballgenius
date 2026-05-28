import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createAppShell } from '../core/appShell.js';
import { closeDb, initDb } from '../core/db.js';
import { ansiToStyledText } from '../shared/utils/formatters.js';
import { GameCenterTab } from '../tabs/gameCenter/index.js';
import { loadRecentGames } from './helpers/queries.js';

const ANSI_LEAK_IN_FRAME = /\[(?:90|32|31|1;35|1;33)m/;

describe.serial('Visual frame tests (Level 3 captureCharFrame)', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('GameCenterTab frame shows matchup abbrev without leaked SGR fragments', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const gameCenter = new GameCenterTab(renderer);
    renderer.root.add(gameCenter.container);
    gameCenter.container.visible = true;

    await gameCenter.init();
    await virtualUI.renderOnce();

    const games = gameCenter['games'] as { away_team: string; home_team: string }[];
    expect(games.length).toBeGreaterThan(0);

    const frame = virtualUI.captureCharFrame();
    const selected = games[gameCenter['selectedGameIdx']];

    expect(frame).toContain(String(selected.away_team));
    expect(frame).toContain(String(selected.home_team));
    expect(frame).not.toMatch(ANSI_LEAK_IN_FRAME);
    expect(frame).not.toMatch(/\x1b\[/);

    renderer.destroy();
  });

  test('app shell tab header frame has no raw escape artifacts after ansiToStyledText', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 24 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.switchTab(0);
    await virtualUI.renderOnce();

    const frame = virtualUI.captureCharFrame();
    expect(frame).toContain('Game Center');
    expect(frame).toContain('Career Time-Machine');
    expect(frame).not.toMatch(ANSI_LEAK_IN_FRAME);
    expect(frame).not.toMatch(/\x1b\[/);

    renderer.destroy();
  });

  test('tab bar ansiToStyledText path matches production header styling', async () => {
    const tabHeaders = [
      ' \x1b[1;37;45m [F1] Game Center \x1b[0m ',
      ' \x1b[90m[F2] Career Time-Machine\x1b[0m ',
    ];
    const styled = ansiToStyledText(tabHeaders.join('  \x1b[38;2;56;62;90m│\x1b[0m  '));

    const virtualUI = await createTestRenderer({ width: 80, height: 8 });
    const renderer = virtualUI.renderer;
    const { TextRenderable } = await import('@opentui/core');
    const text = new TextRenderable(renderer, { id: 'hdr', content: styled });
    renderer.root.add(text);

    await virtualUI.renderOnce();
    const frame = virtualUI.captureCharFrame();

    expect(frame).toContain('Game Center');
    expect(frame).not.toMatch(ANSI_LEAK_IN_FRAME);

    renderer.destroy();
  });

  test('deterministic game list line appears in frame from dim_game query', async () => {
    const games = await loadRecentGames(1);
    const game = games[0];
    const dateStr = String(game.game_date).substring(5, 10);

    const virtualUI = await createTestRenderer({ width: 120, height: 24 });
    const renderer = virtualUI.renderer;
    const gameCenter = new GameCenterTab(renderer);
    renderer.root.add(gameCenter.container);

    await gameCenter.init();
    await virtualUI.renderOnce();

    const frame = virtualUI.captureCharFrame();
    expect(frame).toContain(`[${dateStr}]`);
    const matchup = `${game.away_team} @ ${game.home_team}`;
    expect(frame.includes(String(game.away_team)) || frame.includes(matchup)).toBe(true);

    renderer.destroy();
  });
});
