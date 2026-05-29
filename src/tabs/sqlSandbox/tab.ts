import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  type KeyEvent,
  type ScrollBoxRenderable,
  TextRenderable,
} from '@opentui/core';
import { getErrorMessage } from '../../core/errors.js';
import type { AppKeyEvent } from '../../core/input.js';
import type { DbRow } from '../../core/types.js';
import { createPanel, createScrollPanel, FocusManager } from '../../shared/ui/index.js';
import { ansiToStyledText, formatTable } from '../../shared/utils/formatters.js';
import { ansiBold, ansiGreen, ansiRed, Theme } from '../../shared/utils/theme.js';
import { AutocompleteController } from './autocomplete.js';
import { loadSchemaCatalog, runSandboxQuery } from './queries.js';
import { SchemaBrowser } from './schemaBrowser.js';

const PANEL_NAMES = ['Schema', 'SQL Input', 'Results'] as const;

export class SqlSandboxTab {
  readonly id = 'sql-sandbox';
  readonly name = 'SQL Sandbox';
  readonly container: BoxRenderable;

  private readonly leftPanel: BoxRenderable;
  private readonly rightColumn: BoxRenderable;
  private readonly inputPanel: BoxRenderable;
  private readonly resultsPanel: BoxRenderable;

  private readonly schemaFilterInput: InputRenderable;
  private readonly schemaScroll: ScrollBoxRenderable;
  private readonly schemaText: TextRenderable;
  private readonly sqlInput: InputRenderable;
  private readonly resultsScroll: ScrollBoxRenderable;
  private readonly resultsText: TextRenderable;

  private readonly schemaBrowser: SchemaBrowser;
  private readonly autocomplete: AutocompleteController;

  private tables: string[] = [];
  private tableColumns: Map<string, { name: string; type: string }[]> = new Map();

  private currentQuery = 'SELECT * FROM dim_team LIMIT 10;';
  private queryResult: DbRow[] = [];
  private executionTimeMs = 0;
  private rowsReturned = 0;
  private errorMessage = '';
  private schemaFocusTarget: 'filter' | 'tree' = 'filter';

  private readonly focusManager: FocusManager;

  /** @internal Test access: delegates to focusManager.currentIndex */
  get focusIndex(): number {
    return this.focusManager.currentIndex;
  }

  set focusIndex(val: number) {
    this.focusManager.setIndex(val);
  }

  /** @internal Test access: delegates to autocomplete */
  get autocompleteSuggestions(): readonly string[] {
    return this.autocomplete.allSuggestions;
  }

  /** @internal Test access: triggers autocomplete update */
  updateAutocomplete(): void {
    this.autocomplete.update(this.currentQuery, () => this.container.requestRender());
  }

