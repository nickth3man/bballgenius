import type { PlayerPerGameRow } from 'data/tabs/time-machine/queries';
import { type ReactNode, useEffect, useState } from 'react';

import { formatNumber, formatSeason } from '../../../../utils/formatters.js';
import { SectionCard } from '../internal/section-card.js';
import { SectionHeader } from '../internal/section-header.js';

function CareerLineChart({
  rows,
  valueKey,
  color,
  honorSeasons,
  label,
}: {
  rows: PlayerPerGameRow[];
  valueKey: string;
  color: string;
  honorSeasons?: Set<number>;
  label: string;
}): ReactNode {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [animateIn, setAnimateIn] = useState(false);
  useEffect(() => setAnimateIn(true), []);

  if (rows.length === 0) return null;

  const values = rows.map((r) => {
    const v = (r as unknown as Record<string, unknown>)[valueKey];
    return typeof v === 'number' ? v : Number(v) || 0;
  });
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  if (max === 0) return null;

  const H = 64;
  const W = 200;

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const avgY = H - ((avg - min) / range) * H;

  const xToIndex = (clientX: number, svgEl: SVGSVGElement): number | null => {
    const rect = svgEl.getBoundingClientRect();
    if (values.length === 0) return null;
    const xRatio = (clientX - rect.left) / rect.width;
    if (xRatio < 0 || xRatio > 1) return null;
    return Math.round(xRatio * (values.length - 1));
  };

  const hoverIndexToX = (i: number): number =>
    values.length > 1 ? (i / (values.length - 1)) * W : W / 2;

  const points = values
    .map((v, i) => {
      const x = values.length > 1 ? (i / (values.length - 1)) * W : W / 2;
      const y = H - ((v - min) / range) * H;
      return `${x},${y}`;
    })
    .join(' ');

  const areaPath = `${0},${H} ${points} ${W},${H}`;

  return (
    <div className="relative text-fg-dim">
      <div className="mb-0.5 flex items-baseline justify-between text-[9px] text-fg-dim">
        <span>{formatNumber(Math.max(...values), 1)}</span>
        <span className="text-fg-dim/50">{formatNumber(min, 1)}</span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-16 w-full overflow-visible"
        role="img"
        aria-label={`${label} career trajectory: ${formatNumber(min, 1)} to ${formatNumber(max, 1)} across ${values.length} seasons`}
        onMouseMove={(e) => setHoverIndex(xToIndex(e.clientX, e.currentTarget))}
        onMouseLeave={() => setHoverIndex(null)}
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (t) setHoverIndex(xToIndex(t.clientX, e.currentTarget));
        }}
      >
        <title>{label} per season</title>
        <desc>
          Peak {formatNumber(max, 1)}, low {formatNumber(min, 1)}, career average{' '}
          {formatNumber(avg, 1)} across {values.length} seasons.
        </desc>
        {/* Honor season star markers -- only for first, last, and peak seasons */}
        {(() => {
          if (!honorSeasons || honorSeasons.size === 0) return null;
          const honorIndices = values
            .map((_, i) => i)
            .filter((i) => honorSeasons.has(Number(rows[i]!.season_end_year)));
          if (honorIndices.length === 0) return null;
          const maxVal = Math.max(...values);
          const peakIndex = values.indexOf(maxVal);
          const showIndices = new Set([honorIndices[0], honorIndices[honorIndices.length - 1]]);
          // Also show the peak season if it's a honor season
          if (honorSeasons.has(Number(rows[peakIndex]?.season_end_year))) {
            showIndices.add(peakIndex);
          }
          return [...showIndices]
            .filter((i): i is number => i !== undefined)
            .map((i) => (
              <text
                key={`star-${rows[i]!.season_end_year}`}
                x={values.length > 1 ? (i / (values.length - 1)) * W : W / 2}
                y={H - ((values[i]! - min) / range) * H - 8}
                textAnchor="middle"
                fontSize={8}
                fill="#f59e0b"
                opacity={0.8}
              >
                {'\u2605'}
              </text>
            ));
        })()}
        {/* Area fill */}
        <polygon
          fill={color}
          fillOpacity={0.1}
          points={areaPath}
          style={{ opacity: animateIn ? 1 : 0, transition: 'opacity 0.5s ease-out' }}
        />
        {/* Average reference line */}
        <line
          x1={0}
          y1={avgY}
          x2={W}
          y2={avgY}
          stroke="currentColor"
          strokeOpacity={0.25}
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
        {/* Line */}
        <polyline
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
          style={{ opacity: animateIn ? 1 : 0, transition: 'opacity 0.5s ease-out' }}
        />
        {/* Hover guide */}
        {hoverIndex !== null ? (
          <g pointerEvents="none">
            <line
              x1={hoverIndexToX(hoverIndex)}
              y1={0}
              x2={hoverIndexToX(hoverIndex)}
              y2={H}
              stroke={color}
              strokeOpacity={0.4}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={hoverIndexToX(hoverIndex)}
              cy={H - ((values[hoverIndex]! - min) / range) * H}
              r={3}
              fill={color}
              stroke="white"
              strokeWidth={1}
            />
            <text
              x={hoverIndexToX(hoverIndex)}
              y={H - ((values[hoverIndex]! - min) / range) * H - 6}
              textAnchor="middle"
              fontSize={9}
              fill={color}
              className="font-mono font-medium"
            >
              {formatNumber(values[hoverIndex] ?? 0, 1)}
            </text>
            <text
              x={hoverIndexToX(hoverIndex)}
              y={H + 10}
              textAnchor="middle"
              fontSize={8}
              fill="currentColor"
            >
              {rows[hoverIndex]?.season_end_year
                ? formatSeason(rows[hoverIndex].season_end_year)
                : ''}
            </text>
          </g>
        ) : null}
        {/* Dot markers */}
        {(() => {
          const targetDots = Math.min(8, values.length);
          if (values.length <= targetDots) {
            return values.map((v, i) => (
              <circle
                key={`dot-${rows[i]!.season_end_year}`}
                cx={values.length > 1 ? (i / (values.length - 1)) * W : W / 2}
                cy={H - ((v - min) / range) * H}
                r={2}
                fill={color}
              />
            ));
          }
          const step = Math.max(1, Math.floor((values.length - 1) / (targetDots - 1)));
          const indices = new Set<number>([0, values.length - 1]);
          for (let i = 0; i < values.length; i += step) indices.add(i);
          return [...indices].map((i) => (
            <circle
              key={`dot-${rows[i]!.season_end_year}`}
              cx={values.length > 1 ? (i / (values.length - 1)) * W : W / 2}
              cy={H - ((values[i]! - min) / range) * H}
              r={2}
              fill={color}
            />
          ));
        })()}
      </svg>
      <div className="flex justify-between text-[8px] text-fg-dim">
        {rows.length > 0 && <span>{formatSeason(rows[0]!.season_end_year)}</span>}
        {rows.length > 1 && <span>{formatSeason(rows[rows.length - 1]!.season_end_year)}</span>}
      </div>
    </div>
  );
}

