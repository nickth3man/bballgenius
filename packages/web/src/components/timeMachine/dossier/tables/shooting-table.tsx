import type { PlayerShootingRow } from 'data/tabs/time-machine/queries';
import type { ReactNode } from 'react';
import { formatNumber } from '../../../../utils/formatters.js';
import { PctBar } from '../../../ui/pct-bar.js';
import { DataTable } from '../internal/data-table.js';
import { EmptyHint } from '../internal/empty-hint.js';

function ShootingTable({ rows }: { rows: PlayerShootingRow[] }): ReactNode {
  if (rows.length === 0) return <EmptyHint>No shooting data available (post-2000 era)</EmptyHint>;
  return (
    <DataTable
      headers={[
        'Season',
        'Tm',
        'G',
        'MP',
        'FG%',
        'Dist',
        '%FGA 0-3',
        '%FGA 3-10',
        '%FGA 10-16',
        '%FGA 16-3P',
        '%FGA 3P',
        'FG% 0-3',
        'FG% 3-10',
        'FG% 10-16',
        'FG% 16-3P',
        'FG% 3P',
        '%Ast 2P',
        '%Ast 3P',
        '%Dunks',
        '#Dunks',
        'Corner3 %',
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
          <td className="px-2 py-0.5">
            <PctBar value={r.fg_percent} />
          </td>
          <td className="px-2 py-0.5">{formatNumber(r.avg_dist_fga, 1)}</td>
          <td className="px-2 py-0.5">
            <PctBar value={r.percent_fga_from_x0_3_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.percent_fga_from_x3_10_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.percent_fga_from_x10_16_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.percent_fga_from_x16_3p_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.percent_fga_from_x3p_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.fg_percent_from_x0_3_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.fg_percent_from_x3_10_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.fg_percent_from_x10_16_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.fg_percent_from_x16_3p_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.fg_percent_from_x3p_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.percent_assisted_x2p_fg} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.percent_assisted_x3p_fg} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.percent_dunks_of_fga} />
          </td>
          <td className="px-2 py-0.5">{r.num_of_dunks ?? '\u2014'}</td>
          <td className="px-2 py-0.5">
            <PctBar value={r.percent_corner_3s_of_3pa} />
          </td>
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

export { ShootingTable };
