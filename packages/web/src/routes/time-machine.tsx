import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { groupAwardsByCategory } from 'data/tabs/time-machine/group-awards';
import type { PlayerDossier } from 'data/tabs/time-machine/queries';
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { z } from 'zod';

import {
  AwardsGrouped,
  AwardVotesStrip,
  CareerTrajectory,
  DossierHeader,
  DraftCombineCard,
  GameLogCard,
  PHASE_IDS,
  type PhaseId,
  SeasonTabs,
  ShotZonesCard,
  STATS_TAB_IDS,
  type StatsTabId,
} from '../components/timeMachine/player-dossier';

/* -------------------------------------------------------------------------- */
/*  Section-level error boundary                                              */
/* -------------------------------------------------------------------------- */

class SectionErrorBoundary extends Component<
  { children: ReactNode; sectionName: string },
  { error: Error | null }
> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn(`[time-machine] ${this.props.sectionName} section failed:`, error, info);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="rounded border border-danger/20 bg-danger/5 p-3 text-xs text-danger/80">
          {this.props.sectionName} data unavailable for this player.
        </div>
      );
    }
    return this.props.children;
  }
}

/* -------------------------------------------------------------------------- */
/*  Skeleton helpers                                                          */
/* -------------------------------------------------------------------------- */

function Skeleton({ className }: { className?: string }): ReactNode {
  return <div className={`animate-pulse rounded bg-surface-alt/60 ${className ?? 'h-3 w-full'}`} />;
}

function HeaderSkeleton(): ReactNode {
  const hdrCells = Array.from({ length: 6 });
  const statCells = Array.from({ length: 9 });
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="h-0.5 w-full bg-gradient-to-r from-primary/60 to-transparent" />
      <div className="space-y-3 p-3">
        <Skeleton className="h-7 w-48" />
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-3">
          {hdrCells.map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static decorative skeleton
            <Skeleton key={i} className="h-3 w-32" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 pt-3 sm:grid-cols-5 md:grid-cols-9">
          {statCells.map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static decorative skeleton
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    </section>
  );
}

function CardSkeleton({ rows = 4 }: { rows?: number }): ReactNode {
  const cells = Array.from({ length: rows });
  return (
    <section>
      <Skeleton className="mb-3 h-3 w-32" />
      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="space-y-2">
          {cells.map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static decorative skeleton
            <Skeleton key={i} className="h-3 w-full" />
          ))}
        </div>
      </div>
    </section>
  );
}

