import type { PlayerGameLogRow } from 'data/tabs/time-machine/queries';
import type { ReactNode } from 'react';

import { formatDate, formatNumber } from '../../../../utils/formatters.js';
import { DataTable } from '../internal/data-table.js';
import { EmptyHint } from '../internal/empty-hint.js';
import { SectionCard } from '../internal/section-card.js';
import { SectionHeader } from '../internal/section-header.js';

export function GameLogCard({ rows }: { rows: PlayerGameLogRow[] }): ReactNode {
  return (
    <section>
      <SectionHeader>Recent Games</SectionHeader>
      <SectionCard>
        {rows.length === 0 ? (
          <EmptyHint>No game log data available</EmptyHint>
        ) : (
          <div className="overflow-x-auto">
            <DataTable
              headers={[
                'Date',
                'Matchup',
                'W/L',
                'MIN',
                'PTS',
                'REB',
                'AST',
                'STL',
                'BLK',
                'TOV',
                '+/-',
              ]}
            >
              {rows.map((g) => (
                <tr
                  key={`gamelog-${g.game_date}-${g.matchup ?? ''}`}
                  className="border-b border-surface-alt/50 text-fg-muted even:bg-surface-alt/20 last:border-b-0 hover:bg-surface-alt/40 transition-colors"
                >
                  <td className="px-2 py-0.5">{formatDate(g.game_date)}</td>
                  <td className="px-2 py-0.5">{g.matchup ?? '\u2014'}</td>
                  <td
                    className={`px-2 py-0.5 font-semibold ${
                      g.wl === 'W' ? 'text-success' : g.wl === 'L' ? 'text-danger' : 'text-fg-muted'
                    }`}
                  >
                    {g.wl ?? '\u2014'}
                  </td>
                  <td className="px-2 py-0.5">{formatNumber(g.min, 1)}</td>
                  <td className="px-2 py-0.5">{formatNumber(g.pts, 0)}</td>
                  <td className="px-2 py-0.5">{formatNumber(g.reb, 0)}</td>
                  <td className="px-2 py-0.5">{formatNumber(g.ast, 0)}</td>
                  <td className="px-2 py-0.5">{formatNumber(g.stl, 0)}</td>
                  <td className="px-2 py-0.5">{formatNumber(g.blk, 0)}</td>
                  <td className="px-2 py-0.5">{formatNumber(g.tov, 0)}</td>
                  <td className="px-2 py-0.5">{formatNumber(g.plus_minus, 0)}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}
      </SectionCard>
    </section>
  );
}
