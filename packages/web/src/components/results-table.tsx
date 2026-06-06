import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { type ReactNode, useMemo } from 'react';

interface ResultsTableProps {
  data: Record<string, unknown>[];
  loading: boolean;
  error: string | null;
  elapsedMs?: number;
}

export function ResultsTable({ data, loading, error, elapsedMs }: ResultsTableProps): ReactNode {
  const emptyData: Record<string, unknown>[] = useMemo(() => [], []);
  const effectiveData = data.length > 0 ? data : emptyData;

  const columns = useMemo(() => {
    if (data.length === 0) return [];
    const keys = Object.keys(data[0]!);
    const columnHelper = createColumnHelper<Record<string, unknown>>();
    return keys.map((col) =>
      columnHelper.accessor(col, {
        header: col,
        cell: (info) => {
          const val = info.getValue();
          if (val === null || val === undefined) return <span className="text-fg-dim">NULL</span>;
          return String(val);
        },
      }),
    );
  }, [data]);

  const table = useReactTable({
    data: effectiveData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (loading) {
    return <div className="p-4 text-center text-fg-muted text-sm">Executing query...</div>;
  }

  if (error) {
    return (
      <div className="border border-danger/30 bg-danger/10 p-4 text-sm text-danger">{error}</div>
    );
  }

  if (data.length === 0) {
    return <div className="p-4 text-center text-fg-dim text-sm">Query returned no results.</div>;
  }

  return (
    <div>
      {elapsedMs !== undefined && (
        <div className="mb-1 text-xs text-fg-dim">
          {data.length} row{data.length !== 1 ? 's' : ''} · {elapsedMs}ms
        </div>
      )}
      <div className="overflow-auto">
        <table className="w-full text-xs">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-border">
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    className="bg-surface-alt px-2 py-1 text-left font-bold text-fg-muted"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-surface-alt hover:bg-surface-alt/50">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="truncate px-2 py-1">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
