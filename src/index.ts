import { createCliRenderer } from '@opentui/core';
import { createAppShell } from './appShell.js';
import { closeDb, initDb } from './db.js';

async function main() {
  try {
    await initDb();
  } catch (e: any) {
    console.error('CRITICAL: Failed to initialize DuckDB connection:', e.message);
    process.exit(1);
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30,
    clearOnShutdown: true,
  });

  renderer.start();

  const shell = createAppShell(renderer);

  const shutdown = async () => {
    try {
      await closeDb();
    } catch (_e) {}
    renderer.destroy();
    process.exit(0);
  };

  shell.attachKeyHandlers({ onShutdown: shutdown });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  shell.switchTab(0);

  shell.initTabs().catch((err) => {
    shell.footerLeftText.content = `[!] DB Initialization error: ${err.message}`;
    renderer.requestRender();
  });

  renderer.requestRender();
}

main().catch((err) => {
  console.error('Fatal TUI Error:', err);
  process.exit(1);
});
