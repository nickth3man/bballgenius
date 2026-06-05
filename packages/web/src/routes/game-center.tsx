import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import type { ReactNode } from 'react';
import { useState } from 'react';

const loadRecentGames = createServerFn({ method: 'GET' }).handler(async () => {
  const { initDb, query } = await import('data');
  await initDb();
  const rows = await query<RecentGameRow>(`
    WITH team_dedup AS (
      SELECT DISTINCT ON (team_id) team_id, team_abbrev, team_name
      FROM dim_team ORDER BY team_id, season_active_till DESC
    )
    SELECT g.game_id, g.game_date, g.season_year,
      t_home.team_abbrev AS home_team, t_away.team_abbrev AS away_team,
      t_home.team_name AS home_name, t_away.team_name AS away_name
    FROM dim_game g
    JOIN team_dedup t_home ON g.home_team_id = t_home.team_id
    JOIN team_dedup t_away ON g.away_team_id = t_away.team_id
    ORDER BY g.game_date DESC
    LIMIT 40
  `);
  return rows;
});

const loadBoxScoreFn = createServerFn({ method: 'POST', strict: { output: false } })
  .inputValidator((data: { gameId: string }) => data)
  .handler(async ({ data }) => {
    // Per-game box scores live in `main` (NBA-API shape) where the player key is
    // `person_id` and minutes are `num_minutes`. Join through `main.dim_player`
    // to surface a `full_name` since that dim doesn't carry one pre-concatenated.
    const { query } = await import('data');
    const rows = await query<Record<string, unknown>>(
      `SELECT pgs.person_id,
              p.first_name || ' ' || p.last_name AS full_name,
              pgs.points, pgs.assists, pgs.reb, pgs.steals, pgs.blocks,
              pgs.num_minutes AS minutes
       FROM main.fact_player_game_stats pgs
       JOIN main.dim_player p ON pgs.person_id = p.person_id
       WHERE pgs.game_id = $1
       ORDER BY pgs.points DESC`,
      [data.gameId],
    );
    return rows;
  });

const loadShotsFn = createServerFn({ method: 'POST', strict: { output: false } })
  .inputValidator((data: { gameId: string }) => data)
  .handler(async () => {
    // The current warehouse exposes box-score player game stats but not
    // shot-location columns (action_type, shot_result, x, y). Return an empty
    // set so the UI can show its existing "No shot data available" state
    // instead of issuing an invalid SQL query.
    return [] as Record<string, unknown>[];
  });

interface RecentGameRow {
  game_id: string;
  game_date: string;
  season_year: string;
  home_team: string;
  away_team: string;
  home_name: string;
  away_name: string;
}

export const Route = createFileRoute('/game-center')({
  component: GameCenterPage,
});

