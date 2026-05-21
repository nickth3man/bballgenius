import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  type KeyEvent,
  ScrollBoxRenderable,
  TextRenderable,
} from '@opentui/core';
import { getErrorMessage } from '../../core/errors.js';
import type { DbRow } from '../../core/types.js';
import { ansiToStyledText, formatTable } from '../../shared/utils/formatters.js';
import { Theme } from '../../shared/utils/theme.js';
import { loadSchemaCatalog, runSandboxQuery } from './queries.js';

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

interface SchemaNode {
  type: 'table' | 'column';
  name: string;
  tableName?: string; // If column, stores its parent table
  columnType?: string; // If column, stores its data type
}

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

  // State
  private tables: string[] = [];
  private expandedTables: Set<string> = new Set();
  private schemaNodes: SchemaNode[] = [];
  private selectedSchemaIdx = 0;
  private schemaFilterQuery = '';
  private tableColumns: Map<string, { name: string; type: string }[]> = new Map();

  private currentQuery = 'SELECT * FROM dim_team LIMIT 10;';
  private queryResult: DbRow[] = [];
  private executionTimeMs = 0;
  private rowsReturned = 0;
  private errorMessage = '';
  private autocompleteSuggestions: string[] = [];
  private selectedSuggestIdx = 0;

  // Focus Management
  // 0 = Schema Browser, 1 = SQL Input, 2 = Results Grid
  private focusIndex = 1; // Start focused on SQL Input for immediate typing
  private schemaFocusTarget: 'filter' | 'tree' = 'filter';
  private focusablePanels: BoxRenderable[] = [];

  constructor(renderer: CliRenderer) {
    // Parent container
    this.container = new BoxRenderable(renderer, {
      id: 'sql-sandbox-container',
      width: '100%',
      height: '100%',
      flexDirection: 'row',
      backgroundColor: Theme.background,
    });

    // Left Panel: Schema Browser
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
    });

    this.schemaText = new TextRenderable(renderer, {
      id: 'sandbox-schema-text',
      content: 'Loading tables...',
      wrapMode: 'none',
    });

    this.schemaScroll.add(this.schemaText);
    this.leftPanel.add(this.schemaFilterInput);
    this.leftPanel.add(this.schemaScroll);

    // Right Column: Input + Results
    this.rightColumn = new BoxRenderable(renderer, {
      id: 'sandbox-right-column',
      width: '75%',
      height: '100%',
      flexDirection: 'column',
    });

    // SQL Input Panel
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

    // Results Panel
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

    // Combine
    this.container.add(this.leftPanel);
    this.container.add(this.rightColumn);

    this.focusablePanels = [this.leftPanel, this.inputPanel, this.resultsPanel];

    // Wire events
    this.schemaFilterInput.on('input', () => {
      this.schemaFilterQuery = this.schemaFilterInput.value;
      this.rebuildSchemaNodes().then(() => this.renderSchema());
    });

    this.sqlInput.on('input', () => {
      this.currentQuery = this.sqlInput.value;
      this.updateAutocomplete();
    });

    this.sqlInput.on('enter', () => {
      this.runQuery();
    });
  }

  /**
   * Initializes schema browser by loading table lists.
   */
  async init() {
    try {
      const catalog = await loadSchemaCatalog();
      this.tables = catalog.tables;
      this.tableColumns = catalog.tableColumns;
      await this.rebuildSchemaNodes();
      this.renderSchema();
    } catch (e: unknown) {
      this.schemaText.content = ansiToStyledText(`Error loading schema:\n${getErrorMessage(e)}`);
      this.container.requestRender();
    }
  }

  /**
   * Focuses active widget and panel (OpenTUI focusable + focusedBorderColor).
   */
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

  /**
   * Cycles focus forward: Schema → SQL Input → Results.
   */
  cycleFocus() {
    this.focusIndex = (this.focusIndex + 1) % this.focusablePanels.length;
    if (this.focusIndex === 0) {
      this.schemaFocusTarget = 'filter';
    }
    this.focus();
  }

  /**
   * Cycles focus backward: Results → SQL Input → Schema.
   */
  cycleFocusBackward(): void {
    this.focusIndex =
      (this.focusIndex - 1 + this.focusablePanels.length) % this.focusablePanels.length;
    if (this.focusIndex === 0) {
      this.schemaFocusTarget = 'filter';
    }
    this.focus();
  }

  /**
   * Short status for app shell footer (focus, schema selection, rows, errors).
   */
  getStatusLine(): string {
    const panelNames = ['Schema', 'SQL Input', 'Results'];
    const parts: string[] = [`Focus: ${panelNames[this.focusIndex]}`];

    const node = this.schemaNodes[this.selectedSchemaIdx];
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

  private scrollSchemaIntoView() {
    const visibleHeight = this.schemaScroll.height || 20;
    const currentScroll = this.schemaScroll.scrollTop;
    const idx = this.selectedSchemaIdx;

    if (idx < currentScroll) {
      this.schemaScroll.scrollTop = idx;
    } else if (idx >= currentScroll + visibleHeight - 2) {
      this.schemaScroll.scrollTop = Math.max(0, idx - visibleHeight + 3);
    }
  }

  /**
   * Handles keyboard navigation.
   */
  handleKeyPress(event: KeyEvent): boolean {
    // Check global execute shortcut (Ctrl+R or Ctrl+E)
    if (event.ctrl && (event.name === 'r' || event.name === 'e')) {
      this.runQuery();
      return true;
    }

    if (this.focusIndex === 0) {
      // Schema Browser focused
      if (event.name === 'up') {
        if (this.selectedSchemaIdx > 0) {
          this.selectedSchemaIdx--;
          this.renderSchema();
          this.scrollSchemaIntoView();
        }
        return true;
      }
      if (event.name === 'down') {
        if (this.selectedSchemaIdx < this.schemaNodes.length - 1) {
          this.selectedSchemaIdx++;
          this.renderSchema();
          this.scrollSchemaIntoView();
        }
        return true;
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
      // SQL Input focused
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
      // Results Grid focused
      return this.resultsScroll.handleKeyPress(event);
    }
    return false;
  }

  /**
   * Expands/collapses tables, or inserts column/table name into SQL input.
   */
  private async toggleOrInsertSchemaNode() {
    const node = this.schemaNodes[this.selectedSchemaIdx];
    if (!node) return;

    if (node.type === 'table') {
      if (this.expandedTables.has(node.name)) {
        this.expandedTables.delete(node.name);
      } else {
        this.expandedTables.add(node.name);
      }
      await this.rebuildSchemaNodes();
      this.renderSchema();
    } else if (node.type === 'column') {
      // Paste column name into SQL Input
      const textToInsert = node.name;
      const curVal = this.sqlInput.value;
      this.sqlInput.value = `${curVal} ${textToInsert}`;
      this.currentQuery = this.sqlInput.value;
      this.updateAutocomplete();

      // Shift focus to SQL input
      this.focusIndex = 1;
      this.focus();
    }
  }

  /**
   * Rebuilds list of schema nodes (tables and columns) based on expand/collapse state.
   */
  private async rebuildSchemaNodes() {
    const q = (this.schemaFilterQuery || '').trim().toLowerCase();
    const newNodes: SchemaNode[] = [];

    for (const table of this.tables) {
      const cols = this.tableColumns.get(table) || [];
      const tableMatches = table.toLowerCase().includes(q);
      const matchingCols = cols.filter((c) => c.name.toLowerCase().includes(q));

      // If we have a filter, and neither the table nor any of its columns match, skip it
      if (q && !tableMatches && matchingCols.length === 0) {
        continue;
      }

      // If we have a filter and there are matching columns, we should auto-expand this table
      const isExpanded = this.expandedTables.has(table) || (q && matchingCols.length > 0);

      newNodes.push({ type: 'table', name: table });

      if (isExpanded) {
        // If there's a filter, only show the matching columns, otherwise show all
        const colsToShow = q ? matchingCols : cols;
        colsToShow.forEach((c) => {
          newNodes.push({
            type: 'column',
            name: c.name,
            tableName: table,
            columnType: c.type,
          });
        });
      }
    }

    this.schemaNodes = newNodes;
    if (this.selectedSchemaIdx >= this.schemaNodes.length) {
      this.selectedSchemaIdx = Math.max(0, this.schemaNodes.length - 1);
    }
  }

  private getAutocompleteSuggestions(): string[] {
    const queryStr = this.currentQuery || '';
    // Find the last word being typed. We can split by whitespace, commas, parens, semicolons.
    const words = queryStr.split(/[\s,()[\]{}";]+/);
    const lastWord = words[words.length - 1] || '';
    if (!lastWord) {
      return [];
    }

    const lastWordLower = lastWord.toLowerCase();

    // Collect all candidate strings: keywords, table names, and column names
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

    // Filter candidates that start with or contain the last word
    // Let's prioritize candidates that START with the last word, then candidates that CONTAIN the last word.
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

    // Reset selectedSuggestIdx if it is out of bounds
    if (this.selectedSuggestIdx >= this.autocompleteSuggestions.length) {
      this.selectedSuggestIdx = 0;
    }

    if (this.autocompleteSuggestions.length === 0) {
      this.autocompleteText.content = '';
    } else {
      // Build visual line for suggestions
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

  /**
   * Renders tables and columns text.
   */
  private renderSchema() {
    if (this.schemaNodes.length === 0) {
      this.schemaText.content = ansiToStyledText('No tables found.');
      this.container.requestRender();
      return;
    }

    const lines = this.schemaNodes.map((node, idx) => {
      const isSelected = idx === this.selectedSchemaIdx;
      const prefix = isSelected ? ' \x1b[1;35m▶\x1b[0m ' : '   ';

      if (node.type === 'table') {
        const isExpanded = this.expandedTables.has(node.name);
        const icon = isExpanded ? '▼' : '▶';
        const name = isSelected ? `\x1b[1m${node.name}\x1b[0m` : node.name;
        return `${prefix}${icon} \x1b[36m${name}\x1b[0m`;
      }
      const name = isSelected ? `\x1b[1m${node.name}\x1b[0m` : node.name;
      return `${prefix}  ├─ ${name} \x1b[90m(${node.columnType})\x1b[0m`;
    });

    this.schemaText.content = ansiToStyledText(lines.join('\n'));
    this.container.requestRender();
  }

  /**
   * Executes the custom query inside the SQL input.
   */
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

  /**
   * Renders the query outputs into a column-aligned ASCII matrix.
   */
  private renderResults() {
    if (this.queryResult.length === 0) {
      this.resultsText.content = ansiToStyledText(
        `Statement executed successfully.\nReturned 0 rows.\n\nExecution Time: ${this.executionTimeMs.toFixed(1)}ms`,
      );
      this.container.requestRender();
      return;
    }

    // Capture headers from the keys of the first row
    const firstRow = this.queryResult[0];
    const headers = Object.keys(firstRow);

    // Generate table lines
    const tableLines = formatTable(headers, this.queryResult, { maxRows: 100 });

    const summaryHeader = `\x1b[1;32mQuery Succeeded!\x1b[0m Returned \x1b[1m${this.rowsReturned}\x1b[0m rows in \x1b[1m${this.executionTimeMs.toFixed(1)}ms\x1b[0m (showing max 100 rows)\n\n`;

    this.resultsText.content = ansiToStyledText(summaryHeader + tableLines.join('\n'));

    // Reset scroll positions of result window so the user sees the top left corner of result matrix
    this.resultsScroll.scrollTop = 0;
    this.resultsScroll.scrollLeft = 0;

    this.container.requestRender();
  }
}
