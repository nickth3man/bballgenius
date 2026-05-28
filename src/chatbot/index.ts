import { createCliRenderer } from '@opentui/core';
import { createChatApp } from './chatApp.js';
import { closeDb, initDb } from './db.js';
import { buildSystemPrompt } from './systemPrompt.js';

async function main() {
  try {
    await initDb();
  } catch (e: unknown) {
    console.error(
      'CRITICAL: Failed to initialize DuckDB connection:',
      e instanceof Error ? e.message : String(e),
    );
    process.exit(1);
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30,
    clearOnShutdown: true,
  });

  renderer.start();

  const systemPrompt = await buildSystemPrompt();

  const chatApp = createChatApp(renderer, systemPrompt);

  const shutdown = async () => {
    try {
      await closeDb();
    } catch (_e) {}
    renderer.destroy();
    process.exit(0);
  };

  renderer.keyInput.on('keypress', (event) => {
    const handled = chatApp.handleKeyPress(event);
    if (handled) {
      event.stopPropagation();
      event.preventDefault();
      renderer.requestRender();
      return;
    }
    if (event.name === 'escape' && !event.ctrl) {
      shutdown();
      return;
    }
    if (event.ctrl && event.name === 'c') {
      shutdown();
    }
  });

  chatApp.focus();
  renderer.requestRender();
}

main().catch((err) => {
  console.error('Fatal Chatbot Error:', err);
  process.exit(1);
});
