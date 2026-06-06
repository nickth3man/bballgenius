import type { CSSProperties, ReactNode } from 'react';

type TeamCrestShape = 'square' | 'circle';

interface TeamCrestProps {
  abbrev: string;
  color?: string;
  shape?: TeamCrestShape;
  size?: number;
  filled?: boolean;
  style?: CSSProperties;
}

export function TeamCrest({
  abbrev,
  color = 'var(--primary)',
  shape = 'square',
  size = 36,
  filled = false,
  style,
}: TeamCrestProps): ReactNode {
  const fontSize =
    size <= 28 ? 'var(--text-2xs)' : size <= 40 ? 'var(--text-xs)' : 'var(--text-sm)';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: shape === 'circle' ? '50%' : 'var(--radius-md)',
        background: filled ? color : 'var(--surface-elevated)',
        border: filled ? '1px solid transparent' : `1.5px solid ${color}`,
        color: filled ? '#fff' : 'var(--text-primary)',
        fontFamily: 'var(--font-display)',
        fontSize,
        fontWeight: 'var(--weight-bold)',
        letterSpacing: '0.02em',
        lineHeight: 1,
        ...style,
      }}
    >
      {abbrev.slice(0, 3).toUpperCase()}
    </span>
  );
}
