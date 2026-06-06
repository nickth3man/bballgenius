import type { PlayerTotalsRow } from 'data/tabs/time-machine/queries';
import type { ReactNode } from 'react';

import { formatNumber, formatPct, formatSeason } from '../../../../utils/formatters.js';
import { DataTable } from '../internal/data-table.js';
import { EmptyHint } from '../internal/empty-hint.js';

function TotalsTable({ rows }: { rows: PlayerTotalsRow[] }): ReactNode {
  if (rows.length === 0) return <EmptyHint>No totals data available</EmptyHint>;
  return (
    <DataTable
      headers={[
        'Season',
        'Tm',
        'Pos',
        'G',
        'GS',
        'MP',
        'FG',
        'FGA',
        'FG%',
        '3P',
        '3PA',
        '3P%',
        'FT',
        'FTA',
        'FT%',
        'ORB',
        'DRB',
        'TRB',
        'AST',
        'STL',
        'BLK',
        'TOV',
        'PF',
        'PTS',
        'Trp-Dbl',
      ]}
    >
      {rows.map((r) => (
        <tr
          key={`row-${r.season_end_year}-${r.team ?? ''}-${r.pos ?? ''}`}
          className="border-b border-surface-alt/50 text-fg-muted even:bg-surface-alt/20 last:border-b-0 hover:bg-surface-alt/40 transition-colors"
        >
          <td className="px-2 py-0.5">{formatSeason(r.season_end_year)}</td>
          <td className="px-2 py-0.5">{r.team ?? '\u2014'}</td>
          <td className="px-2 py-0.5">{r.pos ?? '\u2014'}</td>
          <td className="px-2 py-0.5">{r.g ?? '\u2014'}</td>
          <td className="px-2 py-0.5">{r.gs ?? '\u2014'}</td>
          <td className="px-2 py-0.5">{r.mp ?? '\u2014'}</td>
          <td className="px-2 py-0.5">{formatNumber(r.fg, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.fga, 0)}</td>
          <td className="px-2 py-0.5">{formatPct(r.fg_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.x3p, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.x3pa, 0)}</td>
          <td className="px-2 py-0.5">{formatPct(r.x3p_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.ft, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.fta, 0)}</td>
          <td className="px-2 py-0.5">{formatPct(r.ft_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.orb, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.drb, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.trb, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.ast, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.stl, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.blk, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.tov, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.pf, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.pts, 0)}</td>
          <td className="px-2 py-0.5">{r.trp_dbl ?? '\u2014'}</td>
        </tr>
      ))}
    </DataTable>
  );
}

export { TotalsTable };
