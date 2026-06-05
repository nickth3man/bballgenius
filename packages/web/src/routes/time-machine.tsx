import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { groupAwardsByCategory } from 'data/tabs/time-machine/group-awards';
import type { PlayerDossier } from 'data/tabs/time-machine/queries';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  AwardsGrouped,
  AwardVotesStrip,
  DossierHeader,
  DraftCombineCard,
  GameLogCard,
  SeasonTabs,
  ShotZonesCard,
} from '../components/timeMachine/player-dossier';

interface PlayerResult {
  player_id: string;
  full_name: string;
  from_year: string;
  to_year: string;
  is_active: boolean;
}

const searchPlayersFn = createServerFn({ method: 'POST', strict: { output: false } })
  .inputValidator((data: { search: string }) => data)
  .handler(async ({ data }) => {
    const { query } = await import('data');
    const rows = await query<Record<string, unknown>>(
      `SELECT DISTINCT p.player_id, p.full_name, p.from_year::VARCHAR, p.to_year::VARCHAR, p.is_active
       FROM dim_player p
       WHERE p.full_name ILIKE $1
       ORDER BY p.full_name
       LIMIT 25`,
      [`%${data.search.trim()}%`],
    );
    return rows.map((r) => ({
      player_id: String(r.player_id),
      full_name: String(r.full_name),
      from_year: String(r.from_year ?? ''),
      to_year: String(r.to_year ?? ''),
      is_active: Boolean(r.is_active),
    }));
  });

const loadPlayerDossierFn = createServerFn({ method: 'POST', strict: { output: false } })
  .inputValidator((data: { playerId: string }) => data)
  .handler(async ({ data }): Promise<PlayerDossier> => {
    const { loadPlayerDossier } = await import('data/tabs/time-machine/queries');
    return loadPlayerDossier(data.playerId);
  });

export const Route = createFileRoute('/time-machine')({
  component: TimeMachinePage,
});

function TimeMachinePage(): ReactNode {
  const [search, setSearch] = useState('');
  const [players, setPlayers] = useState<PlayerResult[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerResult | null>(null);
  const [dossier, setDossier] = useState<PlayerDossier | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const searchPlayers = useCallback(async () => {
    if (!search.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await searchPlayersFn({ data: { search } });
      setPlayers(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [search]);

  const loadPlayerData = useCallback(async (player: PlayerResult) => {
    setSelectedPlayer(player);
    setLoading(true);
    setError(null);
    try {
      const result = await loadPlayerDossierFn({ data: { playerId: player.player_id } });
      setDossier(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setDossier(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const awardsGrouped = dossier ? groupAwardsByCategory(dossier.awards) : [];

  // Debounced auto-search: fires 300ms after typing stops
  useEffect(() => {
    if (!search.trim()) {
      setPlayers([]);
      setShowDropdown(false);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await searchPlayersFn({ data: { search } });
        setPlayers(result);
        setShowDropdown(true);
        setHighlightIndex(-1);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
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
        <h2 className="mb-2 text-sm font-bold text-primary">Player Search</h2>
        <div className="relative mb-2">
          <input
            type="text"
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
          {loading && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
        </div>
        <div ref={searchRef} className="relative">
          {error && (
            <div className="mb-2 rounded bg-danger/10 p-2 text-xs text-danger">{error}</div>
          )}

          {showDropdown && players.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-0.5 max-h-64 overflow-auto rounded border border-border bg-surface shadow-lg">
              {players.map((p, idx) => (
                <button
                  key={p.player_id}
                  type="button"
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
                  <div className="font-medium">{p.full_name}</div>
                  <div className="text-fg-dim">
                    {p.from_year}–{p.is_active ? 'Present' : p.to_year}
                    {p.is_active && <span className="ml-1 text-success">●</span>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {!loading && search.trim() && players.length === 0 && !showDropdown && (
            <div className="text-fg-dim text-xs italic">No players found</div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {selectedPlayer && dossier ? (
          <div className="space-y-6">
            <DossierHeader
              meta={dossier.meta}
              totals={dossier.totals}
              franchise={dossier.franchise}
              isActive={selectedPlayer.is_active}
            />
            <AwardsGrouped groups={awardsGrouped} />
            <AwardVotesStrip allStar={dossier.allStar} votes={dossier.votes} />
            <SeasonTabs
              perGame={dossier.perGame}
              totals={dossier.totalsSeason}
              per36={dossier.per36}
              advanced={dossier.advanced}
              shooting={dossier.shooting}
              playByPlay={dossier.playByPlay}
            />
            <ShotZonesCard zones={dossier.shotZones} />
            <GameLogCard rows={dossier.gameLog} />
            <DraftCombineCard draft={dossier.draft} combine={dossier.combine} />
          </div>
        ) : selectedPlayer && loading ? (
          <div className="text-fg-dim text-sm">Loading player dossier…</div>
        ) : selectedPlayer && !loading ? (
          <div className="text-fg-dim text-sm">No data returned for this player.</div>
        ) : (
          <div className="flex h-full items-center justify-center text-fg-dim text-sm">
            Search for a player to view career stats, awards, and more
          </div>
        )}
      </div>
    </div>
  );
}
