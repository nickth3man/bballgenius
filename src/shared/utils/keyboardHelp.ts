/**
 * Keyboard shortcut reference for BBallGenius app shell help overlay.
 */

import { buildGlobalKeyboardShortcuts, TAB_REGISTRY } from '../../tabs/registry.js';
import type { KeyboardShortcut } from '../../tabs/types.js';

export type { KeyboardShortcut } from '../../tabs/types.js';

export interface KeyboardMap {
  global: KeyboardShortcut[];
  tabs: Record<string, KeyboardShortcut[]>;
}

/** Machine-readable shortcut map (also serialized to keyboard-map.json for agents). */
export const KEYBOARD_MAP: KeyboardMap = {
  global: buildGlobalKeyboardShortcuts(TAB_REGISTRY),
  tabs: Object.fromEntries(TAB_REGISTRY.map((tab) => [tab.id, tab.keyboardShortcuts])),
};

function shortcutLine({ keys, action }: KeyboardShortcut): string {
  return `${keys.padEnd(10)} ${action}`;
}

export const GLOBAL_SHORTCUTS = KEYBOARD_MAP.global.map(shortcutLine);

/**
 * Builds help overlay lines (title + sections) for the app shell.
 */
export function buildHelpLines(): string[] {
  const lines: string[] = [
    ' BBallGenius — Keyboard Shortcuts ',
    '',
    ' Global ',
    ...GLOBAL_SHORTCUTS.map((s) => `   ${s}`),
  ];

  for (const tab of TAB_REGISTRY) {
    lines.push('', ` ${tab.name} `);
    lines.push(...tab.keyboardShortcuts.map((shortcut) => `   ${shortcutLine(shortcut)}`));
  }

  lines.push('', ' Press ? or Esc to close ');
  return lines;
}
