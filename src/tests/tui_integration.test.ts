import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BoxRenderable, KeyEvent, type StyledText, TextRenderable } from '@opentui/core';
import { createTestRenderer, KeyCodes } from '@opentui/core/testing';
import { type AppShell, createAppShell, makeTestKeyEvent } from '../core/appShell.js';
import { closeDb, initDb } from '../core/db.js';
import { ansiToStyledText } from '../shared/utils/formatters.js';
import { Theme } from '../shared/utils/theme.js';
import { GameCenterTab } from '../tabs/gameCenter/index.js';
import { getTabById } from '../tabs/registry.js';
import { SqlSandboxTab } from '../tabs/sqlSandbox/index.js';
import { TimeMachineTab } from '../tabs/timeMachine/index.js';
import { styledPlainText } from './helpers/ansi.js';
import { getTab } from './helpers/tabs.js';

function textContent(content: string | StyledText): string {
  return typeof content === 'string' ? content : styledPlainText(content);
}

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

function readHelpVisible(shell: AppShell): boolean | undefined {
  const extended = shell as AppShell & {
    helpVisible?: boolean;
    helpOverlay?: { visible?: boolean };
  };
  if (typeof extended.helpVisible === 'boolean') {
    return extended.helpVisible;
  }
  if (extended.helpOverlay && typeof extended.helpOverlay.visible === 'boolean') {
    return extended.helpOverlay.visible;
  }
  const workspaceChildren = (
    shell.workspaceBox as { children?: { id?: string; visible?: boolean }[] }
  ).children;
  for (const child of workspaceChildren ?? []) {
    if ((child as { id?: string }).id === 'help-overlay') {
      return (child as { visible: boolean }).visible;
    }
  }
  return undefined;
}

type TestRendererHarness = Awaited<ReturnType<typeof createTestRenderer>>;
type HubTab = GameCenterTab | TimeMachineTab | SqlSandboxTab;

