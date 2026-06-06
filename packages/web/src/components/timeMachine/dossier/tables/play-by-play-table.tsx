import type { PlayerPlayByPlayRow } from 'data/tabs/time-machine/queries';
import type { ReactNode } from 'react';

import { formatNumber } from '../../../../utils/formatters.js';
import { DataTable } from '../internal/data-table.js';
import { EmptyHint } from '../internal/empty-hint.js';

function PlayByPlayTable({ rows }: { rows: PlayerPlayByPlayRow[] }): ReactNode {
  if (rows.length === 0) return <EmptyHint>No play-by-play data available</EmptyHint>;
  return (
    <DataTable
      headers={[
        'Season',
        'Tm',
        'G',
        'MP',
        '%PG',
        '%SG',
        '%SF',
        '%PF',
        '%C',
        'OnCourt +/-',
        'Net +/-',
        'Pts via AST',
        'FGA Blocked',
      ]}
    >
      {rows.map((r) => (
        <tr
          key={`row-${r.season_end_year}-${r.team ?? ''}-${r.pos ?? ''}`}
          className="border-b border-surface-alt/50 text-fg-muted even:bg-surface-alt/20 last:border-b-0 hover:bg-surface-alt/40 transition-colors"
        >
          <td className="px-2 py-0.5">{formatSeason(r.season_end_year)}</td>
          <td className="px-2 py-0.5">{r.team ?? '\u2014'}</td>
          <td className="px-2 py-0.5">{r.g ?? '\u2014'}</td>
          <td className="px-2 py-0.5">{r.mp ?? '\u2014'}</td>
          <td className="px-2 py-0.5">{formatPctValue(r.pg_percent)}</td>
          <td className="px-2 py-0.5">{formatPctValue(r.sg_percent)}</td>
          <td className="px-2 py-0.5">{formatPctValue(r.sf_percent)}</td>
          <td className="px-2 py-0.5">{formatPctValue(r.pf_percent)}</td>
          <td className="px-2 py-0.5">{formatPctValue(r.c_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.on_court_plus_minus_per_100_poss, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.net_plus_minus_per_100_poss, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.points_generated_by_assists, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.fga_blocked, 0)}</td>
        </tr>
      ))}
    </DataTable>
  );
}

function formatSeason(seasonEndYear: number | string | null | undefined): string {
  if (seasonEndYear == null) return '\u2014';
  const y = Number(seasonEndYear);
  if (!Number.isFinite(y)) return String(seasonEndYear);
  return `${y - 1}-${String(y).slice(-2)}`;
}

function formatPctValue(value: number | string | null | undefined, digits = 1): string {
  if (value == null) return '\u2014';
  const n = Number(value);
  if (!Number.isFinite(n)) return '\u2014';
  return `${n.toFixed(digits)}%`;
}

export { PlayByPlayTable };
