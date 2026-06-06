import type { PlayerPer36Row } from 'data/tabs/time-machine/queries';
import type { ReactNode } from 'react';

import { formatNumber, formatPct, formatSeason } from '../../../../utils/formatters.js';
import { DataTable } from '../internal/data-table.js';
import { EmptyHint } from '../internal/empty-hint.js';

function Per36Table({ rows }: { rows: PlayerPer36Row[] }): ReactNode {
  if (rows.length === 0) return <EmptyHint>No per-36 data available</EmptyHint>;
  return (
    <DataTable
      headers={[
        'Season',
        'Tm',
        'G',
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
          <td className="px-2 py-0.5">{formatNumber(r.fg_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.fga_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatPct(r.fg_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.x3p_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.x3pa_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatPct(r.x3p_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.ft_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.fta_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatPct(r.ft_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.orb_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.drb_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.trb_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.ast_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.stl_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.blk_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.tov_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.pf_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.pts_per_36_min, 1)}</td>
        </tr>
      ))}
    </DataTable>
  );
}

export { Per36Table };