describe('TUI Hub Shell & Navigation Integration Tests', () => {
  let virtualUI: TestRendererHarness;
  let tabs: HubTab[] = [];
  let activeTabIdx = 0;

  beforeAll(async () => {
    // Initialize DB connection so tabs don't fail async loading
    await initDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('should boot application, render header tabs, and toggle visibility on navigation keys', async () => {
    // 1. Spawns an in-memory 80x24 TUI Canvas
    virtualUI = await createTestRenderer({
      width: 80,
      height: 24,
    });

    const renderer = virtualUI.renderer;

    // 2. Build the root container mirroring src/hub/index.ts
    const rootBox = new BoxRenderable(renderer, {
      id: 'root-container',
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      backgroundColor: Theme.background,
    });
    renderer.root.add(rootBox);

    const headerBox = new BoxRenderable(renderer, {
      id: 'header-box',
      width: '100%',
      height: 3,
    });
    const tabBarText = new TextRenderable(renderer, {
      id: 'tab-bar-text',
      content: '',
    });
    headerBox.add(tabBarText);
    rootBox.add(headerBox);

    const workspaceBox = new BoxRenderable(renderer, {
      id: 'workspace-box',
      width: '100%',
      flexGrow: 1,
      flexDirection: 'column',
    });
    rootBox.add(workspaceBox);

    // 3. Mount tabs
    tabs = [new GameCenterTab(renderer), new TimeMachineTab(renderer), new SqlSandboxTab(renderer)];

    tabs.forEach((tab) => {
      workspaceBox.add(tab.container);
    });

    // Mirror the tab toggler logic
    const switchTab = (tabIdx: number) => {
      activeTabIdx = tabIdx;
      tabs.forEach((tab, idx) => {
        tab.container.visible = idx === activeTabIdx;
      });

      const tabHeaders = tabs.map((tab, idx) => {
        const shortcut = `[F${idx + 1}]`;
        const isSelected = idx === activeTabIdx;
        if (isSelected) {
          return ` \x1b[1;37;45m ${shortcut} ${tab.name} \x1b[0m `;
        } else {
          return ` \x1b[90m${shortcut} ${tab.name}\x1b[0m `;
        }
      });
      tabBarText.content = ansiToStyledText(tabHeaders.join(' │ '));
      tabs[activeTabIdx].focus();
    };

    // 4. Initial Switch and Render Pass
    switchTab(0);
    await virtualUI.renderOnce();

    // Verify Tab 1 (Game Center) is visible, while others are hidden
    expect(getTabById(tabs, 'game-center')!.container.visible).toBe(true);
    expect(getTabById(tabs, 'time-machine')!.container.visible).toBe(false);
    expect(getTabById(tabs, 'sql-sandbox')!.container.visible).toBe(false);

    // 5. Navigate to Tab 2 (Time Machine)
    switchTab(1);
    await virtualUI.renderOnce();

    // Verify Tab 2 is visible, and it has grabbed focus on its search input
    expect(getTabById(tabs, 'game-center')!.container.visible).toBe(false);
    expect(getTabById(tabs, 'time-machine')!.container.visible).toBe(true);
    expect(getTabById(tabs, 'sql-sandbox')!.container.visible).toBe(false);

    // Check search input grabbed focus
    expect(getTabById(tabs, 'time-machine')!.isInputFocused()).toBe(true);

    // 6. Navigate to Tab 3 (SQL Sandbox)
    switchTab(2);
    await virtualUI.renderOnce();

    expect(getTabById(tabs, 'game-center')!.container.visible).toBe(false);
    expect(getTabById(tabs, 'time-machine')!.container.visible).toBe(false);
    expect(getTabById(tabs, 'sql-sandbox')!.container.visible).toBe(true);

    // Cleanly destroy virtual renderer
    renderer.destroy();
  });

  test('should handle focus cycling inside active tabs', async () => {
    virtualUI = await createTestRenderer({ width: 80, height: 24 });
    const renderer = virtualUI.renderer;

    // Load Career Time Machine Tab
    const timeMachine = new TimeMachineTab(renderer);
    renderer.root.add(timeMachine.container);
    timeMachine.container.visible = true;

    // Run initial layout/render pass
    await virtualUI.renderOnce();

    // Start with search panel focused (Index 0)
    timeMachine.focus();
    await virtualUI.renderOnce();
    expect(timeMachine.isInputFocused()).toBe(true);

    // Programmatically cycle focus to Dossier panel (Index 1)
    timeMachine.cycleFocus();
    await virtualUI.renderOnce();
    expect(timeMachine.isInputFocused()).toBe(false);

    // Programmatically cycle focus to Stats panel (Index 2)
    timeMachine.cycleFocus();
    await virtualUI.renderOnce();
    expect(timeMachine.isInputFocused()).toBe(false);

    // Cycle focus back to Search panel (Index 0)
    timeMachine.cycleFocus();
    await virtualUI.renderOnce();
    expect(timeMachine.isInputFocused()).toBe(true);

    renderer.destroy();
  });

  test('should safely blur focused input on escape key events without crashing', async () => {
    virtualUI = await createTestRenderer({ width: 80, height: 24 });
    const renderer = virtualUI.renderer;

    const sqlSandbox = new SqlSandboxTab(renderer);
    renderer.root.add(sqlSandbox.container);
    sqlSandbox.container.visible = true;

    // Run initial layout/render pass
    await virtualUI.renderOnce();

    // Set initial focus (focusIndex starts at 1, which is SQL Input)
    sqlSandbox.focus();
    await virtualUI.renderOnce();
    expect(sqlSandbox.isInputFocused()).toBe(true);

    // Trigger blur programmatically as the main router would do when pressing Escape
    if (sqlSandbox.isInputFocused()) {
      sqlSandbox.blurInput();
    }
    await virtualUI.renderOnce();

    // Verify focus has left the input box and reset to index 0 (Schema browser)
    expect(sqlSandbox.isInputFocused()).toBe(false);

    renderer.destroy();
  });

  test('should handle interactive game directory navigation and details loading on GameCenterTab', async () => {
    virtualUI = await createTestRenderer({ width: 80, height: 24 });
    const renderer = virtualUI.renderer;

    const gameCenter = new GameCenterTab(renderer);
    renderer.root.add(gameCenter.container);
    gameCenter.container.visible = true;

    // Load active games list
    await gameCenter.init();
    await virtualUI.renderOnce();

    // Verify game list was populated
    expect(gameCenter['games'].length).toBeGreaterThan(0);
    expect(gameCenter['selectedGameIdx']).toBe(0);

    // Capture the initial game ID
    const initialGameId = gameCenter['games'][0].game_id;

    // Simulate hitting "down" arrow to move selected game index
    const keyHandled = gameCenter.handleKeyPress(makeKeyEvent('down'));
    expect(keyHandled).toBe(true);
    await virtualUI.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify selected index shifted and player filter reset
    expect(gameCenter['selectedGameIdx']).toBe(1);
    expect(gameCenter['selectedPlayerIdx']).toBe(-1);

    // Verify that game center programmatically triggers game score details reload
    const newGameId = gameCenter['games'][1].game_id;
    expect(newGameId).not.toBe(initialGameId);
    expect(gameCenter['boxScores'].length).toBeGreaterThan(0);

    renderer.destroy();
  });

  test('should handle interactive schema table expansion and column rendering on SqlSandboxTab', async () => {
    virtualUI = await createTestRenderer({ width: 80, height: 24 });
    const renderer = virtualUI.renderer;

    const sqlSandbox = new SqlSandboxTab(renderer);
    renderer.root.add(sqlSandbox.container);
    sqlSandbox.container.visible = true;

    // Initialize sandbox database schema explorer
    await sqlSandbox.init();
    await virtualUI.renderOnce();

    // Verify tables list is populated
    expect(sqlSandbox['tables'].length).toBeGreaterThan(0);
    expect(sqlSandbox.getSchemaNodes().length).toBeGreaterThan(0);
    expect(sqlSandbox.getSelectedSchemaIdx()).toBe(0);

    // Capture initial count of displayed schema elements
    const initialNodesCount = sqlSandbox.getSchemaNodes().length;

    // Target the first element (which should be a "table" type node)
    const firstNode = sqlSandbox.getSchemaNodes()[0];
    expect(firstNode.type).toBe('table');

    // Set focus to the Schema browser panel (Index 0) programmatically
    sqlSandbox['focusIndex'] = 0;

    // Simulate pressing "Enter" on the table node to expand it
    const enterHandled = sqlSandbox.handleKeyPress(makeKeyEvent('enter'));
    expect(enterHandled).toBe(true);

    // Since loading columns is async, we allow some microticks for rebuildSchema() to execute
    await new Promise((resolve) => setTimeout(resolve, 300));
    await virtualUI.renderOnce();

    // Verify the table expanded state updated
    expect(sqlSandbox.getExpandedTables().has(firstNode.name)).toBe(true);

    // Verify that column nodes were successfully injected under the expanded table
    const expandedNodesCount = sqlSandbox.getSchemaNodes().length;
    expect(expandedNodesCount).toBeGreaterThan(initialNodesCount);

    // Verify the second node is now a "column" type node
    const secondNode = sqlSandbox.getSchemaNodes()[1];
    expect(secondNode.type).toBe('column');
    expect(secondNode.tableName).toBe(firstNode.name);

    renderer.destroy();
  });

  test('should support autocomplete suggestions and Tab insertion on SQL Sandbox', async () => {
    virtualUI = await createTestRenderer({ width: 80, height: 24 });
    const renderer = virtualUI.renderer;

    const sqlSandbox = new SqlSandboxTab(renderer);
    renderer.root.add(sqlSandbox.container);
    sqlSandbox.container.visible = true;

    await sqlSandbox.init();
    await virtualUI.renderOnce();

    // Set input value to "SEL" to trigger autocomplete suggestion "SELECT"
    sqlSandbox['sqlInput'].value = 'SEL';
    sqlSandbox['currentQuery'] = 'SEL';
    sqlSandbox['updateAutocomplete']();

    expect(sqlSandbox['autocompleteSuggestions']).toContain('SELECT');

    // Handle keypress "tab" on SQL Sandbox to accept the autocomplete suggestion
    const keyHandled = sqlSandbox.handleKeyPress(makeKeyEvent('tab'));
    expect(keyHandled).toBe(true);

    expect(sqlSandbox['sqlInput'].value).toBe('SELECT ');

    renderer.destroy();
  });

  test('should support filtering table schemas on SQL Sandbox', async () => {
    virtualUI = await createTestRenderer({ width: 80, height: 24 });
    const renderer = virtualUI.renderer;

    const sqlSandbox = new SqlSandboxTab(renderer);
    renderer.root.add(sqlSandbox.container);
    sqlSandbox.container.visible = true;

    await sqlSandbox.init();
    await virtualUI.renderOnce();

    const originalCount = sqlSandbox.getSchemaNodes().length;

    // Filter by table "dim_player"
    sqlSandbox['schemaFilterInput'].value = 'dim_player';
    await sqlSandbox.setSchemaFilterQuery('dim_player');

    // Verify list is filtered
    expect(sqlSandbox.getSchemaNodes().length).toBeLessThan(originalCount);
    expect(sqlSandbox.getSchemaNodes()[0].name).toBe('dim_player');

    renderer.destroy();
  });

  test('should support player career statistics totals/averages rendering and Team Comparison mode toggling on TimeMachineTab', async () => {
    virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;

    const timeMachine = new TimeMachineTab(renderer);
    renderer.root.add(timeMachine.container);
    timeMachine.container.visible = true;

    await timeMachine.init();
    await virtualUI.renderOnce();

    // Verify totals/averages exist on Career stats view
    const renderedStatsText = textContent(timeMachine['statsText'].content);
    expect(renderedStatsText).toContain('Totals & Averages');

    // Trigger toggle mode (Player -> Team Compare) via handleKeyPress 'c'
    timeMachine['focusIndex'] = 1;
    timeMachine['searchInput'].blur();
    expect(timeMachine.isInputFocused()).toBe(false);

    const toggleHandled = timeMachine.handleKeyPress(makeKeyEvent('c'));
    expect(toggleHandled).toBe(true);
    expect(timeMachine['mode']).toBe('team');

    // Verify inputs and panel are switched
    expect(timeMachine['teamSearchPanel'].visible).toBe(true);
    expect(timeMachine['searchPanel'].visible).toBe(false);

    // Use teams/seasons present in the CI fixture boxscore slice (2025-26)
    timeMachine['teamAInput'].value = 'LAL 2025';
    timeMachine['teamAQuery'] = 'LAL 2025';
    timeMachine['teamBInput'].value = 'PHI 2025';
    timeMachine['teamBQuery'] = 'PHI 2025';

    await timeMachine['loadTeamData']('A');
    await timeMachine['loadTeamData']('B');

    const renderedCompareText = textContent(timeMachine['statsText'].content);
    expect(renderedCompareText).toContain('HISTORICAL TEAM COMPARISON');
    expect(renderedCompareText).toContain('Metric');

    renderer.destroy();
  });
});

describe.serial('TUI accessibility integration (intended app shell API)', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('F3 + Tab via mockInput does not cycle SQL Sandbox focus while typing', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.attachKeyHandlers();
    virtualUI.mockInput.pressKey(KeyCodes.F3);
    await virtualUI.renderOnce();

    const sqlTab = getTab<SqlSandboxTab>(shell, 'sql-sandbox');
    expect(sqlTab.isInputFocused()).toBe(true);

    const focusBefore = sqlTab['focusIndex'] as number;
    virtualUI.mockInput.pressTab();
    await virtualUI.renderOnce();

    expect(sqlTab['focusIndex']).toBe(focusBefore);
    expect(sqlTab.isInputFocused()).toBe(true);

    renderer.destroy();
  });

  test('Shift+Tab via mockInput cycles focus backward on Time Machine', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.attachKeyHandlers();
    shell.switchTab(1);
    await virtualUI.renderOnce();

    expect(getTab(shell, 'time-machine').isInputFocused()).toBe(true);

    // Esc blurs search and focuses dossier; Tab is blocked while search input is focused.
    virtualUI.mockInput.pressEscape();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await virtualUI.renderOnce();
    expect(getTab(shell, 'time-machine').isInputFocused()).toBe(false);

    virtualUI.mockInput.pressTab({ shift: true });
    await virtualUI.renderOnce();
    expect(getTab(shell, 'time-machine').isInputFocused()).toBe(true);

    renderer.destroy();
  });

  test('digit key 2 via mockInput switches to Time Machine tab', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.attachKeyHandlers();
    shell.switchTab(0);
    await virtualUI.renderOnce();

    virtualUI.mockInput.pressKey('2');
    await virtualUI.renderOnce();

    expect(shell.activeTabIdx).toBe(1);
    expect(getTab(shell, 'time-machine').container.visible).toBe(true);
    expect(getTab(shell, 'time-machine').isInputFocused()).toBe(true);

    renderer.destroy();
  });

  test('? via routeKeyPress toggles help when helpVisible exists on shell', async () => {
    const virtualUI = await createTestRenderer({ width: 100, height: 32 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.attachKeyHandlers();
    await virtualUI.renderOnce();

    const before = readHelpVisible(shell);
    shell.routeKeyPress(makeKeyEvent('?'));
    await virtualUI.renderOnce();
    const afterToggle = readHelpVisible(shell);

    if (before === undefined) {
      expect(afterToggle).toBeUndefined();
      renderer.destroy();
      return;
    }

    expect(afterToggle).toBe(!before);
    shell.routeKeyPress(makeTestKeyEvent('?'));
    await virtualUI.renderOnce();
    expect(readHelpVisible(shell)).toBe(before);

    renderer.destroy();
  });
});
