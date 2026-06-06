import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import type { BoxScoreRow, GameShotRow, RecentGameRow } from 'data/tabs/game-center/queries';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { DualShotChart } from '../components/shotChart/index.js';
import { Card, StatTile, Tabs, TeamCrest } from '../components/ui';
import { teamColor } from '../lib/teamColors';

const loadRecentGames = createServerFn({ method: 'GET' }).handler(async () => {
  const { loadRecentGames } = await import('data/tabs/game-center/queries');
  return loadRecentGames(40);
});

const loadBoxScoreFn = createServerFn({ method: 'POST', strict: { output: false } })
  .inputValidator((data: { gameId: string }) => data)
  .handler(async ({ data }) => {
    const { loadBoxScoreWithTeamDedup } = await import('data/tabs/game-center/queries');
    return loadBoxScoreWithTeamDedup(data.gameId);
  });

const loadShotsFn = createServerFn({ method: 'POST', strict: { output: false } })
  .inputValidator((data: { gameId: string }) => data)
  .handler(async ({ data }) => {
    const { loadGameShots } = await import('data/tabs/game-center/queries');
    return loadGameShots(data.gameId);
  });

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

  const selectedGameMeta = useMemo(
    () => games?.find((g) => g.game_id === selectedGame) ?? null,
    [games, selectedGame],
  );

  const { data: boxScore } = useQuery<BoxScoreRow[]>({
    queryKey: ['boxscore', selectedGame],
    queryFn: async () => {
      if (!selectedGame) return [];
      return (await loadBoxScoreFn({ data: { gameId: selectedGame } })) as BoxScoreRow[];
    },
    enabled: !!selectedGame,
  });

  const { data: shots } = useQuery<GameShotRow[]>({
    queryKey: ['shots', selectedGame],
    queryFn: async () => {
      if (!selectedGame) return [];
      return (await loadShotsFn({ data: { gameId: selectedGame } })) as GameShotRow[];
    },
    enabled: !!selectedGame,
  });

  const scoreByTeam = useMemo(() => {
    if (!boxScore) return { away: 0, home: 0 };
    const away = boxScore.filter((r) => !r.is_home).reduce((s, r) => s + Number(r.points ?? 0), 0);
    const home = boxScore.filter((r) => r.is_home).reduce((s, r) => s + Number(r.points ?? 0), 0);
    return { away, home };
  }, [boxScore]);

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
            {selectedGameMeta && (
              <ScoreBanner
                awayAbbrev={selectedGameMeta.away_team}
                homeAbbrev={selectedGameMeta.home_team}
                awayName={selectedGameMeta.away_name}
                homeName={selectedGameMeta.home_name}
                awayScore={scoreByTeam.away}
                homeScore={scoreByTeam.home}
                gameDate={selectedGameMeta.game_date}
                seasonYear={selectedGameMeta.season_year}
              />
            )}
            <div className="mb-4">
              <Tabs
                tabs={[
                  { id: 'boxscore', label: 'Box Score' },
                  { id: 'shotchart', label: 'Shot Chart' },
                ]}
                value={view === 'shotchart' ? 'shotchart' : 'boxscore'}
                onChange={(id) => setView(id as 'boxscore' | 'shotchart')}
                variant="segmented"
                size="sm"
              />
            </div>
            {view === 'boxscore' && <SplitBoxScore rows={boxScore} />}
            {view === 'shotchart' && (
              <div className="w-full">
                {!shots || !boxScore ? (
                  <div className="text-fg-dim text-sm">Loading shot data...</div>
                ) : shots.length === 0 ? (
                  <div className="text-fg-dim text-sm">No shot data available.</div>
                ) : selectedGameMeta ? (
                  <DualShotChart
                    shots={shots}
                    boxScore={boxScore}
                    homeAbbrev={selectedGameMeta.home_team}
                    awayAbbrev={selectedGameMeta.away_team}
                  />
                ) : null}
              </div>
            )}
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