function DossierSkeleton(): ReactNode {
  const sections = Array.from({ length: 5 });
  return (
    <div className="space-y-8">
      <HeaderSkeleton />
      {sections.map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static decorative skeleton
        <CardSkeleton key={i} rows={3 + i} />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Featured players (empty state)                                            */
/* -------------------------------------------------------------------------- */

function FeaturedPlayersEmptyState({
  onSelect,
  loader,
}: {
  onSelect: (p: PlayerResult) => void;
  loader: () => Promise<PlayerResult[]>;
}): ReactNode {
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
              <div key={i} className="h-12 animate-pulse rounded border border-border bg-surface" />
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

interface PlayerResult {
  player_id: string;
  full_name: string;
  from_year: string;
  to_year: string;
  is_active: boolean;
  position?: string | null;
}

const searchPlayersFn = createServerFn({ method: 'POST', strict: { output: false } })
  .inputValidator((data: { search: string }) => data)
  .handler(async ({ data }) => {
    const { query } = await import('data');
    const rows = await query<Record<string, unknown>>(
      `SELECT DISTINCT
              p.person_id AS player_id,
              p.first_name || ' ' || p.last_name AS full_name,
              p.from_year::VARCHAR,
              p.to_year::VARCHAR,
              p.to_year >= 2025 AS is_active,
              (SELECT bp.primary_position
                 FROM main.bridge_player_source_id src
                 JOIN main.dim_bref_player bp
                   ON bp.bref_player_id = src.source_player_id
                WHERE src.person_id = p.person_id
                  AND src.source_system = 'basketball_reference'
                LIMIT 1) AS primary_position
       FROM main.dim_player p
       WHERE p.first_name || ' ' || p.last_name ILIKE $1
       ORDER BY p.first_name, p.last_name
       LIMIT 25`,
      [`%${data.search.trim()}%`],
    );
    return rows.map((r) => ({
      player_id: String(r.player_id),
      full_name: String(r.full_name),
      from_year: String(r.from_year ?? ''),
      to_year: String(r.to_year ?? ''),
      is_active: Boolean(r.is_active),
      position: r.primary_position ? String(r.primary_position) : null,
    }));
  });

const loadPlayerDossierFn = createServerFn({ method: 'POST', strict: { output: false } })
  .inputValidator((data: { playerId: string }) => data)
  .handler(async ({ data }): Promise<PlayerDossier> => {
    const { loadPlayerDossier } = await import('data/tabs/time-machine/queries');
    return loadPlayerDossier(data.playerId);
  });

const loadDefaultPlayerFn = createServerFn({ method: 'GET', strict: { output: false } }).handler(
  async (): Promise<PlayerResult | null> => {
    const { loadDefaultPlayer } = await import('data/tabs/time-machine/queries');
    const row = await loadDefaultPlayer();
    if (!row) return null;
    return {
      player_id: String(row.player_id),
      full_name: String(row.full_name),
      from_year: String(row.from_year ?? ''),
      to_year: String(row.to_year ?? ''),
      is_active: Boolean(row.is_active),
    };
  },
);

const loadFeaturedPlayersFn = createServerFn({ method: 'GET', strict: { output: false } }).handler(
  async (): Promise<PlayerResult[]> => {
    const { loadFeaturedPlayers } = await import('data/tabs/time-machine/queries');
    const rows = await loadFeaturedPlayers();
    return rows.map((r) => ({
      player_id: String(r.player_id),
      full_name: String(r.full_name),
      from_year: String(r.from_year ?? ''),
      to_year: String(r.to_year ?? ''),
      is_active: Boolean(r.is_active),
      position: r.position ? String(r.position) : null,
    }));
  },
);

const loadPlayerByIdFn = createServerFn({ method: 'POST', strict: { output: false } })
  .inputValidator((data: { playerId: string }) => data)
  .handler(async ({ data }): Promise<PlayerResult | null> => {
    const { query } = await import('data');
    const rows = await query<Record<string, unknown>>(
      `SELECT DISTINCT
              p.person_id AS player_id,
              p.first_name || ' ' || p.last_name AS full_name,
              p.from_year::VARCHAR,
              p.to_year::VARCHAR,
              p.to_year >= 2025 AS is_active
       FROM main.dim_player p
       WHERE p.person_id = CAST($1 AS INTEGER)
       LIMIT 1`,
      [data.playerId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      player_id: String(r.player_id),
      full_name: String(r.full_name),
      from_year: String(r.from_year ?? ''),
      to_year: String(r.to_year ?? ''),
      is_active: Boolean(r.is_active),
    };
  });

const timeMachineSearchSchema = z.object({
  pid: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .optional(),
  tab: z.enum(STATS_TAB_IDS).optional().catch(undefined),
  phase: z.enum(PHASE_IDS).optional().catch(undefined),
});

export const Route = createFileRoute('/time-machine')({
  validateSearch: timeMachineSearchSchema,
  component: TimeMachinePage,
});

function TimeMachinePage(): ReactNode {
  const navigate = useNavigate({ from: Route.fullPath });
  const {
    pid: urlPid,
    tab: seasonStatsTab = 'per-game',
    phase: seasonPhase = 'regular',
  } = Route.useSearch();
  const [search, setSearch] = useState('');
  const [players, setPlayers] = useState<PlayerResult[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerResult | null>(null);
  const [dossier, setDossier] = useState<PlayerDossier | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [showDropdown, setShowDropdown] = useState(false);
  const initialLoadDoneRef = useRef(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const setSelectedPlayerId = useCallback(
    (playerId: string | null) => {
      navigate({
        search: (prev) => ({ ...prev, pid: playerId ? Number(playerId) : undefined }),
        replace: true,
      });
    },
    [navigate],
  );

  const setSeasonStatsTab = useCallback(
    (tab: StatsTabId) => {
      navigate({
        search: (prev) => ({ ...prev, tab }),
        replace: true,
      });
    },
    [navigate],
  );

  const setSeasonPhase = useCallback(
    (phase: PhaseId) => {
      navigate({
        search: (prev) => ({ ...prev, phase }),
        replace: true,
      });
    },
    [navigate],
  );

  const searchPlayers = useCallback(async () => {
    if (!search.trim()) return;
    setSearchLoading(true);
    setError(null);
    try {
      const result = await searchPlayersFn({ data: { search } });
      setPlayers(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearchLoading(false);
    }
  }, [search]);

  const loadPlayerData = useCallback(
    async (player: PlayerResult) => {
      setSelectedPlayer(player);
      setSelectedPlayerId(player.player_id);
      setDossier(null);
      setDossierLoading(true);
      setError(null);
      try {
        const result = await loadPlayerDossierFn({ data: { playerId: player.player_id } });
        setDossier(result);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
        setDossier(null);
      } finally {
        setDossierLoading(false);
      }
    },
    [setSelectedPlayerId],
  );

  // Initial load: URL pid → that player; otherwise default to LeBron
  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;
    let cancelled = false;
    const pid = urlPid;
    const setUrlPid = setSelectedPlayerId;
    (async () => {
      setDossierLoading(true);
      setError(null);
      try {
        let player: PlayerResult | null = null;
        if (pid) {
          player = await loadPlayerByIdFn({ data: { playerId: pid } });
        }
        if (!player && !pid) {
          player = await loadDefaultPlayerFn();
        }
        if (cancelled) return;
        if (player) {
          setSelectedPlayer(player);
          const result = await loadPlayerDossierFn({ data: { playerId: player.player_id } });
          if (cancelled) return;
          setDossier(result);
          if (!pid) setUrlPid(player.player_id);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setDossierLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [urlPid, setSelectedPlayerId]);

  const awardsGrouped = dossier ? groupAwardsByCategory(dossier.awards) : [];
  const searchListboxId = 'time-machine-player-search-listbox';
  const activePlayerOptionId =
    showDropdown && highlightIndex >= 0 && players[highlightIndex]
      ? `time-machine-player-option-${players[highlightIndex].player_id}`
      : undefined;

  // Debounced auto-search: fires 300ms after typing stops
  useEffect(() => {
    if (!search.trim()) {
      setPlayers([]);
      setShowDropdown(false);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      setError(null);
      try {
        const result = await searchPlayersFn({ data: { search } });
        setPlayers(result);
        setShowDropdown(true);
        setHighlightIndex(-1);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="flex h-full">
      <div className="w-72 shrink-0 overflow-auto border-r border-border bg-surface p-2">
        <h2 className="mb-1 text-sm font-bold text-primary">Player Search</h2>
        <p className="mb-2 text-[10px] text-fg-dim">Start typing to find any NBA player</p>
        <div ref={searchRef} className="relative mb-2">
          <input
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-controls={searchListboxId}
            aria-expanded={showDropdown && players.length > 0}
            aria-activedescendant={activePlayerOptionId}
            aria-describedby="time-machine-player-search-status"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => players.length > 0 && setShowDropdown(true)}
            onKeyDown={(e) => {
              if (!showDropdown || players.length === 0) {
                if (e.key === 'Enter') void searchPlayers();
                return;
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightIndex((i) => Math.min(i + 1, players.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter' && highlightIndex >= 0) {
                e.preventDefault();
                void loadPlayerData(players[highlightIndex]);
                setShowDropdown(false);
              } else if (e.key === 'Escape') {
                setShowDropdown(false);
              }
            }}
            placeholder="Search any NBA player..."
            className="w-full rounded border border-border bg-bg px-2 py-1.5 pr-7 text-xs text-fg outline-none placeholder:text-fg-dim focus:border-primary"
          />
          {searchLoading && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
          <output id="time-machine-player-search-status" className="sr-only">
            {search.trim() && !searchLoading
              ? `${players.length} player${players.length === 1 ? '' : 's'} found for ${search.trim()}`
              : 'Type to search NBA players'}
          </output>
          {error && (
            <div className="mb-2 rounded bg-danger/10 p-2 text-xs text-danger">{error}</div>
          )}

          {showDropdown && players.length > 0 && (
            <div
              id={searchListboxId}
              role="listbox"
              className="absolute left-0 right-0 top-full z-50 mt-0.5 max-h-64 overflow-auto rounded border border-border bg-surface shadow-lg"
            >
              {players.map((p, idx) => (
                <div
                  key={p.player_id}
                  id={`time-machine-player-option-${p.player_id}`}
                  role="option"
                  aria-selected={idx === highlightIndex}
                  tabIndex={-1}
                  onMouseDown={() => {
                    void loadPlayerData(p);
                    setShowDropdown(false);
                  }}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  className={`block w-full px-2 py-1.5 text-left text-xs transition-colors ${
                    idx === highlightIndex
                      ? 'bg-primary/20 text-fg'
                      : 'text-fg-muted hover:bg-surface-alt'
                  } ${selectedPlayer?.player_id === p.player_id ? 'border-l-2 border-primary' : ''}`}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium">{p.full_name}</span>
                    {p.position ? (
                      <span className="rounded border border-border/60 bg-surface-alt/40 px-1 text-[9px] font-mono uppercase text-fg-dim">
                        {p.position}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-fg-dim">
                    {p.from_year}–{p.is_active ? 'Present' : p.to_year}
                    {p.is_active && <span className="ml-1 text-success">●</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!searchLoading && search.trim() && players.length === 0 && (
            <div className="mt-2 rounded border border-warning/20 bg-warning/5 p-2 text-xs text-warning/90">
              No players found for &ldquo;{search.trim()}&rdquo;
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {selectedPlayer && dossier ? (
          <div className="space-y-8">
            <SectionErrorBoundary sectionName="Player">
              <DossierHeader
                meta={dossier.meta}
                totals={dossier.totals}
                franchise={dossier.franchise}
                isActive={selectedPlayer.is_active}
              />
            </SectionErrorBoundary>
            <SectionErrorBoundary sectionName="Career trajectory">
              <CareerTrajectory perGame={dossier.perGame} />
            </SectionErrorBoundary>
            <SectionErrorBoundary sectionName="Awards">
              <AwardsGrouped groups={awardsGrouped} />
            </SectionErrorBoundary>
            <SectionErrorBoundary sectionName="All-Star">
              <AwardVotesStrip allStar={dossier.allStar} votes={dossier.votes} />
            </SectionErrorBoundary>
            <SectionErrorBoundary sectionName="Season stats">
              <SeasonTabs
                perGame={dossier.perGame}
                playoffPerGame={dossier.playoffPerGame}
                totals={dossier.totalsSeason}
                per36={dossier.per36}
                advanced={dossier.advanced}
                shooting={dossier.shooting}
                playByPlay={dossier.playByPlay}
                awards={dossier.awards}
                activePhase={seasonPhase}
                activeTab={seasonStatsTab}
                onPhaseChange={setSeasonPhase}
                onTabChange={setSeasonStatsTab}
              />
            </SectionErrorBoundary>
            <SectionErrorBoundary sectionName="Shot zones">
              <ShotZonesCard zones={dossier.shotZones} />
            </SectionErrorBoundary>
            <SectionErrorBoundary sectionName="Recent games">
              <GameLogCard rows={dossier.gameLog} />
            </SectionErrorBoundary>
            <SectionErrorBoundary sectionName="Draft & combine">
              <DraftCombineCard draft={dossier.draft} combine={dossier.combine} />
            </SectionErrorBoundary>
          </div>
        ) : selectedPlayer && dossierLoading ? (
          <div>
            <div className="mb-4 flex items-center gap-2 text-xs text-fg-dim">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span>
                Loading <span className="font-medium text-fg">{selectedPlayer.full_name}</span>…
              </span>
            </div>
            <DossierSkeleton />
          </div>
        ) : selectedPlayer && !dossierLoading && !dossier?.meta ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-danger/80">
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              role="img"
              aria-label="Error"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              />
            </svg>
            No data returned for this player.
          </div>
        ) : !selectedPlayer && !dossierLoading ? (
          <FeaturedPlayersEmptyState
            onSelect={(p) => {
              void loadPlayerData(p);
            }}
            loader={loadFeaturedPlayersFn}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
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
                Type a player's name
              </span>
              <span className="text-fg-dim/50">or</span>
              <span className="rounded border border-border/60 px-2 py-0.5">
                Select from results
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
