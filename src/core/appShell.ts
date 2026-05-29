import {
  BoxRenderable,
  type CliRenderer,
  KeyEvent,
  type TabSelectOption,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TextRenderable,
} from '@opentui/core';
import { ansiToStyledText } from '../shared/utils/formatters.js';
import { buildHelpLines } from '../shared/utils/keyboardHelp.js';
import { Theme } from '../shared/utils/theme.js';
import { buildFooterShortcutsHint, getTabById, TAB_REGISTRY } from '../tabs/registry.js';
import type { AppShellTab } from '../tabs/types.js';
import { type AppKeyEvent, toAppKeyEvent } from './input.js';

export { getTabById } from '../tabs/registry.js';
export type { AppShellTab } from '../tabs/types.js';

const FOOTER_SHORTCUTS_HINT = buildFooterShortcutsHint(TAB_REGISTRY);

export interface AppShellHandlers {
  onShutdown?: () => void | Promise<void>;
}

export interface AppShell {
  rootBox: BoxRenderable;
  workspaceBox: BoxRenderable;
  tabSelect: TabSelectRenderable;
  footerLeftText: TextRenderable;
  footerCenterText: TextRenderable;
  tabs: AppShellTab[];
  activeTabIdx: number;
  switchTab: (tabIdx: number) => void;
  syncTabSelectOptions: () => void;
  attachKeyHandlers: (handlers?: AppShellHandlers) => void;
  routeKeyPress: (event: AppKeyEvent) => void;
  initTabs: () => Promise<void>;
  setStatusLine: (text: string) => void;
  toggleHelp: () => void;
  getTabById: (id: string) => AppShellTab | undefined;
}

export function updateAppStatus(shell: AppShell, message: string): void {
  shell.setStatusLine(message);
}

function createHeaderBox(renderer: CliRenderer, tabSelect: TabSelectRenderable): BoxRenderable {
  const headerBox = new BoxRenderable(renderer, {
    id: 'header-box',
    width: '100%',
    height: 4,
    border: ['bottom'],
    borderColor: Theme.borderNormal,
    backgroundColor: Theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
  });
  headerBox.add(tabSelect);
  return headerBox;
}

function createHelpOverlay(renderer: CliRenderer): BoxRenderable {
  const overlay = new BoxRenderable(renderer, {
    id: 'help-overlay',
    width: '100%',
    height: '100%',
    visible: false,
    border: true,
    borderStyle: Theme.borderStyle,
    borderColor: Theme.secondary,
    backgroundColor: Theme.background,
    paddingX: 2,
    paddingY: 1,
  });

  const helpText = new TextRenderable(renderer, {
    id: 'help-text',
    content: ansiToStyledText(buildHelpLines().join('\n')),
    wrapMode: 'word',
  });

  overlay.add(helpText);
  return overlay;
}

function createFooterBox(
  renderer: CliRenderer,
  footerLeftText: TextRenderable,
  footerCenterText: TextRenderable,
  footerRightText: TextRenderable,
): BoxRenderable {
  const footerBox = new BoxRenderable(renderer, {
    id: 'footer-box',
    width: '100%',
    height: 1,
    backgroundColor: Theme.surface,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingX: 1,
    flexGrow: 0,
  });

  footerBox.add(footerLeftText);
  footerBox.add(footerCenterText);
  footerBox.add(footerRightText);
  return footerBox;
}

/**
 * Builds the BBallGenius hub layout (header, workspace, footer, tabs) for production or tests.
 */