function ScoreBanner(props: {
  awayAbbrev: string;
  homeAbbrev: string;
  awayName: string;
  homeName: string;
  awayScore: number;
  homeScore: number;
  gameDate: string;
  seasonYear: string;
}): ReactNode {
  const { awayAbbrev, homeAbbrev, awayName, homeName, awayScore, homeScore, gameDate, seasonYear } =
    props;
  return (
    <Card accent="primary" pad="md" style={{ marginBottom: 12 }}>
      <div className="flex items-center justify-between gap-6">
        <div className="flex flex-1 items-center gap-3">
          <TeamCrest abbrev={awayAbbrev} color={teamColor(awayAbbrev)} size={48} shape="square" />
          <div>
            <div className="text-xs text-fg-dim">{awayName}</div>
            <StatTile label="Away" value={awayScore} size="lg" />
          </div>
        </div>
        <div className="text-xs font-bold uppercase tracking-widest text-accent">Final</div>
        <div className="flex flex-1 items-center justify-end gap-3">
          <div className="text-right">
            <div className="text-xs text-fg-dim">{homeName}</div>
            <StatTile label="Home" value={homeScore} size="lg" style={{ alignItems: 'flex-end' }} />
          </div>
          <TeamCrest abbrev={homeAbbrev} color={teamColor(homeAbbrev)} size={48} shape="square" />
        </div>
      </div>
      <div className="mt-3 text-xs text-fg-dim">
        {gameDate} &middot; {seasonYear}
      </div>
    </Card>
  );
}

const COLS: { key: string; label: string; cls: string }[] = [
  { key: 'min', label: 'MIN', cls: 'text-right w-[40px]' },
  { key: 'points', label: 'PTS', cls: 'text-right w-[40px]' },
  { key: 'fg', label: 'FG', cls: 'text-right w-[55px]' },
  { key: 'fg3', label: '3PT', cls: 'text-right w-[55px]' },
  { key: 'ft', label: 'FT', cls: 'text-right w-[55px]' },
  { key: 'oreb', label: 'OREB', cls: 'text-right w-[40px]' },
  { key: 'dreb', label: 'DREB', cls: 'text-right w-[40px]' },
  { key: 'reb', label: 'REB', cls: 'text-right w-[40px]' },
  { key: 'assists', label: 'AST', cls: 'text-right w-[40px]' },
  { key: 'steals', label: 'STL', cls: 'text-right w-[40px]' },
  { key: 'blocks', label: 'BLK', cls: 'text-right w-[40px]' },
  { key: 'turnovers', label: 'TO', cls: 'text-right w-[40px]' },
  { key: 'fouls_personal', label: 'PF', cls: 'text-right w-[40px]' },
  { key: 'plus_minus', label: '+/-', cls: 'text-right w-[45px]' },
];

function n(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const num = Number(v);
  return Number.isFinite(num) ? num : 0;
}

function fmtMin(v: unknown): string {
  const num = n(v);
  if (num === 0) return '-';
  if (Number.isInteger(num)) return String(num);
  return num.toFixed(1);
}

function fmtPct(v: unknown): string {
  const num = n(v);
  if (num === 0) return '.000';
  return num.toFixed(3).replace(/^0/, '');
}

function fmtSigned(v: unknown): string {
  const num = n(v);
  if (num === 0) return '0';
  return num > 0 ? `+${num}` : String(num);
}

