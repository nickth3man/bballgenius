import type { ReactNode } from 'react';
import { useState } from 'react';

interface SchemaNode {
  name: string;
  type: 'schema' | 'table' | 'column';
  children?: SchemaNode[];
  expanded?: boolean;
}

interface SchemaTreeProps {
  nodes: SchemaNode[];
  onSelectTable: (tableName: string) => void;
  onSelectColumn: (tableName: string, columnName: string) => void;
}

function TreeNode({
  node,
  onSelectTable,
  onSelectColumn,
  parentTable,
}: {
  node: SchemaNode;
  onSelectTable: (name: string) => void;
  onSelectColumn: (table: string, col: string) => void;
  parentTable?: string;
}) {
  const [expanded, setExpanded] = useState(node.expanded ?? false);

  if (node.type === 'column') {
    return (
      <button
        type="button"
        onClick={() => parentTable && onSelectColumn(parentTable, node.name)}
        className="block w-full py-0.5 pl-6 text-left text-xs text-fg-dim hover:text-fg"
      >
        {node.name}
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (node.type === 'table') onSelectTable(node.name);
          setExpanded(!expanded);
        }}
        className={`flex w-full items-center gap-1 py-0.5 pl-2 text-left text-xs hover:bg-surface-alt ${
          node.type === 'schema' ? 'font-bold text-fg-muted' : 'text-fg'
        }`}
      >
        <span className="text-fg-dim">{expanded ? '▼' : '▶'}</span>
        {node.name}
      </button>
      {expanded &&
        node.children?.map((child) => {
          const nextParentTable = node.type === 'table' ? node.name : parentTable;
          return (
            <TreeNode
              key={`${node.name}.${child.name}`}
              node={child}
              onSelectTable={onSelectTable}
              onSelectColumn={onSelectColumn}
              {...(nextParentTable !== undefined ? { parentTable: nextParentTable } : {})}
            />
          );
        })}
    </div>
  );
}

export function SchemaTree({ nodes, onSelectTable, onSelectColumn }: SchemaTreeProps): ReactNode {
  return (
    <div className="overflow-auto bg-surface p-2">
      <h3 className="mb-2 text-xs font-bold text-fg-muted">Schema</h3>
      {nodes.map((node) => (
        <TreeNode
          key={node.name}
          node={node}
          onSelectTable={onSelectTable}
          onSelectColumn={onSelectColumn}
        />
      ))}
    </div>
  );
}
