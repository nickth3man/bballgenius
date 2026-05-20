/**
 * Keyboard shortcut reference for BBallGenius app shell help overlay.
 */

export const GLOBAL_SHORTCUTS = [
  'F1 / 1     Game Center',
  'F2 / 2     Career Time-Machine',
  'F3 / 3     SQL Sandbox',
  'Tab        Cycle focus (when not typing)',
  'Shift+Tab  Cycle focus backward',
  'Esc        Blur input, or quit',
  'Ctrl+C     Quit',
  '?          Toggle this help',
] as const;

const GAME_CENTER_SHORTCUTS = [
  'Up/Down    Navigate games or players (focused panel)',
  'Tab        Switch Game List / Box Score focus',
] as const;

const TIME_MACHINE_SHORTCUTS = [
  'Type       Search players (search focused)',
  'Up/Down    Move suggestion highlight',
  'Enter      Select highlighted player',
  'Tab        Insert tab in search, or cycle focus when not typing',
  'Esc        Blur search, focus stats panel',
  'C          Toggle Player/Team Mode',
] as const;

const SQL_SANDBOX_SHORTCUTS = [
  'Ctrl+R/E   Run SQL query',
  'Type       Filter schema tables/columns (schema focused)',
  'Up/Down    Navigate schema tree',
  'Enter      Expand table / insert column name',
  'Tab        Accept autocomplete, or cycle focus when not typing',
  '↑↓         Cycle autocomplete suggestions (SQL input)',
  'Esc        Blur input, focus schema tree',
] as const;

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
