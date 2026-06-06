import type { ReactNode } from 'react';

import { formatPct } from '../../utils/formatters.js';

interface PctBarProps {
  value: number | string | null | undefined;
}

export function PctBar({ value }: PctBarProps): ReactNode {
  if (value == null) return <span className="text-fg-dim">&mdash;</span>;
  const n = Number(value);
  if (!Number.isFinite(n)) return <span className="text-fg-dim">&mdash;</span>;
  const pct = Math.round(Math.min(100, Math.max(0, n * 100)));
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block w-10 h-1.5 rounded-full bg-surface-alt overflow-hidden"
        aria-hidden="true"
      >
        <span className="block h-full rounded-full bg-primary/60" style={{ width: `${pct}%` }} />
      </span>
      <span>{formatPct(value)}</span>
    </span>
  );
}
