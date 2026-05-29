import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  type KeyEvent,
  ScrollBoxRenderable,
  TextRenderable,
} from '@opentui/core';
import { getErrorMessage } from '../../core/errors.js';
import type { AppKeyEvent } from '../../core/input.js';
import type { DbRow } from '../../core/types.js';
import { ansiToStyledText, formatTable } from '../../shared/utils/formatters.js';
import { Theme } from '../../shared/utils/theme.js';
import { loadSchemaCatalog, runSandboxQuery } from './queries.js';
import { SchemaBrowser } from './schemaBrowser.js';

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

export class SqlSandboxTab {
  readonly id = 'sql-sandbox';
  readonly name = 'SQL Sandbox';
  readonly container: BoxRenderable;

  // UI Panels
  private readonly leftPanel: BoxRenderable;
  private readonly rightColumn: BoxRenderable;
  private readonly inputPanel: BoxRenderable;
  private readonly resultsPanel: BoxRenderable;

  // UI Widgets
  private readonly schemaFilterInput: InputRenderable;
  private readonly schemaScroll: ScrollBoxRenderable;
  private readonly schemaText: TextRenderable;
  private readonly sqlInput: InputRenderable;
  private readonly autocompleteText: TextRenderable;
  private readonly resultsScroll: ScrollBoxRenderable;
  private readonly resultsText: TextRenderable;

  // Controllers
  private readonly schemaBrowser: SchemaBrowser;

  // State
  private tables: string[] = [];
  private tableColumns: Map<string, { name: string; type: string }[]> = new Map();

  private currentQuery = 'SELECT * FROM dim_team LIMIT 10;';
  private queryResult: DbRow[] = [];
  private executionTimeMs = 0;
  private rowsReturned = 0;
  private errorMessage = '';
  private autocompleteSuggestions: string[] = [];
  private selectedSuggestIdx = 0;

  // Focus Management
  private focusIndex = 1;
  private schemaFocusTarget: 'filter' | 'tree' = 'filter';
  private focusablePanels: BoxRenderable[] = [];

