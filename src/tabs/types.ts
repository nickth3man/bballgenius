import type { BoxRenderable, CliRenderer } from '@opentui/core';
import type { AppKeyEvent } from '../core/input.js';

export interface KeyboardShortcut {
  keys: string;
  action: string;
}

export interface AppShellTab {
  readonly id: string;

  readonly name: string;

  readonly container: BoxRenderable;

  focus(): void;

  init(): Promise<void>;

  cycleFocus(): void;

  cycleFocusBackward?(): void;

  getStatusLine?(): string;

  isInputFocused(): boolean;

  blurInput(): void;

  handleKeyPress(event: AppKeyEvent): boolean;
}

export interface TabDefinition {
  id: string;
  name: string;
  shortcutIndex: number;
  keyboardShortcuts: KeyboardShortcut[];
  create: (renderer: CliRenderer) => AppShellTab;
}