function GameCenterPage(): ReactNode {
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'boxscore' | 'shotchart'>('list');

  const { data: games, isLoading } = useQuery<RecentGameRow[]>({
    queryKey: ['recentGames'],
    queryFn: () => loadRecentGames(),
  });

  const { data: boxScore } = useQuery({
    queryKey: ['boxscore', selectedGame],
    queryFn: async () => {
      if (!selectedGame) return null;
      return (await loadBoxScoreFn({ data: { gameId: selectedGame } })) as Record<
        string,
        unknown
      >[];
    },
    enabled: !!selectedGame,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted">Loading games...</div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="w-72 shrink-0 overflow-auto border-r border-border bg-surface p-2">
        <h2 className="mb-2 text-sm font-bold text-primary">Recent Games</h2>
        {games?.map((g) => (
          <button
            key={g.game_id}
            type="button"
            onClick={() => {
              setSelectedGame(g.game_id);
              setView('boxscore');
            }}
            className={`mb-0.5 block w-full rounded px-2 py-1 text-left text-xs transition-colors hover:bg-surface-alt ${
              selectedGame === g.game_id ? 'bg-primary/20 text-fg' : 'text-fg-muted'
            }`}
          >
            <div className="font-medium">
              {g.away_team} @ {g.home_team}
            </div>
            <div className="text-fg-dim">{g.game_date}</div>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {selectedGame && boxScore ? (
          <div>
            <div className="mb-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setView('boxscore')}
                className={`rounded px-3 py-1 text-sm ${view === 'boxscore' ? 'bg-primary text-bg' : 'bg-surface text-fg-muted'}`}
              >
                Box Score
              </button>
              <button
                type="button"
                onClick={() => setView('shotchart')}
                className={`rounded px-3 py-1 text-sm ${view === 'shotchart' ? 'bg-primary text-bg' : 'bg-surface text-fg-muted'}`}
              >
                Shot Chart
              </button>
            </div>
            {view === 'boxscore' && <BoxScoreTable rows={boxScore} />}
            {view === 'shotchart' && <ShotChart gameId={selectedGame} />}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-fg-dim text-sm">
            Select a game to view box score and shot chart
          </div>
        )}
      </div>
    </div>
  );
}

function BoxScoreTable({ rows }: { rows: Record<string, unknown>[] }): ReactNode {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border text-fg-dim">
          <th className="px-2 py-1 text-left">Player</th>
          <th className="px-2 py-1 text-right">PTS</th>
          <th className="px-2 py-1 text-right">AST</th>
          <th className="px-2 py-1 text-right">REB</th>
          <th className="px-2 py-1 text-right">STL</th>
          <th className="px-2 py-1 text-right">BLK</th>
          <th className="px-2 py-1 text-right">MIN</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={String(r.person_id ?? r.full_name)}
            className="border-b border-surface-alt hover:bg-surface-alt/50"
          >
            <td className="px-2 py-1">{String(r.full_name ?? '')}</td>
            <td className="px-2 py-1 text-right">{String(r.points ?? '-')}</td>
            <td className="px-2 py-1 text-right">{String(r.assists ?? '-')}</td>
            <td className="px-2 py-1 text-right">{String(r.reb ?? '-')}</td>
            <td className="px-2 py-1 text-right">{String(r.steals ?? '-')}</td>
            <td className="px-2 py-1 text-right">{String(r.blocks ?? '-')}</td>
            <td className="px-2 py-1 text-right">{String(r.minutes ?? '-')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ShotChart({ gameId }: { gameId: string }): ReactNode {
  const { data: shots } = useQuery({
    queryKey: ['shots', gameId],
    queryFn: async () => {
      if (!gameId) return [];
      return (await loadShotsFn({ data: { gameId } })) as Record<string, unknown>[];
    },
  });

  if (!shots?.length) {
    return <div className="text-fg-dim text-sm">No shot data available.</div>;
  }

  const courtWidth = 300;
  const courtHeight = 280;
  const hoopRadius = 8;

  return (
    <svg viewBox={`0 0 ${courtWidth} ${courtHeight}`} className="w-full max-w-sm">
      <title>Shot chart</title>
      <rect x={0} y={0} width={courtWidth} height={courtHeight} fill="#1a1b26" />
      <line
        x1={courtWidth / 2}
        y1={courtHeight}
        x2={courtWidth / 2}
        y2={0}
        stroke="#2f3549"
        strokeWidth={1}
      />
      <circle
        cx={courtWidth / 2}
        cy={courtHeight / 2 - 60}
        r={60}
        fill="none"
        stroke="#2f3549"
        strokeWidth={1}
      />
      <rect
        x={courtWidth / 2 - 20}
        y={courtHeight / 2 - 120}
        width={40}
        height={5}
        fill="#2f3549"
      />
      <circle
        cx={courtWidth / 2}
        cy={courtHeight / 2 - 120}
        r={hoopRadius}
        fill="none"
        stroke="#7aa2f7"
        strokeWidth={1.5}
      />
      {shots.map((s) => {
        const made = String(s.shot_result).toLowerCase() === 'made';
        const x = Number(s.x ?? 0);
        const y = Number(s.y ?? 0);
        const screenX = courtWidth / 2 + x * 5;
        const screenY = courtHeight - y * 4;
        const key = `${x},${y}`;
        return (
          <circle
            key={key}
            cx={screenX}
            cy={screenY}
            r={3}
            fill={made ? '#9ece6a' : '#f7768e'}
            opacity={0.8}
          />
        );
      })}
    </svg>
  );
}
