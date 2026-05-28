import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KEYBOARD_MAP } from '../shared/utils/keyboardHelp.js';

describe('keyboardHelp', () => {
  test('keyboard-map.json matches KEYBOARD_MAP', () => {
    const jsonPath = join(import.meta.dir, '..', 'shared', 'utils', 'keyboard-map.json');
    const onDisk = JSON.parse(readFileSync(jsonPath, 'utf8')) as typeof KEYBOARD_MAP;
    expect(onDisk).toEqual(KEYBOARD_MAP);
  });

  test('Time Machine Esc blurs search to dossier panel', () => {
    const esc = KEYBOARD_MAP.tabs['time-machine'].find((entry) => entry.keys === 'Esc');
    expect(esc?.action).toContain('dossier');
    expect(esc?.action).not.toContain('stats panel');
  });

  test('Game Center Tab cycles all three panels', () => {
    const tab = KEYBOARD_MAP.tabs['game-center'].find((entry) => entry.keys === 'Tab');
    expect(tab?.action).toContain('Shot Chart');
  });
});
