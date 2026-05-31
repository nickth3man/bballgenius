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

export function resetBorderColors(panels: BoxRenderable[]): void {
  for (const panel of panels) {
    panel.borderColor = Theme.borderNormal;
  }
}
