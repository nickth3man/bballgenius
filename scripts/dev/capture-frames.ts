/**
 * Captures rendered character frames of each hub tab to files.
 *
 * Launches a headless OpenTUI test renderer, initializes the hub shell, and
 * writes each tab's rendered output to results/hub-frames/.
 *
 * Usage:
 *   bun run scripts/capture-frames.ts [width] [height]
 *
 * Defaults to 120x32. Results saved to results/hub-frames/tab{N}-{label}.txt.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createTestRenderer } from '@opentui/core/testing';
import { createAppShell } from '../../src/core/appShell.js';
import { closeDb, initDb } from '../../src/core/db.js';

const OUT_DIR = 'results/hub-frames';
const width = Number.parseInt(process.argv[2] ?? '120', 10);
const height = Number.parseInt(process.argv[3] ?? '32', 10);

async function captureTab(idx: number, label: string) {
  const virtualUI = await createTestRenderer({ width, height });
  const renderer = virtualUI.renderer;
  const shell = createAppShell(renderer);
  shell.switchTab(idx);
  await shell.initTabs();
  // First render flushes the component tree; second captures final layout
  await virtualUI.renderOnce();
  await virtualUI.renderOnce();
  const frame = virtualUI.captureCharFrame();
  const file = `${OUT_DIR}/tab${idx}-${label}.txt`;
  writeFileSync(file, `${frame}\n`, 'utf8');
  renderer.destroy();
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
      console.log(`\n===== TAB ${idx} :: ${label} =====\n${frame}\n`);
    }
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error('capture failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
