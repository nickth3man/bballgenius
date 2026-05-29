import type { ScrollBoxRenderable, TextRenderable } from '@opentui/core';
import { ansiToStyledText } from '../../shared/utils/formatters.js';

export interface SchemaNode {
  type: 'table' | 'column';
  name: string;
  tableName?: string;
  columnType?: string;
}

export interface SchemaBrowserDeps {
  schemaScroll: ScrollBoxRenderable;
  schemaText: TextRenderable;
}

export class SchemaBrowser {
  private tables: string[] = [];
  private expandedTables: Set<string> = new Set();
  private nodes: SchemaNode[] = [];
  private selectedIdx = 0;
  private filterQuery = '';
  private tableColumns: Map<string, { name: string; type: string }[]> = new Map();

  constructor(private readonly deps: SchemaBrowserDeps) {}

  getNodes(): SchemaNode[] {
    return this.nodes;
  }

  getSelectedIndex(): number {
    return this.selectedIdx;
  }

  getSelectedNode(): SchemaNode | undefined {
    return this.nodes[this.selectedIdx];
  }

  isExpanded(tableName: string): boolean {
    return this.expandedTables.has(tableName);
  }

  setFilter(query: string): void {
    this.filterQuery = query;
  }

  loadData(tables: string[], tableColumns: Map<string, { name: string; type: string }[]>): void {
    this.tables = tables;
    this.tableColumns = tableColumns;
  }

  async rebuild(): Promise<void> {
    const q = (this.filterQuery || '').trim().toLowerCase();
    const newNodes: SchemaNode[] = [];

    for (const table of this.tables) {
      const cols = this.tableColumns.get(table) || [];
      const tableMatches = table.toLowerCase().includes(q);
      const matchingCols = cols.filter((c) => c.name.toLowerCase().includes(q));

      if (q && !tableMatches && matchingCols.length === 0) {
        continue;
      }

      const isExpanded = this.expandedTables.has(table) || (q && matchingCols.length > 0);

      newNodes.push({ type: 'table', name: table });

      if (isExpanded) {
        const colsToShow = q ? matchingCols : cols;
        for (const c of colsToShow) {
          newNodes.push({
            type: 'column',
            name: c.name,
            tableName: table,
            columnType: c.type,
          });
        }
      }
    }

    this.nodes = newNodes;
    if (this.selectedIdx >= this.nodes.length) {
      this.selectedIdx = Math.max(0, this.nodes.length - 1);
    }
  }

  render(): void {
    if (this.nodes.length === 0) {
      this.deps.schemaText.content = ansiToStyledText('No tables found.');
      return;
    }

    const lines = this.nodes.map((node, idx) => {
      const isSelected = idx === this.selectedIdx;
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

    this.deps.schemaText.content = ansiToStyledText(lines.join('\n'));
  }

  scrollIntoView(): void {
    const visibleHeight = this.deps.schemaScroll.height || 20;
    const currentScroll = this.deps.schemaScroll.scrollTop;
    const idx = this.selectedIdx;

    if (idx < currentScroll) {
      this.deps.schemaScroll.scrollTop = idx;
    } else if (idx >= currentScroll + visibleHeight - 2) {
      this.deps.schemaScroll.scrollTop = Math.max(0, idx - visibleHeight + 3);
    }
  }

  moveUp(): boolean {
    if (this.selectedIdx > 0) {
      this.selectedIdx--;
      this.render();
      this.scrollIntoView();
      return true;
    }
    return false;
  }

  moveDown(): boolean {
    if (this.selectedIdx < this.nodes.length - 1) {
      this.selectedIdx++;
      this.render();
      this.scrollIntoView();
      return true;
    }
    return false;
  }

  toggleTable(table: string): void {
    if (this.expandedTables.has(table)) {
      this.expandedTables.delete(table);
    } else {
      this.expandedTables.add(table);
    }
  }
}