  constructor(renderer: CliRenderer) {
    this.container = new BoxRenderable(renderer, {
      id: 'sql-sandbox-container',
      width: '100%',
      height: '100%',
      flexDirection: 'row',
      gap: Theme.gap,
      backgroundColor: Theme.background,
    });

    this.leftPanel = new BoxRenderable(renderer, {
      id: 'sandbox-schema-panel',
      width: '25%',
      height: '100%',
      border: true,
      borderStyle: Theme.borderStyle,
      borderColor: Theme.borderNormal,
      focusable: true,
      focusedBorderColor: Theme.borderFocused,
      title: 'Database Schema',
      titleAlignment: Theme.titleAlignment,
      flexDirection: 'column',
    });

    this.schemaFilterInput = new InputRenderable(renderer, {
      id: 'sandbox-schema-filter-input',
      width: '100%',
      placeholder: 'Type to filter...',
      backgroundColor: '#222530',
    });

    this.schemaScroll = new ScrollBoxRenderable(renderer, {
      id: 'sandbox-schema-scroll',
      width: '100%',
      height: '100%',
      viewportCulling: true,
    });

    this.schemaText = new TextRenderable(renderer, {
      id: 'sandbox-schema-text',
      content: 'Loading tables...',
      wrapMode: 'none',
    });

    this.schemaScroll.add(this.schemaText);
    this.leftPanel.add(this.schemaFilterInput);
    this.leftPanel.add(this.schemaScroll);

    this.schemaBrowser = new SchemaBrowser({
      schemaScroll: this.schemaScroll,
      schemaText: this.schemaText,
    });

    this.rightColumn = new BoxRenderable(renderer, {
      id: 'sandbox-right-column',
      width: '75%',
      height: '100%',
      flexDirection: 'column',
    });

    this.inputPanel = new BoxRenderable(renderer, {
      id: 'sandbox-input-panel',
      width: '100%',
      height: '30%',
      border: true,
      borderStyle: Theme.borderStyle,
      borderColor: Theme.borderNormal,
      focusable: true,
      focusedBorderColor: Theme.borderFocused,
      title: 'SQL Input (Ctrl+R / Ctrl+E Execute)',
      titleAlignment: Theme.titleAlignment,
    });

    this.sqlInput = new InputRenderable(renderer, {
      id: 'sandbox-sql-input',
      width: '100%',
      placeholder: 'Enter SQL query...',
      backgroundColor: '#222530',
    });
    this.sqlInput.value = this.currentQuery;

    this.autocompleteText = new TextRenderable(renderer, {
      id: 'sandbox-autocomplete-text',
      content: '',
      wrapMode: 'none',
    });

    const sqlInstructions = new TextRenderable(renderer, {
      id: 'sandbox-sql-instructions',
      content:
        '\nTip: Enter any standard DuckDB SQL statement.\nKeys: [Ctrl+R] or [Ctrl+E] Run, [Enter] Execute/Auto-paste table schema.',
    });

    this.inputPanel.add(this.sqlInput);
    this.inputPanel.add(this.autocompleteText);
    this.inputPanel.add(sqlInstructions);

    this.resultsPanel = new BoxRenderable(renderer, {
      id: 'sandbox-results-panel',
      width: '100%',
      height: '70%',
      border: true,
      borderStyle: Theme.borderStyle,
      borderColor: Theme.borderNormal,
      focusable: true,
      focusedBorderColor: Theme.borderFocused,
      title: 'Query Results',
      titleAlignment: Theme.titleAlignment,
    });

    this.resultsScroll = new ScrollBoxRenderable(renderer, {
      id: 'sandbox-results-scroll',
      width: '100%',
      height: '100%',
      viewportCulling: true,
    });

    this.resultsText = new TextRenderable(renderer, {
      id: 'sandbox-results-text',
      content: 'No query has been executed yet.',
      wrapMode: 'none',
    });

    this.resultsScroll.add(this.resultsText);
    this.resultsPanel.add(this.resultsScroll);

    this.rightColumn.add(this.inputPanel);
    this.rightColumn.add(this.resultsPanel);

    this.container.add(this.leftPanel);
    this.container.add(this.rightColumn);

    this.focusablePanels = [this.leftPanel, this.inputPanel, this.resultsPanel];

    this.schemaFilterInput.on('input', () => {
      this.schemaBrowser.setFilter(this.schemaFilterInput.value);
      this.schemaBrowser.rebuild().then(() => {
        this.schemaBrowser.render();
        this.container.requestRender();
      });
    });

    this.sqlInput.on('input', () => {
      this.currentQuery = this.sqlInput.value;
      this.updateAutocomplete();
    });

    this.sqlInput.on('enter', () => {
      this.runQuery();
    });
  }

  async init() {
    try {
      const catalog = await loadSchemaCatalog();
      this.tables = catalog.tables;
      this.tableColumns = catalog.tableColumns;
      this.schemaBrowser.loadData(this.tables, this.tableColumns);
      await this.schemaBrowser.rebuild();
      this.schemaBrowser.render();
      this.container.requestRender();
    } catch (e: unknown) {
      this.schemaText.content = ansiToStyledText(`Error loading schema:\n${getErrorMessage(e)}`);
      this.container.requestRender();
    }
  }

  focus() {
    this.schemaFilterInput.blur();
    this.schemaScroll.blur();
    this.sqlInput.blur();
    this.resultsScroll.blur();

    this.focusablePanels.forEach((panel, idx) => {
      if (idx === this.focusIndex) {
        panel.focus();
      } else {
        panel.blur();
      }
    });

    if (this.focusIndex === 0) {
      if (this.schemaFocusTarget === 'filter') {
        this.schemaFilterInput.focus();
      } else {
        this.schemaScroll.focus();
      }
    } else if (this.focusIndex === 1) {
      this.sqlInput.focus();
    } else {
      this.resultsScroll.focus();
    }

    this.container.requestRender();
  }

  cycleFocus() {
    this.focusIndex = (this.focusIndex + 1) % this.focusablePanels.length;
    if (this.focusIndex === 0) {
      this.schemaFocusTarget = 'filter';
    }
    this.focus();
  }

  cycleFocusBackward(): void {
    this.focusIndex =
      (this.focusIndex - 1 + this.focusablePanels.length) % this.focusablePanels.length;
    if (this.focusIndex === 0) {
      this.schemaFocusTarget = 'filter';
    }
    this.focus();
  }

