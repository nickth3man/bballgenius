import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCliRenderer } from '@opentui/core';
import { createAppShell } from './core/appShell.js';
import { closeDb, initDb } from './core/db.js';
import { getErrorMessage } from './core/errors.js';

function loadDotEnvOverrides(): void {
  try {
    const envPath = join(process.cwd(), '.env');
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && value) process.env[key] = value;
    }
  } catch {}
}

loadDotEnvOverrides();

async function main() {
  try {
    await initDb();
  } catch (e: unknown) {
    console.error('CRITICAL: Failed to initialize DuckDB connection:', getErrorMessage(e));
    process.exit(1);
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30,
    clearOnShutdown: true,
  });

  renderer.start();

  const shell = createAppShell(renderer);

  renderer.on('resize', () => {
    shell.syncTabSelectOptions();
    renderer.requestRender();
  });

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
