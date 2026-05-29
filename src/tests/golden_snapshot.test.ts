import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyEvent } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { createAppShell } from '../core/appShell.js';
import { closeDb, initDb } from '../core/db.js';
import type { SqlSandboxTab } from '../tabs/sqlSandbox/index.js';
import type { TimeMachineTab } from '../tabs/timeMachine/index.js';
import { normalizeFrameForSnapshot } from './helpers/ansi.js';
import { settleAsyncTabWork } from './helpers/keyInput.js';
import { getTab } from './helpers/tabs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = join(__dirname, 'snapshots');
const GAME_CENTER_SNAPSHOT = join(SNAPSHOT_DIR, 'game_center_init.txt');
const TIME_MACHINE_TEAM_SNAPSHOT = join(SNAPSHOT_DIR, 'time_machine_team_compare.txt');
const SQL_SANDBOX_FILTER_SNAPSHOT = join(SNAPSHOT_DIR, 'sql_sandbox_schema_filter.txt');
const UPDATE_SNAPSHOTS = process.env.UPDATE_SNAPSHOTS === '1';

function makeKeyEvent(name: string): KeyEvent {
  return new KeyEvent({
    name,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: name,
    number: false,
    raw: name,
    eventType: 'press',
    source: 'raw',
  });
}

function normalizeGoldenFrame(frame: string, variant: 'default' | 'team' = 'default'): string {
  let normalized = normalizeFrameForSnapshot(frame);
  // OpenTUI occasionally emits mixed block glyphs for the same border cell.
  normalized = normalized.replace(/[█▀]/g, '█');
  if (variant === 'team') {
    normalized = normalized.replace(
      /\n {2}Search · [^\n]+$/m,
      '\n  Keys: F1-3/1-3 Tab Shift+Tab ? | Esc quit',
    );
  }
  return normalized;
}

function assertGoldenFrame(
  frame: string,
  snapshotPath: string,
  variant: 'default' | 'team' = 'default',
): void {
  const normalized = normalizeGoldenFrame(frame, variant);

  if (UPDATE_SNAPSHOTS || !existsSync(snapshotPath)) {
    writeFileSync(snapshotPath, `${normalized}\n`, 'utf8');
  }

  const golden = normalizeFrameForSnapshot(readFileSync(snapshotPath, 'utf8'));
  expect(normalized).toBe(golden);
}

describe('Golden frame snapshots (Level 5)', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('game center shell frame matches golden snapshot', async () => {
    const virtualUI = await createTestRenderer({ width: 80, height: 24 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.switchTab(0);
    await shell.initTabs();
    await virtualUI.renderOnce();

    assertGoldenFrame(virtualUI.captureCharFrame(), GAME_CENTER_SNAPSHOT);

    renderer.destroy();
  });

  test('time machine team comparison frame matches golden snapshot', async () => {
    const virtualUI = await createTestRenderer({ width: 120, height: 32 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.switchTab(1);
    await shell.initTabs();

    const timeMachine = getTab<TimeMachineTab>(shell, 'time-machine');
    timeMachine['focusIndex'] = 1;
    timeMachine['searchInput'].blur();
    timeMachine.handleKeyPress(makeKeyEvent('c'));

    timeMachine['teamAInput'].value = 'LAL 2025';
    timeMachine['teamAQuery'] = 'LAL 2025';
    timeMachine['teamBInput'].value = 'PHI 2025';
    timeMachine['teamBQuery'] = 'PHI 2025';

    await timeMachine['loadTeamData']('A');
    await timeMachine['loadTeamData']('B');
    await settleAsyncTabWork();
    await virtualUI.renderOnce();
    await virtualUI.renderOnce();

    assertGoldenFrame(virtualUI.captureCharFrame(), TIME_MACHINE_TEAM_SNAPSHOT, 'team');

    renderer.destroy();
  });

  test('sql sandbox schema filter frame matches golden snapshot', async () => {
    const virtualUI = await createTestRenderer({ width: 80, height: 24 });
    const renderer = virtualUI.renderer;
    const shell = createAppShell(renderer);

    shell.switchTab(2);
    await shell.initTabs();

    const sqlSandbox = getTab<SqlSandboxTab>(shell, 'sql-sandbox');
    sqlSandbox['schemaFilterInput'].value = 'dim_player';
    await sqlSandbox.setSchemaFilterQuery('dim_player');
    await virtualUI.renderOnce();

    assertGoldenFrame(virtualUI.captureCharFrame(), SQL_SANDBOX_FILTER_SNAPSHOT);

    renderer.destroy();
  });
});
