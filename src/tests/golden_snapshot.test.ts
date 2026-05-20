import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestRenderer } from '@opentui/core/testing';
import { createAppShell } from '../appShell.js';
import { closeDb, initDb } from '../db.js';
import { normalizeFrameForSnapshot } from './helpers/ansi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = join(__dirname, 'snapshots');
const GAME_CENTER_SNAPSHOT = join(SNAPSHOT_DIR, 'game_center_init.txt');
const UPDATE_SNAPSHOTS = process.env.UPDATE_SNAPSHOTS === '1';

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

    const frame = normalizeFrameForSnapshot(virtualUI.captureCharFrame());

    if (UPDATE_SNAPSHOTS || !existsSync(GAME_CENTER_SNAPSHOT)) {
      writeFileSync(GAME_CENTER_SNAPSHOT, `${frame}\n`, 'utf8');
    }

    const golden = normalizeFrameForSnapshot(readFileSync(GAME_CENTER_SNAPSHOT, 'utf8'));

    expect(frame).toBe(golden);

    renderer.destroy();
  });
});
