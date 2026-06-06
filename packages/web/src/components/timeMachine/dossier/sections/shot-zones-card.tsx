import type { PlayerShotZoneRow } from 'data/tabs/time-machine/queries';
import type { ReactNode } from 'react';

import { PctBar } from '../../../ui/pct-bar.js';
import { DataTable } from '../internal/data-table.js';
import { SectionCard } from '../internal/section-card.js';
import { SectionHeader } from '../internal/section-header.js';

export function ShotZonesCard({ zones }: { zones: PlayerShotZoneRow[] }): ReactNode {
  if (zones.length === 0) return null;
  return (
    <section>
      <SectionHeader>Shot Zones</SectionHeader>
      <SectionCard>
        <DataTable headers={['Zone', 'FGA', 'FGM', 'FG%']}>
          {zones.map((z) => (
            <tr
              key={z.zone}
              className="border-b border-surface-alt/50 text-fg-muted even:bg-surface-alt/20 last:border-b-0"
            >
              <td className="px-2 py-0.5">{z.zone}</td>
              <td className="px-2 py-0.5">{z.fga}</td>
              <td className="px-2 py-0.5">{z.fgm}</td>
              <td className="px-2 py-0.5">
                <PctBar value={z.fg_pct} />
              </td>
            </tr>
          ))}
        </DataTable>
      </SectionCard>
    </section>
  );
}
