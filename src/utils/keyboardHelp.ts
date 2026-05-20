/**
 * Keyboard shortcut reference for BBallGenius app shell help overlay.
 */

export interface KeyboardShortcut {
  keys: string;
  action: string;
}

export interface KeyboardMap {
  global: KeyboardShortcut[];
  gameCenter: KeyboardShortcut[];
  timeMachine: KeyboardShortcut[];
  sqlSandbox: KeyboardShortcut[];
}

/** Machine-readable shortcut map (also serialized to keyboard-map.json for agents). */
export const KEYBOARD_MAP: KeyboardMap = {
  global: [
    { keys: 'F1 / 1', action: 'Game Center' },
    { keys: 'F2 / 2', action: 'Career Time-Machine' },
    { keys: 'F3 / 3', action: 'SQL Sandbox' },
    { keys: 'Tab', action: 'Cycle focus (when not typing)' },
    { keys: 'Shift+Tab', action: 'Cycle focus backward' },
    { keys: 'Esc', action: 'Blur input, or quit' },
    { keys: 'Ctrl+C', action: 'Quit' },
    { keys: '?', action: 'Toggle this help' },
  ],
  gameCenter: [
    { keys: 'Up/Down', action: 'Navigate games or players (focused panel)' },
    { keys: 'Tab', action: 'Switch Game List / Box Score focus' },
  ],
  timeMachine: [
    { keys: 'Type', action: 'Search players (search focused)' },
    { keys: 'Up/Down', action: 'Move suggestion highlight' },
    { keys: 'Enter', action: 'Select highlighted player' },
    { keys: 'Tab', action: 'Insert tab in search, or cycle focus when not typing' },
    { keys: 'Esc', action: 'Blur search, focus stats panel' },
    { keys: 'C', action: 'Toggle Player/Team Mode' },
  ],
  sqlSandbox: [
    { keys: 'Ctrl+R/E', action: 'Run SQL query' },
    { keys: 'Type', action: 'Filter schema tables/columns (schema focused)' },
    { keys: 'Up/Down', action: 'Navigate schema tree' },
    { keys: 'Enter', action: 'Expand table / insert column name' },
    { keys: 'Tab', action: 'Accept autocomplete, or cycle focus when not typing' },
    { keys: '↑↓', action: 'Cycle autocomplete suggestions (SQL input)' },
    { keys: 'Esc', action: 'Blur input, focus schema tree' },
  ],
};

function shortcutLine({ keys, action }: KeyboardShortcut): string {
  return `${keys.padEnd(10)} ${action}`;
}

export const GLOBAL_SHORTCUTS = KEYBOARD_MAP.global.map(shortcutLine);

const GAME_CENTER_SHORTCUTS = KEYBOARD_MAP.gameCenter.map(shortcutLine);

const TIME_MACHINE_SHORTCUTS = KEYBOARD_MAP.timeMachine.map(shortcutLine);

const SQL_SANDBOX_SHORTCUTS = KEYBOARD_MAP.sqlSandbox.map(shortcutLine);

/**
 * Builds help overlay lines (title + sections) for the app shell.
 */
export function buildHelpLines(): string[] {
  const lines: string[] = [
    ' BBallGenius — Keyboard Shortcuts ',
    '',
    ' Global ',
    ...GLOBAL_SHORTCUTS.map((s) => `   ${s}`),
    '',
    ' Game Center ',
    ...GAME_CENTER_SHORTCUTS.map((s) => `   ${s}`),
    '',
    ' Career Time-Machine ',
    ...TIME_MACHINE_SHORTCUTS.map((s) => `   ${s}`),
    '',
    ' SQL Sandbox ',
    ...SQL_SANDBOX_SHORTCUTS.map((s) => `   ${s}`),
    '',
    ' Press ? or Esc to close ',
  ];
  return lines;
}
