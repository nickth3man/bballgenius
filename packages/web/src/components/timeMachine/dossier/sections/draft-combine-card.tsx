import type { PlayerCombineRow, PlayerDraftRow } from 'data/tabs/time-machine/queries';
import type { ReactNode } from 'react';

import { formatNumber, formatPctValue, formatSeason } from '../../../../utils/formatters.js';
import { EmptyHint } from '../internal/empty-hint.js';
import { SectionCard } from '../internal/section-card.js';
import { SectionHeader } from '../internal/section-header.js';

export interface DraftCombineProps {
  draft: PlayerDraftRow | null;
  combine: PlayerCombineRow | null;
}

export function DraftCombineCard({ draft, combine }: DraftCombineProps): ReactNode {
  if (!draft && !combine) return null;
  return (
    <section>
      <SectionHeader>Draft &amp; Combine</SectionHeader>
      <SectionCard>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-widest text-fg-dim">Draft</div>
            {draft ? (
              <div className="space-y-0.5 text-xs text-fg">
                <div>
                  <span className="text-fg-dim">Season:</span> {formatSeason(draft.season_end_year)}
                </div>
                <div>
                  <span className="text-fg-dim">Round:</span> {draft.round ?? '\u2014'}
                </div>
                <div>
                  <span className="text-fg-dim">Overall pick:</span>{' '}
                  {draft.overall_pick ?? '\u2014'}
                </div>
                <div>
                  <span className="text-fg-dim">Team:</span> {draft.team ?? '\u2014'}
                </div>
              </div>
            ) : (
              <EmptyHint>Undrafted</EmptyHint>
            )}
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-widest text-fg-dim">Combine</div>
            {combine ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-fg">
                <div>
                  <span className="text-fg-dim">Ht w/o shoes:</span>{' '}
                  {formatNumber(combine.height_wo_shoes, 1)}&quot;
                </div>
                <div>
                  <span className="text-fg-dim">Wingspan:</span> {formatNumber(combine.wingspan, 1)}
                  &quot;
                </div>
                <div>
                  <span className="text-fg-dim">Standing reach:</span>{' '}
                  {formatNumber(combine.standing_reach, 1)}&quot;
                </div>
                <div>
                  <span className="text-fg-dim">Body fat:</span>{' '}
                  {formatPctValue(combine.body_fat_pct, 1)}
                </div>
                <div>
                  <span className="text-fg-dim">Standing vert:</span>{' '}
                  {formatNumber(combine.standing_vertical_leap, 1)}&quot;
                </div>
                <div>
                  <span className="text-fg-dim">Max vert:</span>{' '}
                  {formatNumber(combine.max_vertical_leap, 1)}&quot;
                </div>
                <div>
                  <span className="text-fg-dim">Lane agility:</span>{' '}
                  {formatNumber(combine.lane_agility_time, 2)}s
                </div>
                <div>
                  <span className="text-fg-dim">3/4 sprint:</span>{' '}
                  {formatNumber(combine.three_quarter_sprint, 2)}s
                </div>
                <div>
                  <span className="text-fg-dim">Hand length:</span>{' '}
                  {formatNumber(combine.hand_length, 2)}&quot;
                </div>
                <div>
                  <span className="text-fg-dim">Hand width:</span>{' '}
                  {formatNumber(combine.hand_width, 2)}&quot;
                </div>
                <div>
                  <span className="text-fg-dim">Bench:</span> {combine.bench_press ?? '\u2014'}
                </div>
              </div>
            ) : (
              <EmptyHint>No combine measurements on record</EmptyHint>
            )}
          </div>
        </div>
      </SectionCard>
    </section>
  );
}
