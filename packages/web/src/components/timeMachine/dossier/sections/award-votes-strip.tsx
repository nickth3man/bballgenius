import type { PlayerAllStarRow, PlayerAwardVoteRow } from 'data/tabs/time-machine/queries';
import type { ReactNode } from 'react';

import { formatPct, formatSeason } from '../../../../utils/formatters.js';
import { SectionCard } from '../internal/section-card.js';
import { SectionHeader } from '../internal/section-header.js';

export function AwardVotesStrip({
  allStar,
  votes,
}: {
  allStar: PlayerAllStarRow[];
  votes: PlayerAwardVoteRow[];
}): ReactNode {
  if (allStar.length === 0 && votes.length === 0) return null;

  const allStarYears = allStar
    .map((s) => s.season_end_year)
    .filter((y): y is number => y != null)
    .sort((a, b) => b - a);

  const topVotes = votes.filter((v) => !v.winner).slice(0, 6);

  return (
    <section>
      <SectionHeader>All-Star &amp; Award Voting</SectionHeader>
      <SectionCard>
        <div className="space-y-2">
          {allStarYears.length > 0 ? (
            <div className="flex items-baseline gap-2">
              <span className="rounded-md border border-secondary/30 bg-secondary/10 px-2.5 py-1 font-mono text-sm font-bold text-secondary">
                {allStarYears.length}\u00d7
              </span>
              <span className="text-xs text-fg-muted">NBA All-Star</span>
              <span className="font-mono text-[10px] text-fg-dim">
                ({allStarYears.slice(0, 5).join(', ')}
                {allStarYears.length > 5 ? ` +${allStarYears.length - 5} more` : ''})
              </span>
            </div>
          ) : null}

          {topVotes.length > 0 ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {topVotes.map((v) => {
                const share = Number(v.share);
                const isHighShare = share >= 0.5;
                return (
                  <span
                    key={`${v.award}-${v.season_end_year}`}
                    className={`rounded px-2 py-0.5 font-mono text-[11px] ${
                      isHighShare ? 'bg-success/10 text-success' : 'bg-surface-alt/60 text-fg-muted'
                    }`}
                  >
                    <span className="font-medium uppercase">{String(v.award)}</span>{' '}
                    <span className="text-fg-dim">{formatSeason(v.season_end_year)}</span>
                    {' \u00b7 '}
                    {formatPct(v.share, 1)} share
                    {' \u00b7 '}
                    <span className="text-fg-dim">
                      {v.pts_won}/{v.pts_max}
                    </span>
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      </SectionCard>
    </section>
  );
}
