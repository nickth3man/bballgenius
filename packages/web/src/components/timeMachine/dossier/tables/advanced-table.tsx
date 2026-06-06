import type { PlayerAdvancedRow } from 'data/tabs/time-machine/queries';
import type { ReactNode } from 'react';
import { formatNumber } from '../../../../utils/formatters.js';
import { PctBar } from '../../../ui/pct-bar.js';
import { DataTable } from '../internal/data-table.js';
import { EmptyHint } from '../internal/empty-hint.js';
import { highlightClass } from '../internal/highlight.js';

function AdvancedTable({ rows }: { rows: PlayerAdvancedRow[] }): ReactNode {
  if (rows.length === 0) return <EmptyHint>No advanced stats available</EmptyHint>;

  const perValues = rows.map((r) => Number(r.per)).filter(Number.isFinite);
  const wsValues = rows.map((r) => Number(r.ws)).filter(Number.isFinite);
  const bpmValues = rows.map((r) => Number(r.bpm)).filter(Number.isFinite);
  const vorpValues = rows.map((r) => Number(r.vorp)).filter(Number.isFinite);
  const best = (arr: number[]) => (arr.length > 1 ? Math.max(...arr) : null);
  const worst = (arr: number[]) => (arr.length > 1 ? Math.min(...arr) : null);

  return (
    <DataTable
      headers={[
        'Season',
        'Tm',
        'Age',
        'G',
        'MP',
        'PER',
        'TS%',
        '3PAr',
        'FTr',
        'ORB%',
        'DRB%',
        'TRB%',
        'AST%',
        'STL%',
        'BLK%',
        'TOV%',
        'USG%',
        'OWS',
        'DWS',
        'WS',
        'WS/48',
        'OBPM',
        'DBPM',
        'BPM',
        'VORP',
      ]}
    >
      {rows.map((r) => (
        <tr
          key={`row-${r.season_end_year}-${r.team ?? ''}-${r.pos ?? ''}`}
          className="border-b border-surface-alt/50 text-fg-muted even:bg-surface-alt/20 last:border-b-0 hover:bg-surface-alt/40 transition-colors"
        >
          <td className="px-2 py-0.5">{formatSeason(r.season_end_year)}</td>
          <td className="px-2 py-0.5">{r.team ?? '\u2014'}</td>
          <td className="px-2 py-0.5">{r.age ?? '\u2014'}</td>
          <td className="px-2 py-0.5">{r.g ?? '\u2014'}</td>
          <td className="px-2 py-0.5">{r.mp ?? '\u2014'}</td>
          <td className={`px-2 py-0.5 ${highlightClass(r.per, best(perValues), worst(perValues))}`}>
            {formatNumber(r.per)}
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.ts_percent} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.x3p_ar} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.f_tr} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.orb_percent} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.drb_percent} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.trb_percent} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.ast_percent} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.stl_percent} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.blk_percent} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.tov_percent} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.usg_percent} />
          </td>
          <td className="px-2 py-0.5">{formatNumber(r.ows, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.dws, 1)}</td>
          <td className={`px-2 py-0.5 ${highlightClass(r.ws, best(wsValues), worst(wsValues))}`}>
            {formatNumber(r.ws, 1)}
          </td>
          <td className="px-2 py-0.5">{formatNumber(r.ws_48, 3)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.obpm, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.dbpm, 1)}</td>
          <td className={`px-2 py-0.5 ${highlightClass(r.bpm, best(bpmValues), worst(bpmValues))}`}>
            {formatNumber(r.bpm, 1)}
          </td>
          <td
            className={`px-2 py-0.5 ${highlightClass(r.vorp, best(vorpValues), worst(vorpValues))}`}
          >
            {formatNumber(r.vorp, 1)}
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

export { AdvancedTable };
