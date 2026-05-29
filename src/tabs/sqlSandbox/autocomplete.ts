import { type CliRenderer, TextRenderable } from '@opentui/core';
import { ansiToStyledText } from '../../shared/utils/formatters.js';
import { ansiDim } from '../../shared/utils/theme.js';

const SQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'ORDER BY',
  'GROUP BY',
  'LIMIT',
  'AND',
  'OR',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'TABLE',
  'AS',
  'ON',
  'INNER',
  'LEFT',
  'RIGHT',
  'OUTER',
  'BY',
  'DESC',
  'ASC',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
];

export class AutocompleteController {
  private suggestions: string[] = [];
  private selectedIdx = 0;
  private readonly text: TextRenderable;
  private tables: string[] = [];
  private tableColumns: Map<string, { name: string; type: string }[]> = new Map();

  constructor(renderer: CliRenderer) {
    this.text = new TextRenderable(renderer, {
      id: 'sandbox-autocomplete-text',
      content: '',
      wrapMode: 'none',
    });
  }

  get renderable(): TextRenderable {
    return this.text;
  }

  get hasSuggestions(): boolean {
    return this.suggestions.length > 0;
  }

  get currentIndex(): number {
    return this.selectedIdx;
  }

  get currentSuggestion(): string | undefined {
    return this.suggestions[this.selectedIdx];
  }

  get allSuggestions(): readonly string[] {
    return this.suggestions;
  }

  loadSchema(tables: string[], tableColumns: Map<string, { name: string; type: string }[]>): void {
    this.tables = tables;
    this.tableColumns = tableColumns;
  }

  update(query: string, requestRender: () => void): void {
    this.suggestions = this.computeSuggestions(query);

    if (this.selectedIdx >= this.suggestions.length) {
      this.selectedIdx = 0;
    }

    if (this.suggestions.length === 0) {
      this.text.content = '';
    } else {
      const lines = this.suggestions.map((s, idx) => {
        if (idx === this.selectedIdx) {
          return `\x1b[1;37;45m ${s} \x1b[0m`;
        }
        return ansiDim(s);
      });
      this.text.content = ansiToStyledText(`Suggestions: ${lines.join('  ')}`);
    }

    requestRender();
  }

  moveUp(): void {
    this.selectedIdx = (this.selectedIdx - 1 + this.suggestions.length) % this.suggestions.length;
  }

  moveDown(): void {
    this.selectedIdx = (this.selectedIdx + 1) % this.suggestions.length;
  }

  reset(): void {
    this.selectedIdx = 0;
  }

  accept(currentValue: string): string {
    if (this.suggestions.length === 0) return currentValue;
    const selected = this.suggestions[this.selectedIdx];

    const match = currentValue.match(/([\s,()[\]{}";]+)?([^\s,()[\]{}";]+)$/);
    if (match) {
      const prefix = match[1] || '';
      return `${currentValue.slice(0, currentValue.length - match[0].length) + prefix + selected} `;
    }

    return currentValue;
  }

  private computeSuggestions(query: string): string[] {
    const words = query.split(/[\s,()[\]{}";]+/);
    const lastWord = words[words.length - 1] || '';
    if (!lastWord) return [];

    const lower = lastWord.toLowerCase();

    const candidates: string[] = [...SQL_KEYWORDS];
    for (const table of this.tables) {
      if (!candidates.includes(table)) candidates.push(table);
      const cols = this.tableColumns.get(table) || [];
      for (const col of cols) {
        if (!candidates.includes(col.name)) candidates.push(col.name);
      }
    }

    const startsWith = candidates.filter(
      (c) => c.toLowerCase().startsWith(lower) && c.toLowerCase() !== lower,
    );
    const contains = candidates.filter(
      (c) =>
        !c.toLowerCase().startsWith(lower) &&
        c.toLowerCase().includes(lower) &&
        c.toLowerCase() !== lower,
    );

    return [...startsWith, ...contains];
  }
}
