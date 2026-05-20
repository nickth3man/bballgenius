import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { getBaseAttributes, TextAttributes } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { createAppShell } from '../appShell.js';
import { closeDb, initDb } from '../db.js';
import { GameCenterTab } from '../tabs/gameCenter.js';
import { SqlSandboxTab } from '../tabs/sqlSandbox.js';
import { assertNoAnsiLeaks } from './helpers/ansi.js';
import { findSpansContaining, framePlainText, rgbaMatches } from './helpers/spans.js';

describe.serial('captureSpans frame tests (Level 3 structured)', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('app shell tab bar selected tab span fg differs from inactive tab', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 24 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.switchTab(0);
    await shell.initTabs();
    await virtualUI.renderOnce();

    const spans = virtualUI.captureSpans();
    const gameCenterSpans = findSpansContaining(spans, 'Game Center');
    const timeMachineSpans = findSpansContaining(spans, 'Career Time-Machine');

    expect(gameCenterSpans.length).toBeGreaterThan(0);
    expect(timeMachineSpans.length).toBeGreaterThan(0);

    const selectedSpan = gameCenterSpans[0];
    const inactiveSpan = timeMachineSpans[0];
    const fgSame = rgbaMatches(selectedSpan.fg, inactiveSpan.fg);
    const bgSame = rgbaMatches(selectedSpan.bg, inactiveSpan.bg);
    const selectedBold = (getBaseAttributes(selectedSpan.attributes) & TextAttributes.BOLD) !== 0;
    expect(fgSame && bgSame && !selectedBold).toBe(false);

    const charFrame = virtualUI.captureCharFrame();
    assertNoAnsiLeaks(charFrame);
    expect(charFrame).toContain('Game Center');

    renderer.destroy();
  });

  test('game center spans include selected matchup abbreviations', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const gameCenter = new GameCenterTab(renderer);
    renderer.root.add(gameCenter.container);
    gameCenter.container.visible = true;

    await gameCenter.init();
    await virtualUI.renderOnce();

    const games = gameCenter['games'] as { away_team: string; home_team: string }[];
    expect(games.length).toBeGreaterThan(0);

    const selected = games[gameCenter['selectedGameIdx']];
    const plain = framePlainText(virtualUI.captureSpans());

    expect(plain).toContain(String(selected.away_team));
    expect(plain).toContain(String(selected.home_team));

    renderer.destroy();
  });

  test('sql sandbox schema filter shows dim_player in spans without ANSI leaks', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const sqlSandbox = new SqlSandboxTab(renderer);
    renderer.root.add(sqlSandbox.container);
    sqlSandbox.container.visible = true;

    await sqlSandbox.init();
    sqlSandbox['schemaFilterInput'].value = 'dim_player';
    sqlSandbox['schemaFilterQuery'] = 'dim_player';
    await sqlSandbox['rebuildSchemaNodes']();
    await virtualUI.renderOnce();

    const plain = framePlainText(virtualUI.captureSpans());
    expect(plain).toContain('dim_player');

    const charFrame = virtualUI.captureCharFrame();
    assertNoAnsiLeaks(charFrame);
    expect(charFrame).not.toMatch(/\x1b\[/);

    const dimPlayerSpans = findSpansContaining(virtualUI.captureSpans(), 'dim_player');
    expect(dimPlayerSpans.length).toBeGreaterThan(0);
    expect(dimPlayerSpans[0].fg).toBeDefined();

    renderer.destroy();
  });
});
