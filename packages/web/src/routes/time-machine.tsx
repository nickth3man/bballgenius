import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { groupAwardsByCategory } from 'data/tabs/time-machine/group-awards';
import type { PlayerDossier } from 'data/tabs/time-machine/queries';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
} from '../components/timeMachine/dossier';
import { DossierSkeleton } from '../components/timeMachine/dossier-skeleton.js';
import { FeaturedPlayersEmptyState } from '../components/timeMachine/empty-state.js';
import { TimeMachineSearchPanel } from '../components/timeMachine/search-panel.js';
import { SectionErrorBoundary } from '../components/ui';
import {
  loadDefaultPlayerFn,
  loadFeaturedPlayersFn,
  loadPlayerByIdFn,
  loadPlayerDossierFn,
  type PlayerResult,
  searchPlayersFn,
} from './time-machine/server-fns.js';

const timeMachineSearchSchema = z.object({
  pid: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .optional(),
  tab: z.enum(STATS_TAB_IDS).optional().catch(undefined),
  phase: z.enum(PHASE_IDS).optional().catch(undefined),
  sort: z.string().optional().catch(undefined),
  dir: z.enum(['asc', 'desc']).optional().catch(undefined),
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
    sort: urlSort,
    dir: urlDir,
  } = Route.useSearch();
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerResult | null>(null);
  const [dossier, setDossier] = useState<PlayerDossier | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialLoadDoneRef = useRef(false);

  const setSelectedPlayerId = useCallback(
    (playerId: string | null) => {
      void navigate({
        search: (prev) => ({ ...prev, pid: playerId ? Number(playerId) : undefined }),
        replace: true,
      });
    },
    [navigate],
  );

  const setSeasonStatsTab = useCallback(
    (tab: StatsTabId) => {
      void navigate({
        search: (prev) => ({ ...prev, tab }),
        replace: true,
      });
    },
    [navigate],
  );

  const setSeasonPhase = useCallback(
    (phase: PhaseId) => {
      void navigate({
        search: (prev) => ({ ...prev, phase }),
        replace: true,
      });
    },
    [navigate],
  );

  const setSortParams = useCallback(
    (col: string | null, dir: 'asc' | 'desc' | null) => {
      void navigate({
        search: (prev) => ({
          ...prev,
          sort: col ?? undefined,
          dir: dir ?? undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

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

  const handleSearch = useCallback(async (query: string): Promise<PlayerResult[]> => {
    return searchPlayersFn({ data: { search: query } });
  }, []);

  // Initial load: URL pid → that player; otherwise default to LeBron
  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;
    let cancelled = false;
    const pid = urlPid;
    const setUrlPid = setSelectedPlayerId;
    void (async () => {
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

  return (
    <div className="flex h-full">
      <TimeMachineSearchPanel
        onSearch={handleSearch}
        onSelectPlayer={(p) => void loadPlayerData(p)}
        selectedPlayerId={selectedPlayer?.player_id ?? null}
      />

      <div className="flex-1 overflow-auto p-4">
        {error && <div className="mb-4 rounded bg-danger/10 p-2 text-xs text-danger">{error}</div>}
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
              {(() => {
                const allStarSet = dossier.allStar
                  ? new Set(
                      dossier.allStar
                        .map((s) => s.season_end_year)
                        .filter((y): y is number => y != null),
                    )
                  : undefined;
                const playerKey = dossier.meta?.person_id ?? undefined;
                return (
                  <CareerTrajectory
                    perGame={dossier.perGame}
                    {...(playerKey !== undefined ? { playerKey } : {})}
                    {...(allStarSet !== undefined ? { allStarSeasons: allStarSet } : {})}
                  />
                );
              })()}
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
                onSortChange={setSortParams}
                onPhaseChange={setSeasonPhase}
                onTabChange={setSeasonStatsTab}
                {...(urlSort !== undefined ? { activeSort: urlSort } : {})}
                {...(urlDir !== undefined ? { activeSortDir: urlDir } : {})}
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
                Type a player&rsquo;s name
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
