import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import type { PlayerDossier } from 'data/tabs/time-machine/queries';
import { groupAwardsByCategory } from 'data/tabs/time-machine/queries';
import { type ReactNode, useCallback, useState } from 'react';
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

  return (
    <div className="flex h-full">
      <div className="w-72 shrink-0 overflow-auto border-r border-border bg-surface p-2">
        <h2 className="mb-2 text-sm font-bold text-primary">Player Search</h2>
        <div className="mb-2 flex gap-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchPlayers()}
            placeholder="Type a player name..."
            className="flex-1 rounded border border-border bg-bg px-2 py-1 text-xs text-fg outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={searchPlayers}
            disabled={loading}
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-bg hover:bg-primary/90 disabled:opacity-50"
          >
            Go
          </button>
        </div>
        {error && <div className="mb-2 rounded bg-danger/10 p-2 text-xs text-danger">{error}</div>}
        {loading && <div className="text-xs text-fg-muted">Searching...</div>}
        {players.length === 0 && !loading ? (
          <div className="text-fg-dim text-xs italic">No players found</div>
        ) : null}
        {players.map((p) => (
          <button
            key={p.player_id}
            type="button"
            onClick={() => loadPlayerData(p)}
            className={`mb-0.5 block w-full rounded px-2 py-1 text-left text-xs transition-colors hover:bg-surface-alt ${
              selectedPlayer?.player_id === p.player_id ? 'bg-primary/20 text-fg' : 'text-fg-muted'
            }`}
          >
            <div className="font-medium">{p.full_name}</div>
            <div className="text-fg-dim">
              {p.from_year}–{p.is_active ? 'Present' : p.to_year}
              {p.is_active && <span className="ml-1 text-success">●</span>}
            </div>
          </button>
        ))}
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