function TeamBoxScoreTable(props: {
  teamAbbrev: string;
  isHome: boolean;
  rows: BoxScoreRow[];
}): ReactNode {
  const { teamAbbrev, isHome, rows } = props;
  const totals = rows.reduce(
    (acc, r) => {
      acc.min += n(r.min);
      acc.points += n(r.points);
      acc.fgm += n(r.fgm);
      acc.fga += n(r.fga);
      acc.fg3m += n(r.fg3m);
      acc.fg3a += n(r.fg3a);
      acc.ftm += n(r.ftm);
      acc.fta += n(r.fta);
      acc.oreb += n(r.oreb);
      acc.dreb += n(r.dreb);
      acc.reb += n(r.reb);
      acc.assists += n(r.assists);
      acc.steals += n(r.steals);
      acc.blocks += n(r.blocks);
      acc.turnovers += n(r.turnovers);
      acc.fouls_personal += n(r.fouls_personal);
      return acc;
    },
    {
      min: 0,
      points: 0,
      fgm: 0,
      fga: 0,
      fg3m: 0,
      fg3a: 0,
      ftm: 0,
      fta: 0,
      oreb: 0,
      dreb: 0,
      reb: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      fouls_personal: 0,
    },
  );
  const totalFgPct = totals.fga > 0 ? totals.fgm / totals.fga : 0;
  const totalFg3Pct = totals.fg3a > 0 ? totals.fg3m / totals.fg3a : 0;
  const totalFtPct = totals.fta > 0 ? totals.ftm / totals.fta : 0;

  return (
    <div className="mb-6">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-base font-bold text-primary">{teamAbbrev}</span>
        <span className="text-fg-dim text-xs">{isHome ? 'Home' : 'Away'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-fg-dim">
              <th className="px-2 py-1 text-left min-w-[140px]">Player</th>
              {COLS.map((c) => (
                <th key={c.key} className={`px-2 py-1 ${c.cls}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={String(r.player_id)}
                className="border-b border-surface-alt hover:bg-surface-alt/50"
              >
                <td className="px-2 py-1 text-left">{r.full_name}</td>
                <td className="px-2 py-1 text-right w-[40px]">{fmtMin(r.min)}</td>
                <td className="px-2 py-1 text-right w-[40px]">{n(r.points) || '-'}</td>
                <td className="px-2 py-1 text-right w-[55px]">{`${n(r.fgm)}-${n(r.fga)}`}</td>
                <td className="px-2 py-1 text-right w-[55px]">{`${n(r.fg3m)}-${n(r.fg3a)}`}</td>
                <td className="px-2 py-1 text-right w-[55px]">{`${n(r.ftm)}-${n(r.fta)}`}</td>
                <td className="px-2 py-1 text-right w-[40px]">{n(r.oreb) || '-'}</td>
                <td className="px-2 py-1 text-right w-[40px]">{n(r.dreb) || '-'}</td>
                <td className="px-2 py-1 text-right w-[40px]">{n(r.reb) || '-'}</td>
                <td className="px-2 py-1 text-right w-[40px]">{n(r.assists) || '-'}</td>
                <td className="px-2 py-1 text-right w-[40px]">{n(r.steals) || '-'}</td>
                <td className="px-2 py-1 text-right w-[40px]">{n(r.blocks) || '-'}</td>
                <td className="px-2 py-1 text-right w-[40px]">{n(r.turnovers) || '-'}</td>
                <td className="px-2 py-1 text-right w-[40px]">{n(r.fouls_personal) || '-'}</td>
                <td className="px-2 py-1 text-right w-[45px]">{fmtSigned(r.plus_minus)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-border bg-surface-alt/30 font-semibold">
              <td className="px-2 py-1 text-left">Totals</td>
              <td className="px-2 py-1 text-right w-[40px]">{fmtMin(totals.min)}</td>
              <td className="px-2 py-1 text-right w-[40px]">{totals.points}</td>
              <td className="px-2 py-1 text-right w-[55px]">
                {totals.fgm}-{totals.fga}{' '}
                {totals.fga > 0 && <span className="text-fg-dim">{fmtPct(totalFgPct)}</span>}
              </td>
              <td className="px-2 py-1 text-right w-[55px]">
                {totals.fg3m}-{totals.fg3a}{' '}
                {totals.fg3a > 0 && <span className="text-fg-dim">{fmtPct(totalFg3Pct)}</span>}
              </td>
              <td className="px-2 py-1 text-right w-[55px]">
                {totals.ftm}-{totals.fta}{' '}
                {totals.fta > 0 && <span className="text-fg-dim">{fmtPct(totalFtPct)}</span>}
              </td>
              <td className="px-2 py-1 text-right w-[40px]">{totals.oreb}</td>
              <td className="px-2 py-1 text-right w-[40px]">{totals.dreb}</td>
              <td className="px-2 py-1 text-right w-[40px]">{totals.reb}</td>
              <td className="px-2 py-1 text-right w-[40px]">{totals.assists}</td>
              <td className="px-2 py-1 text-right w-[40px]">{totals.steals}</td>
              <td className="px-2 py-1 text-right w-[40px]">{totals.blocks}</td>
              <td className="px-2 py-1 text-right w-[40px]">{totals.turnovers}</td>
              <td className="px-2 py-1 text-right w-[40px]">{totals.fouls_personal}</td>
              <td className="px-2 py-1 text-right w-[45px] text-fg-dim">—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SplitBoxScore({ rows }: { rows: BoxScoreRow[] }): ReactNode {
  const away = rows.filter((r) => !r.is_home);
  const home = rows.filter((r) => r.is_home);
  return (
    <div>
      <TeamBoxScoreTable teamAbbrev={away[0]?.team_abbrev ?? 'AWAY'} isHome={false} rows={away} />
      <TeamBoxScoreTable teamAbbrev={home[0]?.team_abbrev ?? 'HOME'} isHome rows={home} />
    </div>
  );
}
