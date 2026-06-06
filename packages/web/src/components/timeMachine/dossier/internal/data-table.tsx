import type { ReactNode } from 'react';

interface DataTableProps {
  headers: string[];
  children: ReactNode;
  caption?: string;
}

export function DataTable({ headers, children, caption }: DataTableProps): ReactNode {
  return (
    <div className="relative">
      {/* Right-edge fade scroll indicator */}
      <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-8 bg-gradient-to-l from-surface/80 to-transparent" />
      {/* Bottom-edge fade scroll indicator */}
      <div className="pointer-events-none absolute bottom-0 left-0 z-10 h-6 w-full bg-gradient-to-t from-surface/60 to-transparent" />
      <table className="min-w-full font-mono text-xs [&_tbody_td:first-child]:sticky [&_tbody_td:first-child]:left-0 [&_tbody_td:first-child]:z-[5] [&_tbody_td:first-child]:bg-surface [&_tbody_td:first-child]:font-medium [&_tbody_td:first-child]:text-fg [&_thead_th:first-child]:sticky [&_thead_th:first-child]:left-0 [&_thead_th:first-child]:z-20 [&_thead_th:first-child]:bg-surface [&_tbody_td:nth-child(2)]:sticky [&_tbody_td:nth-child(2)]:left-[4.5rem] [&_tbody_td:nth-child(2)]:z-[5] [&_tbody_td:nth-child(2)]:bg-surface [&_thead_th:nth-child(2)]:sticky [&_thead_th:nth-child(2)]:left-[4.5rem] [&_thead_th:nth-child(2)]:z-20 [&_thead_th:nth-child(2)]:bg-surface [&_tbody_td:nth-child(3)]:sticky [&_tbody_td:nth-child(3)]:left-[7rem] [&_tbody_td:nth-child(3)]:z-[5] [&_tbody_td:nth-child(3)]:bg-surface [&_thead_th:nth-child(3)]:sticky [&_thead_th:nth-child(3)]:left-[7rem] [&_thead_th:nth-child(3)]:z-20 [&_thead_th:nth-child(3)]:bg-surface [&_tbody_td:nth-child(4)]:sticky [&_tbody_td:nth-child(4)]:left-[9.5rem] [&_tbody_td:nth-child(4)]:z-[5] [&_tbody_td:nth-child(4)]:bg-surface [&_thead_th:nth-child(4)]:sticky [&_thead_th:nth-child(4)]:left-[9.5rem] [&_thead_th:nth-child(4)]:z-20 [&_thead_th:nth-child(4)]:bg-surface">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="sticky top-0 z-10">
          <tr className="bg-surface text-fg-dim">
            {headers.map((h) => (
              <th
                key={h}
                className="border-b-2 border-border px-2 py-1.5 text-left font-semibold whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