export function CareerTrajectory({
  perGame,
  allStarSeasons,
  playerKey,
}: {
  perGame: PlayerPerGameRow[];
  allStarSeasons?: Set<number>;
  playerKey?: string | number;
}): ReactNode {
  const regularSeasonRows = perGame.filter((row) => !('is_playoffs' in row) || !row.is_playoffs);
  if (regularSeasonRows.length === 0) return null;

  const sparklineMetrics = [
    { label: 'PPG', key: 'pts_per_game', color: '#60a5fa' },
    { label: 'RPG', key: 'trb_per_game', color: '#34d399' },
    { label: 'APG', key: 'ast_per_game', color: '#f472b6' },
    { label: 'STL', key: 'stl_per_game', color: '#fbbf24' },
    { label: 'MPG', key: 'mp_per_game', color: '#a78bfa' },
    { label: 'FG%', key: 'fg_percent', color: '#fb923c' },
    { label: '3P%', key: 'x3p_percent', color: '#38bdf8' },
    { label: 'FT%', key: 'ft_percent', color: '#4ade80' },
  ] as const;

  // Build honor seasons: seasons where the player was an All-Star
  const honorSeasons = allStarSeasons ?? new Set<number>();

  return (
    <section>
      <SectionHeader>Career Trajectory</SectionHeader>
      <SectionCard>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-4">
          {sparklineMetrics.map((m) => (
            <div key={`${playerKey ?? 'default'}-${m.key}`}>
              <div className="mb-1 text-[10px] uppercase tracking-widest text-fg-dim">
                {m.label}
              </div>
              <CareerLineChart
                rows={regularSeasonRows}
                valueKey={m.key}
                color={m.color}
                honorSeasons={honorSeasons}
                label={m.label}
              />
            </div>
          ))}
        </div>
      </SectionCard>
    </section>
  );
}
