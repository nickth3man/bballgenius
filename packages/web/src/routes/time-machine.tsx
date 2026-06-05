import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { stripAnsi } from 'data/formatters';
import type { CareerStatRow, PlayerAwardRow } from 'data/tabs/time-machine/queries';
import { type ReactNode, useCallback, useState } from 'react';

type Row = Record<string, unknown>;

interface PlayerResult {
  player_id: string;
  full_name: string;
  from_year: string;
  to_year: string;
  is_active: boolean;
}

interface PlayerStatsResponse {
  stats: string[];
  awards: PlayerAwardRow[];
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

const loadPlayerDataFn = createServerFn({ method: 'POST', strict: { output: false } })
  .inputValidator((data: { playerId: string }) => data)
  .handler(async ({ data }): Promise<PlayerStatsResponse> => {
    // Career stats and awards live in the schema-aware queries module which knows
    // the right tables/columns (fact_player_awards is the only awards table, and
    // per-game stats live in main.fact_player_game_stats behind a person_id join
    // — we surface season-level rows here since that's the curated star tier).
    const { loadCareerStats, loadPlayerAwards } = await import('data/tabs/time-machine/queries');
    const { formatTable } = await import('data/formatters');

    const [statRows, awardRows] = await Promise.all([
      loadCareerStats(data.playerId),
      loadPlayerAwards(data.playerId),
    ]);

    const headers = ['Season', 'Type', 'GP', 'GS', 'MIN', 'PTS', 'AST', 'REB', 'STL', 'BLK'];
    const tableRows = statRows.map((r: CareerStatRow) => ({
      Season: r.season_year,
      Type: r.is_playoffs ? 'Playoffs' : 'Regular',
      GP: r.gp,
      GS: r.gs ?? '-',
      MIN: r.min,
      PTS: r.pts,
      AST: r.ast,
      REB: r.reb ?? '-',
      STL: r.stl ?? '-',
      BLK: r.blk ?? '-',
    }));
    return {
      stats: formatTable(headers, tableRows as unknown as Row[]),
      awards: awardRows,
    };
  });

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
      const { stats: statLines, awards: awardRows } = await loadPlayerDataFn({
        data: { playerId: player.player_id },
      });
      setStats(statLines);
      setAwards(awardRows);
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
                {awards.map((a) => (
                  <span
                    key={`${a.award}-${a.season_year}-${a.count}`}
                    className="rounded bg-secondary/20 px-2 py-0.5 text-xs text-secondary"
                  >
                    {a.award} ({a.season_year})
                  </span>
                ))}
              </div>
            )}
            {stats.length > 0 && (
              <div className="overflow-auto rounded border border-border">
                {stats.map((line) => (
                  <div
                    key={line}
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
