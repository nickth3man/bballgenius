/**
 * Regenerates src/hub/shared/utils/keyboard-map.json from KEYBOARD_MAP in keyboardHelp.ts.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KEYBOARD_MAP } from '../src/hub/shared/utils/keyboardHelp.js';

const outPath = join(import.meta.dir, '..', 'src', 'hub', 'shared', 'utils', 'keyboard-map.json');
writeFileSync(outPath, `${JSON.stringify(KEYBOARD_MAP, null, 2)}\n`);

console.log(`Wrote ${outPath}`);
