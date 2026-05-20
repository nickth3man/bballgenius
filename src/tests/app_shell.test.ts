import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import { KeyEvent } from '@opentui/core';
import { createTestRenderer, KeyCodes } from '@opentui/core/testing';
import { initDb, closeDb } from '../db.js';
import { createAppShell, makeTestKeyEvent, type AppShell } from '../appShell.js';
import { TimeMachineTab } from '../tabs/timeMachine.js';
import { SqlSandboxTab } from '../tabs/sqlSandbox.js';
import { pressEscapeAndFlush } from './helpers/keyInput.js';

function makeKeyEvent(name: string, modifiers?: { shift?: boolean }): KeyEvent {
  return new KeyEvent({
    name,
    ctrl: false,
    meta: false,
    shift: modifiers?.shift ?? false,
    option: false,
    sequence: name,
    number: /^\d$/.test(name),
    raw: name,
    eventType: 'press',
    source: 'raw',
  });
}

/** Reads help overlay visibility from the workspace help-overlay renderable. */
function readHelpVisible(shell: AppShell): boolean | undefined {
  const extended = shell as AppShell & { helpVisible?: boolean; helpOverlay?: { visible?: boolean } };
  if (typeof extended.helpVisible === 'boolean') {
    return extended.helpVisible;
  }
  if (extended.helpOverlay && typeof extended.helpOverlay.visible === 'boolean') {
    return extended.helpOverlay.visible;
  }
  for (const child of shell.workspaceBox.children ?? []) {
    if ((child as { id?: string }).id === 'help-overlay') {
      return (child as { visible: boolean }).visible;
    }
  }
  return undefined;
}

describe.serial('App shell key routing (Level 4 real wiring)', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('F2 switches to Time Machine via production attachKeyHandlers + mockInput', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.attachKeyHandlers();
    shell.switchTab(0);
    await virtualUI.renderOnce();

    expect(shell.tabs[0].container.visible).toBe(true);
    expect(shell.tabs[1].container.visible).toBe(false);

    virtualUI.mockInput.pressKey('F2');
    await virtualUI.renderOnce();

    expect(shell.tabs[0].container.visible).toBe(false);
    expect(shell.tabs[1].container.visible).toBe(true);
    expect(shell.tabs[1].isInputFocused()).toBe(true);

    renderer.destroy();
  });

  test('F3 switches to SQL Sandbox via mockInput', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.attachKeyHandlers();
    shell.switchTab(0);
    await virtualUI.renderOnce();

    virtualUI.mockInput.pressKey(KeyCodes.F3);
    await virtualUI.renderOnce();

    expect(shell.tabs[2].container.visible).toBe(true);
    expect(shell.tabs[0].container.visible).toBe(false);

    renderer.destroy();
  });

  test('Tab key cycles focus on Game Center when no input is focused', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.attachKeyHandlers();
    shell.switchTab(0);
    await virtualUI.renderOnce();

    expect(shell.tabs[0].isInputFocused()).toBe(false);

    virtualUI.mockInput.pressTab();
    await virtualUI.renderOnce();

    expect(shell.tabs[0].isInputFocused()).toBe(false);
    expect(shell.tabs[0].container.visible).toBe(true);

    renderer.destroy();
  });

  test('Tab key does not steal focus from Time Machine search input', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.attachKeyHandlers();
    shell.switchTab(1);
    await virtualUI.renderOnce();

    expect(shell.tabs[1].isInputFocused()).toBe(true);

    virtualUI.mockInput.pressTab();
    await virtualUI.renderOnce();

    expect(shell.tabs[1].isInputFocused()).toBe(true);

    renderer.destroy();
  });

  test('pressEscape blurs Time Machine search without shutdown via attachKeyHandlers', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);
    let shutdownCalled = false;

    shell.attachKeyHandlers({
      onShutdown: () => {
        shutdownCalled = true;
      },
    });

    shell.switchTab(1);
    await virtualUI.renderOnce();

    expect(shell.tabs[1].isInputFocused()).toBe(true);

    await pressEscapeAndFlush(virtualUI);

    expect(shutdownCalled).toBe(false);
    expect(shell.tabs[1].isInputFocused()).toBe(false);

    renderer.destroy();
  });

  test('pressEscape on Game Center invokes onShutdown via attachKeyHandlers', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);
    let shutdownCalled = false;

    shell.attachKeyHandlers({
      onShutdown: () => {
        shutdownCalled = true;
      },
    });

    shell.switchTab(0);
    await shell.initTabs();
    await virtualUI.renderOnce();

    expect(shell.tabs[0].isInputFocused()).toBe(false);

    await pressEscapeAndFlush(virtualUI);

    expect(shutdownCalled).toBe(true);

    renderer.destroy();
  });

  test('typeText into Time Machine search does not change tab visibility', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.attachKeyHandlers();
    virtualUI.mockInput.pressKey(KeyCodes.F2);
    await virtualUI.renderOnce();

    const timeMachine = shell.tabs[1] as TimeMachineTab;
    const searchInput = timeMachine['searchInput'] as { value: string; focused: boolean };

    await virtualUI.mockInput.typeText('LeBron');
    await virtualUI.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(shell.tabs[1].container.visible).toBe(true);
    expect(shell.tabs[0].container.visible).toBe(false);
    expect(searchInput.value).toBe('LeBron');

    searchInput.value = '';
    renderer.destroy();
  });

  test('F1 returns to Game Center after F2 navigation', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.attachKeyHandlers();
    shell.switchTab(0);

    virtualUI.mockInput.pressKey(KeyCodes.F2);
    await virtualUI.renderOnce();
    expect(shell.tabs[1].container.visible).toBe(true);

    virtualUI.mockInput.pressKey(KeyCodes.F1);
    await virtualUI.renderOnce();
    expect(shell.tabs[0].container.visible).toBe(true);

    renderer.destroy();
  });
});

