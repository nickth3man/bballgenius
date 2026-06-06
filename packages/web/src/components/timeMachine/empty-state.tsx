import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { PlayerResult } from '../../routes/time-machine/server-fns.js';
import { Skeleton } from '../ui';

interface FeaturedPlayersEmptyStateProps {
  onSelect: (p: PlayerResult) => void;
  loader: () => Promise<PlayerResult[]>;
}

export function FeaturedPlayersEmptyState({
  onSelect,
  loader,
}: FeaturedPlayersEmptyStateProps): ReactNode {
  const [players, setPlayers] = useState<PlayerResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loader()
      .then((rows) => {
        if (!cancelled) {
          setPlayers(rows);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loader]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-border bg-surface-alt/50">
        <svg
          className="h-8 w-8 text-fg-dim"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          role="img"
          aria-label="Search"
        >
          <title>Search</title>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
      </div>
      <div>
        <p className="text-sm font-medium text-fg-muted">Search for a player</p>
        <p className="mt-1 text-xs text-fg-dim">
          View career stats, season-by-season breakdowns, awards, shot charts, and more
        </p>
      </div>
      <div className="flex items-center gap-3 text-[10px] text-fg-dim">
        <span className="rounded border border-border/60 px-2 py-0.5">
          Type a player&rsquo;s name
        </span>
        <span className="text-fg-dim/50">or</span>
        <span className="rounded border border-border/60 px-2 py-0.5">Pick a featured player</span>
      </div>
      <div className="w-full max-w-2xl">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-fg-dim">
          Featured Players
        </div>
        {loading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static decorative skeleton
              <Skeleton key={i} height={48} width="100%" />
            ))}
          </div>
        ) : players.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {players.map((p) => (
              <button
                key={p.player_id}
                type="button"
                onClick={() => onSelect(p)}
                className="group flex flex-col items-start rounded border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-primary/60 hover:bg-surface-alt/60"
              >
                <div className="flex w-full items-baseline gap-1">
                  <span className="flex-1 truncate text-xs font-medium text-fg group-hover:text-primary">
                    {p.full_name}
                  </span>
                  {p.position ? (
                    <span className="rounded border border-border/60 bg-surface-alt/40 px-1 text-[9px] font-mono uppercase text-fg-dim">
                      {p.position}
                    </span>
                  ) : null}
                </div>
                <span className="text-[10px] text-fg-dim">
                  {p.from_year}–{p.is_active ? 'Present' : p.to_year}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-fg-dim">No featured players available.</p>
        )}
      </div>
    </div>
  );
}
