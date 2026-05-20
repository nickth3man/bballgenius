/**
 * Dumps captureSpans() JSON for a BBallGenius app shell tab (agent/LLM inspection).
 *
 * Usage:
 *   NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb bun run scripts/capture-spans-dump.ts [tabIndex]
 *
 * tabIndex: 0 Game Center, 1 Time Machine, 2 SQL Sandbox (default 0)
 */
import { createTestRenderer } from '@opentui/core/testing';
import { createAppShell } from '../src/appShell.js';
import { closeDb, initDb } from '../src/db.js';

const tabIndex = Number.parseInt(process.argv[2] ?? '0', 10);
if (Number.isNaN(tabIndex) || tabIndex < 0 || tabIndex > 2) {
  console.error('tabIndex must be 0, 1, or 2');
  process.exit(1);
}

await initDb();

const virtualUI = await createTestRenderer({ width: 100, height: 32 });
const renderer = virtualUI.renderer;
const shell = createAppShell(renderer);

shell.switchTab(tabIndex);
await shell.initTabs();
await virtualUI.renderOnce();

console.log(JSON.stringify(virtualUI.captureSpans(), null, 2));

renderer.destroy();
await closeDb();
