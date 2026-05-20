import { BoxRenderable, TextRenderable, ScrollBoxRenderable, InputRenderable, KeyEvent } from '@opentui/core';
import { query, getTables, getColumns } from '../db.js';
import { formatTable, ansiToStyledText } from '../utils/formatters.js';
import { Theme } from '../utils/theme.js';

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
  private readonly schemaScroll: ScrollBoxRenderable;
  private readonly schemaText: TextRenderable;
  private readonly sqlInput: InputRenderable;
  private readonly resultsScroll: ScrollBoxRenderable;
  private readonly resultsText: TextRenderable;

  // State
  private tables: string[] = [];
  private expandedTables: Set<string> = new Set();
  private schemaNodes: SchemaNode[] = [];
  private selectedSchemaIdx = 0;

  private currentQuery = 'SELECT * FROM dim_team LIMIT 10;';
  private queryResult: any[] = [];
  private executionTimeMs = 0;
  private rowsReturned = 0;
  private errorMessage = '';

  // Focus Management
  // 0 = Schema Browser, 1 = SQL Input, 2 = Results Grid
  private focusIndex = 1; // Start focused on SQL Input for immediate typing
  private focusablePanels: BoxRenderable[] = [];

  constructor(renderer: any) {
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

    const sqlInstructions = new TextRenderable(renderer, {
      id: 'sandbox-sql-instructions',
      content:
        '\nTip: Enter any standard DuckDB SQL statement.\nKeys: [Ctrl+R] or [Ctrl+E] Run, [Enter] Execute/Auto-paste table schema.',
    });

    this.inputPanel.add(this.sqlInput);
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
    (this.sqlInput as any).on('input', () => {
      this.currentQuery = this.sqlInput.value;
    });

    (this.sqlInput as any).on('enter', () => {
      this.runQuery();
    });
  }

  /**
   * Initializes schema browser by loading table lists.
   */
  async init() {
    try {
      this.tables = await getTables();
      await this.rebuildSchemaNodes();
      this.renderSchema();
    } catch (e: any) {
      this.schemaText.content = ansiToStyledText(`Error loading schema:\n${e.message}`);
      this.container.requestRender();
    }
  }

  /**
   * Focuses active widget and panel (OpenTUI focusable + focusedBorderColor).
   */
  focus() {
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
      this.schemaScroll.focus();
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
    this.focus();
  }

  /**
   * Cycles focus backward: Results → SQL Input → Schema.
   */
  cycleFocusBackward(): void {
    this.focusIndex =
      (this.focusIndex - 1 + this.focusablePanels.length) % this.focusablePanels.length;
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
    return this.sqlInput.focused;
  }

  blurInput() {
    this.sqlInput.blur();
    this.focusIndex = 0; // Move focus to Schema browser
    this.focus();
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
      
      // Shift focus to SQL input
      this.focusIndex = 1;
      this.focus();
    }
  }

  /**
   * Rebuilds list of schema nodes (tables and columns) based on expand/collapse state.
   */
  private async rebuildSchemaNodes() {
    const newNodes: SchemaNode[] = [];
    
    for (const table of this.tables) {
      newNodes.push({ type: 'table', name: table });
      
      if (this.expandedTables.has(table)) {
        try {
          const cols = await getColumns(table);
          cols.forEach((c) => {
            newNodes.push({
              type: 'column',
              name: c.name,
              tableName: table,
              columnType: c.type,
            });
          });
        } catch (e) {
          // Ignore
        }
      }
    }
    
    this.schemaNodes = newNodes;
    if (this.selectedSchemaIdx >= this.schemaNodes.length) {
      this.selectedSchemaIdx = Math.max(0, this.schemaNodes.length - 1);
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
      this.queryResult = await query(sql);
      this.executionTimeMs = performance.now() - start;
      this.rowsReturned = this.queryResult.length;
      
      this.renderResults();
    } catch (e: any) {
      this.errorMessage = e.message;
      this.queryResult = [];
      this.rowsReturned = 0;
      this.executionTimeMs = performance.now() - start;
      
      this.resultsText.content = ansiToStyledText(`\x1b[1;31mSQL Error:\x1b[0m\n${this.errorMessage}\n\nExecution Time: ${this.executionTimeMs.toFixed(1)}ms`);
      this.container.requestRender();
    }
  }

  /**
   * Renders the query outputs into a column-aligned ASCII matrix.
   */
  private renderResults() {
    if (this.queryResult.length === 0) {
      this.resultsText.content = ansiToStyledText(`Statement executed successfully.\nReturned 0 rows.\n\nExecution Time: ${this.executionTimeMs.toFixed(1)}ms`);
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