  constructor(renderer: CliRenderer) {
    this.container = new BoxRenderable(renderer, {
      id: 'sql-sandbox-container',
      width: '100%',
      height: '100%',
      flexDirection: 'row',
      gap: Theme.gap,
      backgroundColor: Theme.background,
    });

    this.leftPanel = createPanel(renderer, {
      id: 'sandbox-schema-panel',
      title: 'Database Schema',
      width: '25%',
      flexDirection: 'column' as const,
    });

    this.schemaFilterInput = new InputRenderable(renderer, {
      id: 'sandbox-schema-filter-input',
      width: '100%',
      placeholder: 'Type to filter...',
      backgroundColor: Theme.inputBg,
    });

    const schemaScrollPanel = createScrollPanel(renderer, {
      id: 'sandbox-schema',
      width: '100%',
      flexGrow: 1,
      border: false,
      focusable: false,
    });
    this.schemaScroll = schemaScrollPanel.scroll;
    this.schemaText = schemaScrollPanel.text;

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

    this.inputPanel = createPanel(renderer, {
      id: 'sandbox-input-panel',
      title: 'SQL Input (Ctrl+R / Ctrl+E Execute)',
      height: '30%',
    });

    this.sqlInput = new InputRenderable(renderer, {
      id: 'sandbox-sql-input',
      width: '100%',
      placeholder: 'Enter SQL query...',
      backgroundColor: '#222530',
    });
    this.sqlInput.value = this.currentQuery;

    this.autocomplete = new AutocompleteController(renderer);

    const sqlInstructions = new TextRenderable(renderer, {
      id: 'sandbox-sql-instructions',
      content:
        '\nTip: Enter any standard DuckDB SQL statement.\nKeys: [Ctrl+R] or [Ctrl+E] Run, [Enter] Execute/Auto-paste table schema.',
    });

    this.inputPanel.add(this.sqlInput);
    this.inputPanel.add(this.autocomplete.renderable);
    this.inputPanel.add(sqlInstructions);

    const resultsPanel = createScrollPanel(renderer, {
      id: 'sandbox-results-panel',
      title: 'Query Results',
      height: '70%',
    });
    this.resultsPanel = resultsPanel.panel;
    this.resultsScroll = resultsPanel.scroll;
    this.resultsText = resultsPanel.text;

    this.rightColumn.add(this.inputPanel);
    this.rightColumn.add(this.resultsPanel);

    this.container.add(this.leftPanel);
    this.container.add(this.rightColumn);

    this.focusManager = new FocusManager([this.leftPanel, this.inputPanel, this.resultsPanel], 1);

    this.schemaFilterInput.on('input', () => {
      this.schemaBrowser.setFilter(this.schemaFilterInput.value);
      this.schemaBrowser.rebuild().then(() => {
        this.schemaBrowser.render();
        this.container.requestRender();
      });
    });

    this.sqlInput.on('input', () => {
      this.currentQuery = this.sqlInput.value;
      this.autocomplete.update(this.currentQuery, () => this.container.requestRender());
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
      this.autocomplete.loadSchema(this.tables, this.tableColumns);
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
    this.focusManager.focusActive();

    const idx = this.focusManager.currentIndex;
    if (idx === 0) {
      if (this.schemaFocusTarget === 'filter') {
        this.schemaFilterInput.focus();
      } else {
        this.schemaScroll.focus();
      }
    } else if (idx === 1) {
      this.sqlInput.focus();
    } else {
      this.resultsScroll.focus();
    }

    this.container.requestRender();
  }

  cycleFocus() {
    this.focusManager.next();
    if (this.focusManager.currentIndex === 0) {
      this.schemaFocusTarget = 'filter';
    }
    this.focus();
  }

  cycleFocusBackward(): void {
    this.focusManager.prev();
    if (this.focusManager.currentIndex === 0) {
      this.schemaFocusTarget = 'filter';
    }
    this.focus();
  }

  getStatusLine(): string {
    const parts: string[] = [`Focus: ${PANEL_NAMES[this.focusManager.currentIndex]}`];

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
    const idx = this.focusManager.currentIndex;
    if (idx === 1) {
      this.sqlInput.blur();
      this.focusManager.setIndex(0);
      this.schemaFocusTarget = 'tree';
      this.focus();
    } else if (idx === 0 && this.schemaFilterInput.focused) {
      this.schemaFilterInput.blur();
      this.focusManager.setIndex(1);
      this.schemaFocusTarget = 'filter';
      this.focus();
    }
  }

  handleKeyPress(event: AppKeyEvent): boolean {
    if (event.ctrl && (event.name === 'r' || event.name === 'e')) {
      this.runQuery();
      return true;
    }

    const idx = this.focusManager.currentIndex;

    if (idx === 0) {
      return this.handleSchemaPanelKeys(event);
    }

    if (idx === 1) {
      return this.handleInputPanelKeys(event);
    }

    if (idx === 2) {
      return this.resultsScroll.handleKeyPress(event as KeyEvent);
    }

    return false;
  }

  private handleSchemaPanelKeys(event: AppKeyEvent): boolean {
    if (event.name === 'up') return this.schemaBrowser.moveUp();
    if (event.name === 'down') return this.schemaBrowser.moveDown();
    if (event.name === 'return' || event.name === 'enter') {
      this.toggleOrInsertSchemaNode();
      return true;
    }
    if (event.name === 'tab') {
      if (event.shift) this.cycleFocusBackward();
      else this.cycleFocus();
      return true;
    }
    return false;
  }

  private handleInputPanelKeys(event: AppKeyEvent): boolean {
    if (event.name === 'tab') {
      if (this.autocomplete.hasSuggestions && !event.shift) {
        this.acceptAutocomplete();
        return true;
      }
      if (event.shift) this.cycleFocusBackward();
      else this.cycleFocus();
      return true;
    }

    if (this.autocomplete.hasSuggestions) {
      if (event.name === 'up') {
        this.autocomplete.moveUp();
        this.autocomplete.update(this.currentQuery, () => this.container.requestRender());
        return true;
      }
      if (event.name === 'down') {
        this.autocomplete.moveDown();
        this.autocomplete.update(this.currentQuery, () => this.container.requestRender());
        return true;
      }
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
      const curVal = this.sqlInput.value;
      this.sqlInput.value = `${curVal} ${node.name}`;
      this.currentQuery = this.sqlInput.value;
      this.autocomplete.update(this.currentQuery, () => this.container.requestRender());

      this.focusManager.setIndex(1);
      this.focus();
    }
  }

  private acceptAutocomplete() {
    this.sqlInput.value = this.autocomplete.accept(this.sqlInput.value);
    this.currentQuery = this.sqlInput.value;
    this.autocomplete.reset();
    this.autocomplete.update(this.currentQuery, () => this.container.requestRender());
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
        `${ansiRed('SQL Error:')}\n${this.errorMessage}\n\nExecution Time: ${this.executionTimeMs.toFixed(1)}ms`,
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

    const summaryHeader = `${ansiGreen('Query Succeeded!')} Returned ${ansiBold(String(this.rowsReturned))} rows in ${ansiBold(`${this.executionTimeMs.toFixed(1)}ms`)} (showing max 100 rows)\n\n`;

    this.resultsText.content = ansiToStyledText(summaryHeader + tableLines.join('\n'));

    this.resultsScroll.scrollTop = 0;
    this.resultsScroll.scrollLeft = 0;

    this.container.requestRender();
  }
}
