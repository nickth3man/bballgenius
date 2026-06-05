import type { GameShotRow } from 'data/tabs/game-center/queries';
import type { ReactNode } from 'react';
import {
  COURT,
  courtFeetToSvg,
  dataToSvg,
  freeThrowCirclePath,
  halfCourtCirclePath,
  restrictedAreaPath,
  SVG,
  threePointLinePath,
} from './courtGeometry.js';

interface HalfCourtProps {
  shots: GameShotRow[];
  teamAbbrev: string;
  madeColor?: string;
  missedColor?: string;
}

export function HalfCourt({
  shots,
  teamAbbrev,
  madeColor = '#9ece6a',
  missedColor = '#f7768e',
}: HalfCourtProps): ReactNode {
  const { width, height } = SVG;

  // Court outline dimensions
  const courtTop = 0;
  const courtLeft = 0;
  const courtWidth = width;
  const courtHeight = height;
  const baselineY = courtHeight;
  const halfCourtY = courtTop;

  // Paint (key) dimensions
  const keyWidth = COURT.keyWidth * SVG.scale;
  const keyHeight = COURT.keyLength * SVG.scale;
  const keyLeft = (width - keyWidth) / 2;
  const keyTop = baselineY - keyHeight;

  // Free throw line position
  const ftLineY = baselineY - COURT.freeThrowLine * SVG.scale;

  // Basket position
  const basketX = width / 2;
  const basketY = courtFeetToSvg(0, 0).y;

  // Rim
  const rimRadius = COURT.rimRadius * SVG.scale;

  // Backboard
  const backboardY = baselineY - COURT.backboardFromBaseline * SVG.scale;
  const backboardWidth = COURT.backboardWidth * SVG.scale;
  const backboardLeft = (width - backboardWidth) / 2;

  return (
    <div className="flex flex-col items-center">
      <div className="mb-2 text-sm font-bold text-fg">{teamAbbrev}</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxWidth: '500px' }}>
        <title>Shot chart for {teamAbbrev}</title>

        {/* Court background */}
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="#1a1b26"
          stroke="#3b4261"
          strokeWidth={2}
        />

        {/* Half-court line */}
        <line
          x1={courtLeft}
          y1={halfCourtY}
          x2={courtLeft + courtWidth}
          y2={halfCourtY}
          stroke="#3b4261"
          strokeWidth={2}
        />

        {/* Half-court circle */}
        <path d={halfCourtCirclePath()} fill="none" stroke="#3b4261" strokeWidth={1.5} />

        {/* Paint (key) */}
        <rect
          x={keyLeft}
          y={keyTop}
          width={keyWidth}
          height={keyHeight}
          fill="none"
          stroke="#3b4261"
          strokeWidth={1.5}
        />

        {/* Free throw circle: solid outside the lane, dashed inside the lane */}
        <path d={freeThrowCirclePath('outer')} fill="none" stroke="#3b4261" strokeWidth={1.5} />
        <path
          d={freeThrowCirclePath('lane')}
          fill="none"
          stroke="#3b4261"
          strokeWidth={1.5}
          strokeDasharray="6 4"
        />

        {/* Free throw line */}
        <line
          x1={keyLeft}
          y1={ftLineY}
          x2={keyLeft + keyWidth}
          y2={ftLineY}
          stroke="#3b4261"
          strokeWidth={1.5}
        />

        {/* Key marks */}
        {COURT.keyMarkPositions.map((mark) => {
          const markY = baselineY - mark * SVG.scale;
          const markWidth = COURT.keyMarkWidth * SVG.scale;
          return (
            <g key={mark}>
              <line
                x1={keyLeft}
                y1={markY}
                x2={keyLeft + markWidth}
                y2={markY}
                stroke="#3b4261"
                strokeWidth={1}
              />
              <line
                x1={keyLeft + keyWidth - markWidth}
                y1={markY}
                x2={keyLeft + keyWidth}
                y2={markY}
                stroke="#3b4261"
                strokeWidth={1}
              />
            </g>
          );
        })}

        {/* Three-point line */}
        <path d={threePointLinePath()} fill="none" stroke="#3b4261" strokeWidth={1.5} />

        {/* Restricted area */}
        <path d={restrictedAreaPath()} fill="none" stroke="#3b4261" strokeWidth={1.5} />

        {/* Backboard */}
        <line
          x1={backboardLeft}
          y1={backboardY}
          x2={backboardLeft + backboardWidth}
          y2={backboardY}
          stroke="#7aa2f7"
          strokeWidth={2}
        />

        {/* Rim */}
        <circle
          cx={basketX}
          cy={basketY}
          r={rimRadius}
          fill="none"
          stroke="#7aa2f7"
          strokeWidth={2}
        />

        {/* Shot markers */}
        {shots.map((s) => {
          const made = String(s.shot_result ?? '').toLowerCase() === 'made';
          const { x, y } = dataToSvg(Number(s.x), Number(s.y));
          return (
            <circle
              key={`${s.player_id}-${s.x}-${s.y}`}
              cx={x}
              cy={y}
              r={made ? 3.5 : 3}
              fill={made ? madeColor : 'none'}
              stroke={made ? madeColor : missedColor}
              strokeWidth={made ? 0 : 1.5}
              opacity={0.85}
              className="hover:opacity-100"
              style={{ cursor: 'pointer' }}
            >
              <title>
                {made ? 'Made' : 'Missed'} {s.action_type}
              </title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}
