import { useCallback, useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';

export interface UseSortableTableOptions<T> {
  initialSortCol?: string | null;
  initialSortDir?: SortDir;
  getValue: (row: T, col: string) => number;
  onSortChange?: (col: string | null, dir: SortDir) => void;
}

export interface UseSortableTableResult<T> {
  sortCol: string | null;
  sortDir: SortDir;
  sortedRows: T[];
  handleSort: (col: string) => void;
}

export function useSortableTable<T>(
  rows: T[],
  options: UseSortableTableOptions<T>,
): UseSortableTableResult<T> {
  const { initialSortCol = null, initialSortDir = 'asc', getValue, onSortChange } = options;
  const [sortCol, setSortCol] = useState<string | null>(initialSortCol);
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir);

  const sortedRows = useMemo(() => {
    if (!sortCol) return rows;
    const sorted = [...rows].sort((a, b) => {
      const va = getValue(a, sortCol);
      const vb = getValue(b, sortCol);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return sorted;
  }, [rows, sortCol, sortDir, getValue]);

  const handleSort = useCallback(
    (col: string) => {
      let newDir: SortDir;
      if (sortCol === col) {
        newDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        newDir = 'desc';
      }
      setSortCol(col);
      setSortDir(newDir);
      onSortChange?.(col, newDir);
    },
    [sortCol, sortDir, onSortChange],
  );

  return { sortCol, sortDir, sortedRows, handleSort };
}