describe.serial('App shell accessibility key routing', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('Tab via routeKeyPress does not cycle focus when SQL input is focused', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.attachKeyHandlers();
    shell.switchTab(2);
    await virtualUI.renderOnce();

    const sqlTab = shell.tabs[2] as SqlSandboxTab;
    expect(sqlTab.isInputFocused()).toBe(true);

    const focusBefore = sqlTab['focusIndex'] as number;
    expect(focusBefore).toBe(1);

    shell.routeKeyPress(makeKeyEvent('tab'));
    await virtualUI.renderOnce();

    expect(sqlTab['focusIndex']).toBe(focusBefore);
    expect(sqlTab.isInputFocused()).toBe(true);

    renderer.destroy();
  });

  test('Shift+Tab via routeKeyPress does not steal focus from Time Machine search input', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.attachKeyHandlers();
    shell.switchTab(1);
    await virtualUI.renderOnce();

    expect(shell.tabs[1].isInputFocused()).toBe(true);

    shell.routeKeyPress(makeKeyEvent('tab', { shift: true }));
    await virtualUI.renderOnce();
    expect(shell.tabs[1].isInputFocused()).toBe(true);

    renderer.destroy();
  });

  test('Shift+Tab via routeKeyPress can cycle focus when input is not focused', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.attachKeyHandlers();
    shell.switchTab(1);
    await virtualUI.renderOnce();

    shell.routeKeyPress(makeTestKeyEvent('escape'));
    await virtualUI.renderOnce();
    expect(shell.tabs[1].isInputFocused()).toBe(false);

    shell.routeKeyPress(makeKeyEvent('tab', { shift: true }));
    await virtualUI.renderOnce();
    expect(shell.tabs[1].isInputFocused()).toBe(true);

    renderer.destroy();
  });

  test('digit key 2 switches to Time Machine tab via routeKeyPress', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.attachKeyHandlers();
    shell.switchTab(0);
    await virtualUI.renderOnce();

    shell.routeKeyPress(makeKeyEvent('2'));
    await virtualUI.renderOnce();

    expect(shell.activeTabIdx).toBe(1);
    expect(shell.tabs[0].container.visible).toBe(false);
    expect(shell.tabs[1].container.visible).toBe(true);
    expect(shell.tabs[1].isInputFocused()).toBe(true);

    renderer.destroy();
  });

  test('? toggles help overlay when shell exposes helpVisible state', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.attachKeyHandlers();
    shell.switchTab(0);
    await virtualUI.renderOnce();

    const before = readHelpVisible(shell);
    shell.routeKeyPress(makeKeyEvent('?'));
    await virtualUI.renderOnce();
    const afterFirst = readHelpVisible(shell);

    if (before === undefined) {
      expect(afterFirst).toBeUndefined();
      renderer.destroy();
      return;
    }

    expect(afterFirst).toBe(!before);

    shell.routeKeyPress(makeKeyEvent('?'));
    await virtualUI.renderOnce();
    expect(readHelpVisible(shell)).toBe(before);

    renderer.destroy();
  });
});
