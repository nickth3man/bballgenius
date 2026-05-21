import type { CliRenderer } from '@opentui/core';
import { GameCenterTab } from './gameCenter/index.js';
import { SqlSandboxTab } from './sqlSandbox/index.js';
import { TimeMachineTab } from './timeMachine/index.js';
import type { AppShellTab, KeyboardShortcut, TabDefinition } from './types.js';

const GAME_CENTER_SHORTCUTS: KeyboardShortcut[] = [
  { keys: 'Up/Down', action: 'Navigate games or players (focused panel)' },
  { keys: 'Tab', action: 'Cycle Games / Box Score / Shot Chart' },
];

const TIME_MACHINE_SHORTCUTS: KeyboardShortcut[] = [
  { keys: 'Type', action: 'Search players (search focused)' },
  {
    keys: 'Up/Down',
    action: 'Move suggestion highlight, site section, or scroll dossier/stats',
  },
  { keys: 'Left/Right or [/]', action: 'Browse mirrored pages within selected site section' },
  { keys: 'Enter', action: 'Select highlighted player or load mirrored site page' },
  { keys: 'Tab', action: 'Insert tab in search, or cycle focus when not typing' },
  { keys: 'Esc', action: 'Blur search, focus dossier panel' },
  { keys: 'C', action: 'Toggle Player/Team Mode' },
  { keys: 'P/G/E/F/N/S/H/L/O', action: 'Player BBR sub-pages (profile, logs, splits, etc.)' },
  { keys: 'M', action: 'Open BBR site index (all mirrored sections)' },
  { keys: '0-9, A-Z', action: 'Load site pages (leaders, leagues, awards, draft, WNBA, …)' },
  { keys: 'L/E/S/A', action: 'Team mode: Leaders, Leagues, ATL 2000 season, CHI adv gamelog' },
  {
    keys: 'R/I/F/G/T/U/Y/W/V/X/Z',
    action: 'Team compare sub-pages and franchise pages',
  },
];

const SQL_SANDBOX_SHORTCUTS: KeyboardShortcut[] = [
  { keys: 'Ctrl+R/E', action: 'Run SQL query' },
  { keys: 'Type', action: 'Filter schema tables/columns (schema focused)' },
  { keys: 'Up/Down', action: 'Navigate schema tree' },
  { keys: 'Enter', action: 'Expand table / insert column name' },
  { keys: 'Tab', action: 'Accept autocomplete, or cycle focus when not typing' },
  { keys: '↑↓', action: 'Cycle autocomplete suggestions (SQL input)' },
  { keys: 'Esc', action: 'Blur input, focus schema tree' },
];

export const TAB_REGISTRY: TabDefinition[] = [
  {
    id: 'game-center',
    name: 'Game Center',
    shortcutIndex: 1,
    keyboardShortcuts: GAME_CENTER_SHORTCUTS,
    create: (renderer: CliRenderer) => new GameCenterTab(renderer),
  },
  {
    id: 'time-machine',
    name: 'Career Time-Machine',
    shortcutIndex: 2,
    keyboardShortcuts: TIME_MACHINE_SHORTCUTS,
    create: (renderer: CliRenderer) => new TimeMachineTab(renderer),
  },
  {
    id: 'sql-sandbox',
    name: 'SQL Sandbox',
    shortcutIndex: 3,
    keyboardShortcuts: SQL_SANDBOX_SHORTCUTS,
    create: (renderer: CliRenderer) => new SqlSandboxTab(renderer),
  },
];

export function buildGlobalKeyboardShortcuts(registry: TabDefinition[]): KeyboardShortcut[] {
  const tabShortcuts = registry.map((tab) => ({
    keys: `F${tab.shortcutIndex} / ${tab.shortcutIndex}`,
    action: tab.name,
  }));

  return [
    ...tabShortcuts,
    { keys: 'Tab', action: 'Cycle focus (when not typing)' },
    { keys: 'Shift+Tab', action: 'Cycle focus backward' },
    { keys: 'Esc', action: 'Blur input, or quit' },
    { keys: 'Ctrl+C', action: 'Quit' },
    { keys: '?', action: 'Toggle this help' },
  ];
}

export function buildFooterShortcutsHint(registry: TabDefinition[]): string {
  if (registry.length === 0) {
    return 'Keys: Tab Shift+Tab ? | Esc quit';
  }

  const first = registry[0].shortcutIndex;
  const last = registry[registry.length - 1].shortcutIndex;
  return `Keys: F${first}-${last}/${first}-${last} Tab Shift+Tab ? | Esc quit`;
}

export function getTabById(tabs: AppShellTab[], id: string): AppShellTab | undefined {
  return tabs.find((tab) => tab.id === id);
}
