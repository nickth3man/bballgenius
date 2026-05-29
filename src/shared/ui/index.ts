import {
  type BoxOptions,
  BoxRenderable,
  type CliRenderer,
  ScrollBoxRenderable,
  TextRenderable,
} from '@opentui/core';
import { Theme } from '../utils/theme.js';

export function createPanel(
  renderer: CliRenderer,
  opts: BoxOptions & { id: string; title?: string },
): BoxRenderable {
  return new BoxRenderable(renderer, {
    id: opts.id,
    width: opts.width ?? '100%',
    height: opts.height ?? '100%',
    border: opts.border ?? true,
    borderStyle: opts.borderStyle ?? Theme.borderStyle,
    borderColor: opts.borderColor ?? Theme.borderNormal,
    focusable: opts.focusable ?? true,
    focusedBorderColor: opts.focusedBorderColor ?? Theme.borderFocused,
    title: opts.title,
    titleAlignment: opts.titleAlignment ?? Theme.titleAlignment,
    paddingX: opts.paddingX ?? 1,
    flexDirection: opts.flexDirection,
    flexGrow: opts.flexGrow,
    gap: opts.gap,
    backgroundColor: opts.backgroundColor ?? Theme.background,
  });
}

export function createScrollPanel(
  renderer: CliRenderer,
  panelOpts: BoxOptions & { id: string; title?: string },
): { panel: BoxRenderable; scroll: ScrollBoxRenderable; text: TextRenderable } {
  const panel = createPanel(renderer, panelOpts);

  const scroll = new ScrollBoxRenderable(renderer, {
    id: `${panelOpts.id}-scroll`,
    width: '100%',
    height: '100%',
    viewportCulling: true,
  });

  const text = new TextRenderable(renderer, {
    id: `${panelOpts.id}-text`,
    content: panelOpts.title ? `Loading ${panelOpts.title.toLowerCase()}...` : '',
    wrapMode: 'none',
  });

  scroll.add(text);
  panel.add(scroll);

  return { panel, scroll, text };
}

export class FocusManager {
  private index = 0;
  readonly panels: BoxRenderable[];

  constructor(panels: BoxRenderable[], initialIndex = 0) {
    this.panels = panels;
    this.index = initialIndex;
  }

  get currentIndex(): number {
    return this.index;
  }

  get currentPanel(): BoxRenderable {
    return this.panels[this.index];
  }

  get count(): number {
    return this.panels.length;
  }

  next(): void {
    this.index = (this.index + 1) % this.panels.length;
  }

  prev(): void {
    this.index = (this.index - 1 + this.panels.length) % this.panels.length;
  }

  setIndex(idx: number): void {
    if (idx >= 0 && idx < this.panels.length) {
      this.index = idx;
    }
  }

  blurAll(): void {
    for (const panel of this.panels) {
      panel.blur();
    }
  }

  focusActive(): void {
    this.blurAll();
    this.currentPanel.focus();
  }

  focusPanel(idx: number): void {
    this.setIndex(idx);
    this.focusActive();
  }

  forEach(fn: (panel: BoxRenderable, idx: number) => void): void {
    this.panels.forEach(fn);
  }
}

export function scrollIntoView(
  scrollBox: ScrollBoxRenderable,
  selectedIdx: number,
  offset = 3,
): void {
  const visibleHeight = scrollBox.height || 20;
  const currentScroll = scrollBox.scrollTop;

  if (selectedIdx < currentScroll) {
    scrollBox.scrollTop = Math.max(0, selectedIdx);
  } else if (selectedIdx >= currentScroll + visibleHeight - offset) {
    scrollBox.scrollTop = Math.max(0, selectedIdx - visibleHeight + offset + 1);
  }
}

export function focusScroll(scrollBox: ScrollBoxRenderable): void {
  try {
    scrollBox.focus();
  } catch {
    // Some renderers may not support scroll focus; swallow silently
  }
}

export function resetBorderColors(panels: BoxRenderable[]): void {
  for (const panel of panels) {
    panel.borderColor = Theme.borderNormal;
  }
}
