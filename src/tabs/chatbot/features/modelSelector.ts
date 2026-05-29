import type { CliRenderer } from '@opentui/core';
import { BoxRenderable, InputRenderable, ScrollBoxRenderable, TextRenderable } from '@opentui/core';
import type { AppKeyEvent } from '../../../core/input.js';
import { fetchModels, getModel, type ModelInfo, setModel } from '../openrouter.js';
import { ansiToStyledText } from '../utils/ansi.js';
import { dimOrPlain, isNoColor, Theme } from '../utils/theme.js';

const PAGE_SIZE = 25;

export function formatModelRow(
  model: ModelInfo,
  index: number,
  selectedIdx: number,
  total: number,
  currentModel: string,
): string {
  const selected = index === selectedIdx;
  const isActive = model.id === currentModel;
  const selectedText = selected ? `> selected ${index + 1} of ${total}: ` : '  ';
  const activeText = isActive ? ' (current model)' : '';
  const idPart = isActive && !isNoColor() ? `\x1b[1;32m${model.id}\x1b[0m` : model.id;
  const sep = isNoColor() ? ' -- ' : '  \x1b[90m-\x1b[0m ';
  return `${selectedText}${idPart}${activeText}${sep}${dimOrPlain(model.name)}`;
}

export class ModelSelector {
  readonly overlay: BoxRenderable;

  private renderer: CliRenderer;
  private searchInput: InputRenderable;
  private listScroll: ScrollBoxRenderable;
  private listText: TextRenderable;
  private footerText: TextRenderable;
  private allModels: ModelInfo[] = [];
  private filtered: ModelInfo[] = [];
  private selectedIdx = 0;
  private onModelChanged: (() => void) | null = null;
  private onClose: (() => void) | null = null;

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;

    this.overlay = new BoxRenderable(renderer, {
      width: '100%',
      height: '100%',
      visible: false,
      flexDirection: 'column',
      backgroundColor: Theme.background,
    });

    const titleBox = new BoxRenderable(renderer, {
      width: '100%',
      height: 3,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#16161e',
      border: ['bottom'],
      borderColor: Theme.borderFocused,
    });

    const titleText = new TextRenderable(renderer, {
      content: ansiToStyledText('\x1b[1;37mModel Selector\x1b[0m'),
    });
    titleBox.add(titleText);

    this.searchInput = new InputRenderable(renderer, {
      width: '100%',
      placeholder: 'Type to filter models...',
      backgroundColor: '#222530',
    });

    this.listScroll = new ScrollBoxRenderable(renderer, {
      width: '100%',
      flexGrow: 1,
      stickyScroll: true,
    });

    this.listText = new TextRenderable(renderer, {
      content: ansiToStyledText(dimOrPlain('Loading models...')),
      wrapMode: 'word',
    });
    this.listScroll.add(this.listText);

    const footerBox = new BoxRenderable(renderer, {
      width: '100%',
      height: 1,
      backgroundColor: '#16161e',
    });

    this.footerText = new TextRenderable(renderer, {
      content:
        'Up/Down or j/k navigate | PgUp/PgDn jump | Home/End first/last | Enter select | Esc cancel',
    });
    footerBox.add(this.footerText);

    this.overlay.add(titleBox);
    this.overlay.add(this.searchInput);
    this.overlay.add(this.listScroll);
    this.overlay.add(footerBox);

    this.searchInput.on('input', () => {
      this.filterModels();
      this.selectedIdx = 0;
      this.renderList();
    });

    this.searchInput.on('enter', () => {
      this.selectCurrent();
    });
  }

  setCallbacks(onModelChanged: () => void, onClose: () => void): void {
    this.onModelChanged = onModelChanged;
    this.onClose = onClose;
  }

  async show(): Promise<void> {
    this.overlay.visible = true;
    this.searchInput.value = '';
    this.selectedIdx = 0;
    this.allModels = await fetchModels();
    this.filtered = [...this.allModels];
    this.renderList();
    this.renderer.requestRender();
    this.searchInput.focus();
  }

  hide(): void {
    this.overlay.visible = false;
    this.renderer.requestRender();
    this.onClose?.();
  }

  handleKeyPress(event: AppKeyEvent): boolean {
    if (event.name === 'escape') {
      this.hide();
      return true;
    }

    if (event.name === 'up' || event.name === 'k') {
      if (this.selectedIdx > 0) {
        this.selectedIdx--;
        this.renderList();
        this.scrollIntoView();
      }
      return true;
    }

    if (event.name === 'down' || event.name === 'j') {
      if (this.selectedIdx < this.filtered.length - 1) {
        this.selectedIdx++;
        this.renderList();
        this.scrollIntoView();
      }
      return true;
    }

    if (event.name === 'page_up' || (event.ctrl && event.name === 'u')) {
      this.selectedIdx = Math.max(0, this.selectedIdx - PAGE_SIZE);
      this.renderList();
      this.scrollIntoView();
      return true;
    }

    if (event.name === 'page_down' || (event.ctrl && event.name === 'd')) {
      this.selectedIdx = Math.min(this.filtered.length - 1, this.selectedIdx + PAGE_SIZE);
      this.renderList();
      this.scrollIntoView();
      return true;
    }

    if (event.name === 'home' || (event.ctrl && event.name === 'g')) {
      this.selectedIdx = 0;
      this.renderList();
      this.scrollIntoView();
      return true;
    }

    if (event.name === 'end' || (event.ctrl && event.name === 'e')) {
      this.selectedIdx = this.filtered.length - 1;
      this.renderList();
      this.scrollIntoView();
      return true;
    }

    return false;
  }

  private filterModels(): void {
    const query = this.searchInput.value.toLowerCase().trim();
    if (!query) {
      this.filtered = [...this.allModels];
      return;
    }
    this.filtered = this.allModels.filter(
      (m) => m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query),
    );
  }

  private scrollIntoView(): void {
    const visibleHeight = this.listScroll.height || 20;
    const currentScroll = this.listScroll.scrollTop;
    if (this.selectedIdx < currentScroll) {
      this.listScroll.scrollTop = Math.max(0, this.selectedIdx - 2);
    } else if (this.selectedIdx >= currentScroll + visibleHeight - 2) {
      this.listScroll.scrollTop = Math.max(0, this.selectedIdx - visibleHeight + 3);
    }
  }

  private renderList(): void {
    if (this.filtered.length === 0) {
      this.listText.content = ansiToStyledText(dimOrPlain('No models match your filter.'));
      this.renderer.requestRender();
      return;
    }

    const lines = this.filtered.map((m, i) =>
      formatModelRow(m, i, this.selectedIdx, this.filtered.length, getModel()),
    );
    this.listText.content = ansiToStyledText(lines.join('\n'));
    this.renderer.requestRender();
  }

  private selectCurrent(): void {
    if (this.filtered.length === 0 || this.selectedIdx < 0) return;
    const model = this.filtered[this.selectedIdx];
    if (!model) return;
    setModel(model.id);
    this.hide();
    this.onModelChanged?.();
  }
}