  getStatusLine(): string {
    const panelNames = ['Schema', 'SQL Input', 'Results'];
    const parts: string[] = [`Focus: ${panelNames[this.focusIndex]}`];

    const node = this.schemaBrowser.getSelectedNode();
    if (node?.type === 'table') {
      parts.push(`Table: ${node.name}`);
    } else if (node?.type === 'column' && node.tableName) {
      parts.push(`Column: ${node.tableName}.${node.name}`);
    }

    if (this.errorMessage) {
      parts.push(`Error: ${this.errorMessage}`);
    } else if (this.executionTimeMs > 0 || this.rowsReturned > 0) {
      parts.push(`Rows: ${this.rowsReturned}`);
    }

    return parts.join(' | ');
  }

  // Test-only accessors for schema browser state
  getSchemaNodes() {
    return this.schemaBrowser.getNodes();
  }

  getSelectedSchemaIdx() {
    return this.schemaBrowser.getSelectedIndex();
  }

  getExpandedTables() {
    const nodes = this.schemaBrowser.getNodes();
    const expanded = new Set<string>();
    for (const node of nodes) {
      if (node.type === 'table' && this.schemaBrowser.isExpanded(node.name)) {
        expanded.add(node.name);
      }
    }
    return expanded;
  }

  async setSchemaFilterQuery(query: string) {
    this.schemaBrowser.setFilter(query);
    await this.schemaBrowser.rebuild();
    this.schemaBrowser.render();
  }

  async rebuildSchema() {
    await this.schemaBrowser.rebuild();
    this.schemaBrowser.render();
  }

  isInputFocused(): boolean {
    return this.schemaFilterInput.focused || this.sqlInput.focused;
  }

  blurInput() {
    if (this.sqlInput.focused) {
      this.sqlInput.blur();
      this.focusIndex = 0;
      this.schemaFocusTarget = 'tree';
      this.focus();
    } else if (this.schemaFilterInput.focused) {
      this.schemaFilterInput.blur();
      this.focusIndex = 1;
      this.schemaFocusTarget = 'filter';
      this.focus();
    }
  }

  handleKeyPress(event: AppKeyEvent): boolean {
    if (event.ctrl && (event.name === 'r' || event.name === 'e')) {
      this.runQuery();
      return true;
    }

    if (this.focusIndex === 0) {
      if (event.name === 'up') {
        return this.schemaBrowser.moveUp();
      }
      if (event.name === 'down') {
        return this.schemaBrowser.moveDown();
      }
      if (event.name === 'return' || event.name === 'enter') {
        this.toggleOrInsertSchemaNode();
        return true;
      }
      if (event.name === 'tab') {
        if (event.shift) {
          this.cycleFocusBackward();
        } else {
          this.cycleFocus();
        }
        return true;
      }
    } else if (this.focusIndex === 1) {
      if (event.name === 'tab') {
        if (this.autocompleteSuggestions.length > 0 && !event.shift) {
          this.acceptAutocomplete();
          return true;
        } else {
          if (event.shift) {
            this.cycleFocusBackward();
          } else {
            this.cycleFocus();
          }
          return true;
        }
      }
      if (this.autocompleteSuggestions.length > 0) {
        if (event.name === 'up') {
          this.selectedSuggestIdx =
            (this.selectedSuggestIdx - 1 + this.autocompleteSuggestions.length) %
            this.autocompleteSuggestions.length;
          this.updateAutocomplete();
          return true;
        }
        if (event.name === 'down') {
          this.selectedSuggestIdx =
            (this.selectedSuggestIdx + 1) % this.autocompleteSuggestions.length;
          this.updateAutocomplete();
          return true;
        }
      }
    } else if (this.focusIndex === 2) {
      return this.resultsScroll.handleKeyPress(event as KeyEvent);
    }
    return false;
  }

  private async toggleOrInsertSchemaNode() {
    const node = this.schemaBrowser.getSelectedNode();
    if (!node) return;

    if (node.type === 'table') {
      this.schemaBrowser.toggleTable(node.name);
      await this.schemaBrowser.rebuild();
      this.schemaBrowser.render();
      this.container.requestRender();
    } else if (node.type === 'column') {
      const textToInsert = node.name;
      const curVal = this.sqlInput.value;
      this.sqlInput.value = `${curVal} ${textToInsert}`;
      this.currentQuery = this.sqlInput.value;
      this.updateAutocomplete();

      this.focusIndex = 1;
      this.focus();
    }
  }

