import type { BoxRenderable, ScrollBoxRenderable } from '@opentui/core';

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

/**
 * A single focusable pane: an outer {@link BoxRenderable} (whose border reflects
 * focus) bound to an optional inner element to activate (e.g. an input or scroll
 * box) plus status-line metadata.
 */
export interface FocusTarget {
  /** Outer panel whose border highlights when this target is active. */
  panel: BoxRenderable;
  /** Focus the inner input/scroll for this pane, if any. */
  activate?: () => void;
  /** Short label for the status line. */
  label?: string;
  /** Movement hint for the status line. */
  hint?: string;
}

/**
 * Generalizes {@link FocusManager} to bind each pane to an inner focus target
 * and status metadata. {@link focusActive} blurs every panel in the group, then
 * focuses the current panel and activates its inner element — mirroring the
 * hand-rolled blur-others/focus-current logic the tabs previously duplicated.
 *
 * Callers that need to blur inner elements across multiple groups (e.g. when
 * switching modes) should still blur those inputs explicitly before calling
 * {@link focusActive}; this group only owns its own panels' focus state.
 */
export class PaneFocusGroup {
  private idx: number;
  readonly targets: FocusTarget[];

  constructor(targets: FocusTarget[], initialIndex = 0) {
    this.targets = targets;
    this.idx = initialIndex;
  }

  get index(): number {
    return this.idx;
  }

  set index(value: number) {
    if (value >= 0 && value < this.targets.length) {
      this.idx = value;
    }
  }

  get currentTarget(): FocusTarget {
    return this.targets[this.idx];
  }

  get count(): number {
    return this.targets.length;
  }

  next(): void {
    this.idx = (this.idx + 1) % this.targets.length;
  }

  prev(): void {
    this.idx = (this.idx - 1 + this.targets.length) % this.targets.length;
  }

  forEachPanel(fn: (panel: BoxRenderable, idx: number) => void): void {
    this.targets.forEach((target, i) => {
      fn(target.panel, i);
    });
  }

  /** Blur all panels, then focus the current panel and activate its inner element. */
  focusActive(): void {
    for (const target of this.targets) {
      target.panel.blur();
    }
    const current = this.targets[this.idx];
    current.panel.focus();
    current.activate?.();
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