export function createAppShell(renderer: CliRenderer): AppShell {
  const rootBox = new BoxRenderable(renderer, {
    id: 'root-container',
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: Theme.background,
  });

  renderer.root.add(rootBox);

  const tabSelect = new TabSelectRenderable(renderer, {
    id: 'tab-select',
    width: '100%',
    height: 4,
    options: [],
    tabWidth: 26,
    selectedBackgroundColor: Theme.secondary,
    selectedTextColor: '#ffffff',
    textColor: '#888888',
    backgroundColor: Theme.surface,
    showUnderline: false,
    showDescription: false,
  });

  const headerBox = createHeaderBox(renderer, tabSelect);
  rootBox.add(headerBox);

  const workspaceBox = new BoxRenderable(renderer, {
    id: 'workspace-box',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
  });

  rootBox.add(workspaceBox);

  const helpOverlay = createHelpOverlay(renderer);
  workspaceBox.add(helpOverlay);

  const footerLeftText = new TextRenderable(renderer, {
    id: 'footer-left-text',
    content: 'BBallGenius Hub | nba.duckdb',
  });

  const footerCenterText = new TextRenderable(renderer, {
    id: 'footer-center-text',
    content: '',
  });

  const footerRightText = new TextRenderable(renderer, {
    id: 'footer-right-text',
    content: FOOTER_SHORTCUTS_HINT,
  });

  const footerBox = createFooterBox(renderer, footerLeftText, footerCenterText, footerRightText);
  rootBox.add(footerBox);

  const tabs: AppShellTab[] = TAB_REGISTRY.map((definition) => definition.create(renderer));

  let activeTabIdx = 0;
  let helpVisible = false;
  let transientStatus = '';

  tabs.forEach((tab) => {
    workspaceBox.add(tab.container);
  });

  const refreshFooterStatus = () => {
    const tab = tabs[activeTabIdx];
    const tabLine = tab.getStatusLine?.() ?? '';
    const parts: string[] = [];

    if (tabLine) parts.push(tabLine);
    if (transientStatus) parts.push(transientStatus);

    footerCenterText.content =
      parts.length === 0 ? `Tab: ${tab.name}` : `[${tab.name}] ${parts.join(' \xb7 ')}`;
  };

  const setHelpVisible = (visible: boolean) => {
    helpVisible = visible;
    helpOverlay.visible = visible;

    tabs.forEach((tab, idx) => {
      tab.container.visible = !visible && idx === activeTabIdx;
    });

    if (!visible) tabs[activeTabIdx].focus();
    renderer.requestRender();
  };

  const toggleHelp = () => setHelpVisible(!helpVisible);

  const setStatusLine = (text: string) => {
    transientStatus = text;
    refreshFooterStatus();
    renderer.requestRender();
  };

  const syncTabSelectOptions = () => {
    const options: TabSelectOption[] = tabs.map((tab, idx) => {
      const shortcutIndex = TAB_REGISTRY[idx]?.shortcutIndex ?? idx + 1;
      return {
        name: tab.name,
        description: `F${shortcutIndex} / ${shortcutIndex}`,
        value: idx,
      };
    });
    tabSelect.setOptions(options);
    tabSelect.setSelectedIndex(activeTabIdx);
  };

  const switchTab = (tabIdx: number) => {
    if (tabIdx < 0 || tabIdx >= tabs.length) return;

    activeTabIdx = tabIdx;

    tabs.forEach((tab, idx) => {
      tab.container.visible = !helpVisible && idx === activeTabIdx;
    });

    syncTabSelectOptions();
    refreshFooterStatus();
    tabs[activeTabIdx].focus();
    renderer.requestRender();
  };

  tabSelect.on(TabSelectRenderableEvents.SELECTION_CHANGED, (index: number) => {
    if (index === activeTabIdx) return;
    switchTab(index);
    refreshFooterStatus();
  });

  const initTabs = async () => {
    syncTabSelectOptions();
    await Promise.all(tabs.map((t) => t.init()));
    switchTab(activeTabIdx);
  };

  const handlersRef = { current: {} as AppShellHandlers };

  const routeKeyPress = createAppShellKeyRouter(
    {
      tabs,
      switchTab,
      getActiveTabIdx: () => activeTabIdx,
      renderer,
      isHelpVisible: () => helpVisible,
      toggleHelp,
      refreshFooterStatus,
    },
    () => handlersRef.current,
  );

  const attachKeyHandlers = (handlers: AppShellHandlers = {}) => {
    handlersRef.current = handlers;
    renderer.keyInput.on('keypress', (event: KeyEvent) => routeKeyPress(toAppKeyEvent(event)));
  };

  refreshFooterStatus();

  return {
    rootBox,
    workspaceBox,
    tabSelect,
    footerLeftText,
    footerCenterText,
    tabs,
    get activeTabIdx() {
      return activeTabIdx;
    },
    switchTab,
    syncTabSelectOptions,
    attachKeyHandlers,
    routeKeyPress,
    initTabs,
    setStatusLine,
    toggleHelp,
    getTabById: (id: string) => getTabById(tabs, id),
  };
}