  private getAutocompleteSuggestions(): string[] {
    const queryStr = this.currentQuery || '';
    const words = queryStr.split(/[\s,()[\]{}";]+/);
    const lastWord = words[words.length - 1] || '';
    if (!lastWord) {
      return [];
    }

    const lastWordLower = lastWord.toLowerCase();

    const candidates: string[] = [...SQL_KEYWORDS];
    for (const table of this.tables) {
      if (!candidates.includes(table)) {
        candidates.push(table);
      }
      const cols = this.tableColumns.get(table) || [];
      for (const col of cols) {
        if (!candidates.includes(col.name)) {
          candidates.push(col.name);
        }
      }
    }

    const startsWithMatches = candidates.filter(
      (c) => c.toLowerCase().startsWith(lastWordLower) && c.toLowerCase() !== lastWordLower,
    );
    const containsMatches = candidates.filter(
      (c) =>
        !c.toLowerCase().startsWith(lastWordLower) &&
        c.toLowerCase().includes(lastWordLower) &&
        c.toLowerCase() !== lastWordLower,
    );

    return [...startsWithMatches, ...containsMatches];
  }

  private updateAutocomplete() {
    this.autocompleteSuggestions = this.getAutocompleteSuggestions();

    if (this.selectedSuggestIdx >= this.autocompleteSuggestions.length) {
      this.selectedSuggestIdx = 0;
    }

    if (this.autocompleteSuggestions.length === 0) {
      this.autocompleteText.content = '';
    } else {
      const suggestionLines = this.autocompleteSuggestions.map((s, idx) => {
        const isSelected = idx === this.selectedSuggestIdx;
        if (isSelected) {
          return `\x1b[1;37;45m ${s} \x1b[0m`;
        }
        return `\x1b[90m${s}\x1b[0m`;
      });
      this.autocompleteText.content = ansiToStyledText(
        `Suggestions: ${suggestionLines.join('  ')}`,
      );
    }
    this.container.requestRender();
  }

  private acceptAutocomplete() {
    if (this.autocompleteSuggestions.length === 0) return;
    const selected = this.autocompleteSuggestions[this.selectedSuggestIdx];

    const val = this.sqlInput.value;
    const lastWordMatch = val.match(/([\s,()[\]{}";]+)?([^\s,()[\]{}";]+)$/);
    if (lastWordMatch) {
      const prefix = lastWordMatch[1] || '';
      const newVal = `${val.slice(0, val.length - lastWordMatch[0].length) + prefix + selected} `;
      this.sqlInput.value = newVal;
      this.currentQuery = newVal;
      this.selectedSuggestIdx = 0;
      this.updateAutocomplete();
    }
  }

  private async runQuery() {
    const sql = this.currentQuery.trim();
    if (!sql) return;

    this.resultsText.content = ansiToStyledText('Executing query against 1.5GB database...');
    this.errorMessage = '';
    this.container.requestRender();

    const start = performance.now();
    try {
      this.queryResult = await runSandboxQuery(sql);
      this.executionTimeMs = performance.now() - start;
      this.rowsReturned = this.queryResult.length;

      this.renderResults();
    } catch (e: unknown) {
      this.errorMessage = getErrorMessage(e);
      this.queryResult = [];
      this.rowsReturned = 0;
      this.executionTimeMs = performance.now() - start;

      this.resultsText.content = ansiToStyledText(
        `\x1b[1;31mSQL Error:\x1b[0m\n${this.errorMessage}\n\nExecution Time: ${this.executionTimeMs.toFixed(1)}ms`,
      );
      this.container.requestRender();
    }
  }

  private renderResults() {
    if (this.queryResult.length === 0) {
      this.resultsText.content = ansiToStyledText(
        `Statement executed successfully.\nReturned 0 rows.\n\nExecution Time: ${this.executionTimeMs.toFixed(1)}ms`,
      );
      this.container.requestRender();
      return;
    }

    const firstRow = this.queryResult[0];
    const headers = Object.keys(firstRow);

    const tableLines = formatTable(headers, this.queryResult, { maxRows: 100 });

    const summaryHeader = `\x1b[1;32mQuery Succeeded!\x1b[0m Returned \x1b[1m${this.rowsReturned}\x1b[0m rows in \x1b[1m${this.executionTimeMs.toFixed(1)}ms\x1b[0m (showing max 100 rows)\n\n`;

    this.resultsText.content = ansiToStyledText(summaryHeader + tableLines.join('\n'));

    this.resultsScroll.scrollTop = 0;
    this.resultsScroll.scrollLeft = 0;

    this.container.requestRender();
  }
}
