import { BoxRenderable, type CliRenderer, KeyEvent, TextRenderable } from '@opentui/core';
import { GameCenterTab } from './tabs/gameCenter.js';
import { SqlSandboxTab } from './tabs/sqlSandbox.js';
import { TimeMachineTab } from './tabs/timeMachine.js';
import { ansiToStyledText } from './utils/formatters.js';
import { buildHelpLines } from './utils/keyboardHelp.js';
import { Theme } from './utils/theme.js';

/** Compact global shortcut hint shown in the footer. */
const FOOTER_SHORTCUTS_HINT = 'Keys: F1-3/1-3 Tab Shift+Tab ? | Esc quit';

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

  handleKeyPress(event: KeyEvent): boolean;
}

export interface AppShellHandlers {
  onShutdown?: () => void | Promise<void>;
}

export interface AppShell {
  rootBox: BoxRenderable;

  workspaceBox: BoxRenderable;

  tabBarText: TextRenderable;

  footerLeftText: TextRenderable;

  footerCenterText: TextRenderable;

  tabs: AppShellTab[];

  activeTabIdx: number;

  switchTab: (tabIdx: number) => void;

  updateTabBarHeader: () => void;

  attachKeyHandlers: (handlers?: AppShellHandlers) => void;

  routeKeyPress: (event: KeyEvent) => void;

  initTabs: () => Promise<void>;

  setStatusLine: (text: string) => void;

  toggleHelp: () => void;
}

/** Sets a transient status message on the app shell footer (for tab callbacks). */

