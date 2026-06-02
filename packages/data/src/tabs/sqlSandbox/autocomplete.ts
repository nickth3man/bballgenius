/**
 * SQL autocomplete: pure data helper. Renders are handled by the web UI.
 */
import { ansiDim } from '../../shared/theme.js';

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

export interface TableColumn {
  name: string;
  type: string;
}

export interface AutocompleteState {
  suggestions: string[];
  selectedIdx: number;
  hasSuggestions: boolean;
  /** ANSI-formatted line of suggestions for terminal output, or empty string. */
  formatted: string;
}

export class SqlAutocomplete {
  private suggestions: string[] = [];
  private selectedIdx = 0;
  private tables: string[] = [];
  private tableColumns: Map<string, TableColumn[]> = new Map();

  get currentIndex(): number {
    return this.selectedIdx;
  }

  get currentSuggestion(): string | undefined {
    return this.suggestions[this.selectedIdx];
  }

  get allSuggestions(): readonly string[] {
    return this.suggestions;
  }

  get state(): AutocompleteState {
    const hasSuggestions = this.suggestions.length > 0;
    const formatted = this.formatSuggestions();
    return {
      suggestions: this.suggestions,
      selectedIdx: this.selectedIdx,
      hasSuggestions,
      formatted,
    };
  }

  loadSchema(tables: string[], tableColumns: Map<string, TableColumn[]>): void {
    this.tables = tables;
    this.tableColumns = tableColumns;
  }

  update(query: string): AutocompleteState {
    this.suggestions = this.computeSuggestions(query);

    if (this.selectedIdx >= this.suggestions.length) {
      this.selectedIdx = 0;
    }

    return this.state;
  }

  moveUp(): void {
    if (this.suggestions.length === 0) return;
    this.selectedIdx = (this.selectedIdx - 1 + this.suggestions.length) % this.suggestions.length;
  }

  moveDown(): void {
    if (this.suggestions.length === 0) return;
    this.selectedIdx = (this.selectedIdx + 1) % this.suggestions.length;
  }

  reset(): void {
    this.selectedIdx = 0;
    this.suggestions = [];
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

  private formatSuggestions(): string {
    if (this.suggestions.length === 0) return '';
    const lines = this.suggestions.map((s, idx) => {
      if (idx === this.selectedIdx) {
        return `\x1b[1;37;45m ${s} \x1b[0m`;
      }
      return ansiDim(s);
    });
    return `Suggestions: ${lines.join('  ')}`;
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
