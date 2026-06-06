import type { CSSProperties, ReactNode } from 'react';

type StatTileSize = 'sm' | 'md' | 'lg';
type StatTileAlign = 'left' | 'center';
type DeltaDir = 'up' | 'down';

interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  delta?: number | string | null;
  deltaDir?: DeltaDir | null;
  unit?: ReactNode;
  accent?: boolean;
  size?: StatTileSize;
  align?: StatTileAlign;
  style?: CSSProperties;
}

const sizes: Record<StatTileSize, { value: string; label: string }> = {
  sm: { value: 'var(--text-xl)', label: 'var(--text-2xs)' },
  md: { value: 'var(--text-2xl)', label: 'var(--text-xs)' },
  lg: { value: 'var(--text-stat)', label: 'var(--text-xs)' },
};

export function StatTile({
  label,
  value,
  delta = null,
  deltaDir = null,
  unit = null,
  accent = false,
  size = 'md',
  align = 'left',
  style,
}: StatTileProps): ReactNode {
  const sizeStyle = sizes[size];
  const resolvedDeltaDir =
    deltaDir ?? (typeof delta === 'number' ? (delta >= 0 ? 'up' : 'down') : null);
  const deltaText =
    delta == null
      ? null
      : typeof delta === 'number'
        ? delta > 0
          ? `+${delta}`
          : `${delta}`
        : delta;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'center' ? 'center' : 'flex-start',
        gap: 2,
        ...style,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: sizeStyle.label,
          fontWeight: 'var(--weight-bold)',
          letterSpacing: 'var(--tracking-label)',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: sizeStyle.value,
            fontWeight: 'var(--weight-bold)',
            lineHeight: 'var(--leading-none)',
            letterSpacing: 'var(--tracking-tight)',
            fontVariantNumeric: 'tabular-nums',
            color: accent ? 'var(--accent)' : 'var(--text-primary)',
          }}
        >
          {value}
          {unit && (
            <span style={{ fontSize: '0.5em', color: 'var(--text-muted)', marginLeft: 2 }}>
              {unit}
            </span>
          )}
        </span>
        {deltaText != null && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
              color: resolvedDeltaDir === 'down' ? 'var(--delta-down)' : 'var(--delta-up)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {resolvedDeltaDir === 'down' ? '▾' : '▴'} {deltaText}
          </span>
        )}
      </span>
    </div>
  );
}
