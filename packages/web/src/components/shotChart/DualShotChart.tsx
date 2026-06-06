import type { BoxScoreRow, GameShotRow } from 'data/tabs/game-center/queries';
import type { ReactNode } from 'react';
import { HalfCourt } from './HalfCourt.js';

interface DualShotChartProps {
  shots: GameShotRow[];
  boxScore: BoxScoreRow[];
  homeAbbrev: string;
  awayAbbrev: string;
}

export function DualShotChart({
  shots,
  boxScore,
  homeAbbrev,
  awayAbbrev,
}: DualShotChartProps): ReactNode {
  // Determine team IDs from box score
  const homeTeamId = boxScore.find((r) => r.is_home)?.team_id;
  const awayTeamId = boxScore.find((r) => !r.is_home)?.team_id;

  // Build player_id -> team_id mapping from box score
  // (PBP data may have null team_id but always has player_id)
  const playerToTeam = new Map<string, string>();
  for (const row of boxScore) {
    playerToTeam.set(row.player_id, row.team_id);
  }

  // Filter shots by team (using team_id if available, otherwise player mapping)
  const homeShots = shots.filter((s) => {
    if (s.team_id) return s.team_id === homeTeamId;
    const mappedTeam = playerToTeam.get(s.player_id);
    return mappedTeam === homeTeamId;
  });
  const awayShots = shots.filter((s) => {
    if (s.team_id) return s.team_id === awayTeamId;
    const mappedTeam = playerToTeam.get(s.player_id);
    return mappedTeam === awayTeamId;
  });

  // Compute team stats
  const homeMade = homeShots.filter((s) => String(s.shot_result).toLowerCase() === 'made').length;
  const awayMade = awayShots.filter((s) => String(s.shot_result).toLowerCase() === 'made').length;

  const homePct = homeShots.length > 0 ? Math.round((homeMade / homeShots.length) * 100) : 0;
  const awayPct = awayShots.length > 0 ? Math.round((awayMade / awayShots.length) * 100) : 0;

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <HalfCourt shots={awayShots} teamAbbrev={awayAbbrev} />
          <div className="mt-1 text-center text-xs text-fg-dim">
            {awayMade}/{awayShots.length} FG ({awayPct}%)
          </div>
        </div>
        <div className="min-w-0">
          <HalfCourt shots={homeShots} teamAbbrev={homeAbbrev} />
          <div className="mt-1 text-center text-xs text-fg-dim">
            {homeMade}/{homeShots.length} FG ({homePct}%)
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center justify-center gap-6 text-xs text-fg-dim">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: 'var(--made)' }}
          />
          Made
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border-2"
            style={{ borderColor: 'var(--missed)', backgroundColor: 'transparent' }}
          />
          Missed
        </span>
      </div>
    </div>
  );
}