export function updateAppStatus(shell: AppShell, message: string): void {
  shell.setStatusLine(message);
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

  const headerBox = new BoxRenderable(renderer, {
    id: 'header-box',

    width: '100%',

    height: 3,

    border: ['top', 'bottom'],

    borderColor: Theme.borderNormal,

    backgroundColor: '#16161e',

    justifyContent: 'center',

    alignItems: 'center',
  });

  const tabBarText = new TextRenderable(renderer, {
    id: 'tab-bar-text',

    content: '',
  });

  headerBox.add(tabBarText);

  rootBox.add(headerBox);

  const workspaceBox = new BoxRenderable(renderer, {
    id: 'workspace-box',

    width: '100%',

    flexGrow: 1,

    flexDirection: 'column',
  });

  rootBox.add(workspaceBox);

  const helpOverlay = new BoxRenderable(renderer, {
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

  helpOverlay.add(helpText);

  workspaceBox.add(helpOverlay);

  const footerBox = new BoxRenderable(renderer, {
    id: 'footer-box',

    width: '100%',

    height: 1,

    backgroundColor: '#16161e',

    justifyContent: 'space-between',

    alignItems: 'center',

    paddingX: 1,

    flexGrow: 0,
  });

  const footerLeftText = new TextRenderable(renderer, {
    id: 'footer-left-text',

    content: '[BBallGenius] Terminal Hub | DuckDB: nba.duckdb (1.5GB)',
  });

  const footerCenterText = new TextRenderable(renderer, {
    id: 'footer-center-text',

    content: '',
  });

  const footerRightText = new TextRenderable(renderer, {
    id: 'footer-right-text',

    content: FOOTER_SHORTCUTS_HINT,
  });

  footerBox.add(footerLeftText);

  footerBox.add(footerCenterText);

  footerBox.add(footerRightText);

  rootBox.add(footerBox);

  const tabs: AppShellTab[] = [
    new GameCenterTab(renderer),

    new TimeMachineTab(renderer),

    new SqlSandboxTab(renderer),
  ];

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

    if (tabLine) {
      parts.push(tabLine);
    }

    if (transientStatus) {
      parts.push(transientStatus);
    }

    if (parts.length === 0) {
      footerCenterText.content = `Tab: ${tab.name}`;
    } else {
      footerCenterText.content = parts.join(' | ');
    }
  };

  const setHelpVisible = (visible: boolean) => {
    helpVisible = visible;

    helpOverlay.visible = visible;

    tabs.forEach((tab, idx) => {
      tab.container.visible = !visible && idx === activeTabIdx;
    });

    if (!visible) {
      tabs[activeTabIdx].focus();
    }

    renderer.requestRender();
  };

  const toggleHelp = () => {
    setHelpVisible(!helpVisible);
  };

  const setStatusLine = (text: string) => {
    transientStatus = text;

    refreshFooterStatus();

    renderer.requestRender();
  };

  const updateTabBarHeader = () => {
    const tabHeaders = tabs.map((tab, idx) => {
      const shortcut = `[F${idx + 1}/${idx + 1}]`;

      const isSelected = idx === activeTabIdx;

      if (isSelected) {
        return ` \x1b[1;37;45m ${shortcut} ${tab.name} \x1b[0m `;
      }

      return ` \x1b[90m${shortcut} ${tab.name}\x1b[0m `;
    });

    tabBarText.content = ansiToStyledText(tabHeaders.join('  \x1b[38;2;56;62;90m│\x1b[0m  '));
  };

  const switchTab = (tabIdx: number) => {
    if (tabIdx < 0 || tabIdx >= tabs.length) {
      return;
    }

    activeTabIdx = tabIdx;

    tabs.forEach((tab, idx) => {
      tab.container.visible = !helpVisible && idx === activeTabIdx;
    });

    updateTabBarHeader();

    refreshFooterStatus();

    tabs[activeTabIdx].focus();

    renderer.requestRender();
  };

  const initTabs = async () => {
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

    (renderer.keyInput as any).on('keypress', routeKeyPress);
  };

  refreshFooterStatus();

  return {
    rootBox,

    workspaceBox,

    tabBarText,

    footerLeftText,

    footerCenterText,

    tabs,

    get activeTabIdx() {
      return activeTabIdx;
    },

    switchTab,

    updateTabBarHeader,

    attachKeyHandlers,

    routeKeyPress,

    initTabs,

    setStatusLine,

    toggleHelp,
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

  const _switchTabByDigit = (digit: number) => {
    const tabIdx = digit - 1;

    if (tabIdx >= 0 && tabIdx < deps.tabs.length) {
      deps.switchTab(tabIdx);

      deps.refreshFooterStatus();
    }
  };

  return (event: KeyEvent) => {
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

        return;
      }

      return;
    }

    if (event.name === 'f1' || event.name === '1') {
      deps.switchTab(0);

      event.stopPropagation();

      event.preventDefault();

      return;
    }

    if (event.name === 'f2' || event.name === '2') {
      deps.switchTab(1);

      event.stopPropagation();

      event.preventDefault();

      return;
    }

    if (event.name === 'f3' || event.name === '3') {
      deps.switchTab(2);

      event.stopPropagation();

      event.preventDefault();

      return;
    }

    if (event.name === 'tab') {
      const activeTab = deps.tabs[deps.getActiveTabIdx()];

      if (activeTab.isInputFocused()) {
        return;
      }

      if (event.shift) {
        activeTab.cycleFocusBackward?.();
      } else {
        activeTab.cycleFocus();
      }

      event.stopPropagation();

      event.preventDefault();

      deps.refreshFooterStatus();

      return;
    }

    if (event.name === 'escape') {
      const activeTab = deps.tabs[deps.getActiveTabIdx()];

      if (activeTab.isInputFocused()) {
        activeTab.blurInput();

        deps.refreshFooterStatus();

        event.stopPropagation();

        event.preventDefault();

        return;
      }

      shutdown();

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

/** Builds a KeyEvent for unit tests (mockInput does not reliably emit escape). */

export function makeTestKeyEvent(
  name: string,
  options: { shift?: boolean; ctrl?: boolean } = {},
): KeyEvent {
  return new KeyEvent({
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
  });
}
