import { mkdirSync, writeFileSync } from 'node:fs';
import { createTestRenderer } from '@opentui/core/testing';
import { createAppShell } from '../core/appShell.js';
import { closeDb, initDb } from '../core/db.js';

const OUT_DIR = 'results/hub-frames';

async function captureTab(idx: number, label: string, width = 120, height = 32) {
  const virtualUI = await createTestRenderer({ width, height });
  const renderer = virtualUI.renderer;
  const shell = createAppShell(renderer);
  shell.switchTab(idx);
  await shell.initTabs();
  await virtualUI.renderOnce();
  await virtualUI.renderOnce();
  const frame = virtualUI.captureCharFrame();
  const file = `${OUT_DIR}/tab${idx}-${label}.txt`;
  writeFileSync(file, `${frame}\n`, 'utf8');
  renderer.destroy();
  // eslint-disable-next-line no-console
  console.log(`captured ${file} (${frame.length} chars)`);
  return frame;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  await initDb();
  try {
    const tabs = [
      [0, 'game-center'],
      [1, 'time-machine'],
      [2, 'sql-sandbox'],
    ] as const;
    for (const [idx, label] of tabs) {
      const frame = await captureTab(idx, label);
      // eslint-disable-next-line no-console
      console.log(`\n===== TAB ${idx} :: ${label} =====\n${frame}\n`);
    }
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error('capture failed:', err);
  process.exit(1);
});
