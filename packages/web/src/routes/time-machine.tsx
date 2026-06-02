import { createFileRoute } from '@tanstack/react-router';
import type { PlayerAwardRow } from 'data/tabs/time-machine/queries';
import { type ReactNode, useCallback, useState } from 'react';

type Row = Record<string, unknown>;

async function loadDataPackage() {
  return import('data');
}

interface PlayerResult {
  player_id: string;
  full_name: string;
  from_year: string;
  to_year: string;
  is_active: boolean;
}

export const Route = createFileRoute('/time-machine')({
  component: TimeMachinePage,
});

function TimeMachinePage(): ReactNode {
  const [search, setSearch] = useState('');
  const [players, setPlayers] = useState<PlayerResult[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerResult | null>(null);
  const [stats, setStats] = useState<string[]>([]);
  const [awards, setAwards] = useState<PlayerAwardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchPlayers = useCallback(async () => {
    if (!search.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const m = await loadDataPackage();
      const rows = await m.query<Record<string, unknown>>(
        `SELECT DISTINCT p.player_id, p.full_name, p.from_year::VARCHAR, p.to_year::VARCHAR, p.is_active
         FROM dim_player p
         WHERE p.full_name ILIKE $1
         ORDER BY p.full_name
         LIMIT 25`,
        [`%${search.trim()}%`],
      );
      type RawRow = Record<string, unknown>;
      setPlayers(
        rows.map((r: RawRow) => ({
          player_id: String(r.player_id),
          full_name: String(r.full_name),
          from_year: String(r.from_year ?? ''),
          to_year: String(r.to_year ?? ''),
          is_active: Boolean(r.is_active),
        })),
      );
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
      const m = await loadDataPackage();
      const statRows = await m.query<Record<string, unknown>>(
        `SELECT pgs.season_year, t.team_abbrev,
          pgs.points, pgs.assists, pgs.reb, pgs.steals, pgs.blocks, pgs.min
         FROM fact_player_game_stats pgs
         JOIN dim_team t ON pgs.team_id = t.team_id
         WHERE pgs.player_id = $1
         ORDER BY pgs.season_year DESC
         LIMIT 30`,
        [player.player_id],
      );

      const awardRows = await m.query<Record<string, unknown>>(
        `SELECT award, season_year, COUNT(*) AS count
         FROM dim_player_award
         WHERE player_id = $1
         GROUP BY award, season_year
         ORDER BY season_year DESC`,
        [player.player_id],
      );

      const headers = ['Season', 'Team', 'PTS', 'AST', 'REB', 'STL', 'BLK', 'MIN'];
      const rows = statRows.map((r: Record<string, unknown>) => ({
        Season: r.season_year,
        Team: r.team_abbrev,
        PTS: r.points,
        AST: r.assists,
        REB: r.reb,
        STL: r.steals,
        BLK: r.blocks,
        MIN: r.min,
      }));
      setStats(formatTable(headers, rows as unknown as Row[]));
      setAwards(awardRows as unknown as PlayerAwardRow[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

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
        {selectedPlayer ? (
          <div>
            <h3 className="mb-4 text-lg font-bold text-fg">{selectedPlayer.full_name}</h3>
            {awards.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1">
                {awards.map((a, i) => (
                  <span
                    key={`${a.award}-${a.season_year}-${i}`}
                    className="rounded bg-secondary/20 px-2 py-0.5 text-xs text-secondary"
                  >
                    {a.award} ({a.season_year})
                  </span>
                ))}
              </div>
            )}
            {stats.length > 0 && (
              <div className="overflow-auto rounded border border-border">
                {stats.map((line, i) => (
                  <div
                    key={i}
                    className="whitespace-pre border-b border-surface-alt px-2 py-0.5 font-mono text-xs text-fg-muted last:border-b-0"
                  >
                    {stripAnsi(line)}
                  </div>
                ))}
              </div>
            )}
            {!loading && stats.length === 0 && (
              <div className="text-fg-dim text-sm">No stats found for this player.</div>
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-fg-dim text-sm">
            Search for a player to view career stats, awards, and more
          </div>
        )}
      </div>
    </div>
  );
}