export interface AppShellKeyRouterDeps {
  tabs: AppShellTab[];
  switchTab: (tabIdx: number) => void;
  getActiveTabIdx: () => number;
  renderer: CliRenderer;
  isHelpVisible: () => boolean;
  toggleHelp: () => void;
  refreshFooterStatus: () => void;
}

function switchTabByDigit(deps: AppShellKeyRouterDeps, digit: number): void {
  const tabIdx = digit - 1;
  if (tabIdx >= 0 && tabIdx < deps.tabs.length) {
    deps.switchTab(tabIdx);
    deps.refreshFooterStatus();
  }
}

function handleFnKey(
  deps: AppShellKeyRouterDeps,
  event: AppKeyEvent,
  match: RegExpExecArray,
): boolean {
  switchTabByDigit(deps, Number(match[1]));
  event.stopPropagation();
  event.preventDefault();
  return true;
}

function handleDigitKey(
  deps: AppShellKeyRouterDeps,
  event: AppKeyEvent,
  match: RegExpExecArray,
): boolean {
  switchTabByDigit(deps, Number(match[1]));
  event.stopPropagation();
  event.preventDefault();
  return true;
}

function handleTabKey(deps: AppShellKeyRouterDeps, event: AppKeyEvent): boolean {
  const activeTab = deps.tabs[deps.getActiveTabIdx()];
  if (activeTab.isInputFocused()) return false;

  if (event.shift) {
    activeTab.cycleFocusBackward?.();
  } else {
    activeTab.cycleFocus();
  }

  event.stopPropagation();
  event.preventDefault();
  deps.refreshFooterStatus();
  return true;
}

function handleEscapeKey(
  deps: AppShellKeyRouterDeps,
  event: AppKeyEvent,
  getHandlers: () => AppShellHandlers,
): boolean {
  const activeTab = deps.tabs[deps.getActiveTabIdx()];

  if (activeTab.isInputFocused()) {
    activeTab.blurInput();
    deps.refreshFooterStatus();
    event.stopPropagation();
    event.preventDefault();
    return true;
  }

  // Esc with no input focused → shutdown
  const handlers = getHandlers();
  if (handlers.onShutdown) {
    handlers.onShutdown();
  } else {
    deps.renderer.destroy();
    process.exit(0);
  }
  return true;
}

/** Production key routing logic (shared with tests). */
export function createAppShellKeyRouter(
  deps: AppShellKeyRouterDeps,
  getHandlers: () => AppShellHandlers,
) {
  const shutdown = async () => {
    const handlers = getHandlers();
    if (handlers.onShutdown) {
      await handlers.onShutdown();
      return;
    }
    deps.renderer.destroy();
    process.exit(0);
  };

  return (event: AppKeyEvent) => {
    if (event.ctrl && event.name === 'c') {
      shutdown();
      return;
    }

    if (event.name === '?') {
      deps.toggleHelp();
      event.stopPropagation();
      event.preventDefault();
      return;
    }

    if (deps.isHelpVisible()) {
      if (event.name === 'escape') {
        deps.toggleHelp();
        event.stopPropagation();
        event.preventDefault();
      }
      return;
    }

    const fnMatch = /^f(\d+)$/.exec(event.name);
    if (fnMatch) {
      handleFnKey(deps, event, fnMatch);
      return;
    }

    const digitMatch = /^(\d+)$/.exec(event.name);
    if (digitMatch) {
      handleDigitKey(deps, event, digitMatch);
      return;
    }

    if (event.name === 'tab') {
      handleTabKey(deps, event);
      return;
    }

    if (event.name === 'escape') {
      handleEscapeKey(deps, event, getHandlers);
      return;
    }

    const handled = deps.tabs[deps.getActiveTabIdx()].handleKeyPress(event);
    if (handled) {
      event.stopPropagation();
      event.preventDefault();
      deps.renderer.requestRender();
    }
  };
}

/** Builds an app key event for unit tests (mockInput does not reliably emit escape). */
export function makeTestKeyEvent(
  name: string,
  options: { shift?: boolean; ctrl?: boolean } = {},
): AppKeyEvent {
  return toAppKeyEvent(
    new KeyEvent({
      name,
      ctrl: options.ctrl ?? false,
      meta: false,
      shift: options.shift ?? false,
      option: false,
      sequence: name,
      number: false,
      raw: name,
      eventType: 'press',
      source: 'raw',
    }),
  );
}
