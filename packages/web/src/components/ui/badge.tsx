import type { CSSProperties, ReactNode } from 'react';

type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'accent'
  | 'success'
  | 'danger'
  | 'warning'
  | 'award'
  | 'live';
type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  live?: boolean;
  size?: BadgeSize;
  style?: CSSProperties;
}

const tones: Record<BadgeTone, { bg: string; fg: string; bd: string }> = {
  neutral: {
    bg: 'var(--surface-elevated)',
    fg: 'var(--text-secondary)',
    bd: 'var(--border)',
  },
  primary: {
    bg: 'var(--primary-soft)',
    fg: 'var(--blue-300)',
    bd: 'var(--primary-soft-border)',
  },
  accent: {
    bg: 'var(--accent-soft)',
    fg: 'var(--orange-300)',
    bd: 'var(--accent-soft-border)',
  },
  success: {
    bg: 'var(--success-soft)',
    fg: 'var(--green-400)',
    bd: 'rgba(33, 199, 122, 0.32)',
  },
  danger: {
    bg: 'var(--danger-soft)',
    fg: 'var(--red-400)',
    bd: 'rgba(255, 77, 94, 0.32)',
  },
  warning: {
    bg: 'var(--warning-soft)',
    fg: 'var(--gold-400)',
    bd: 'rgba(245, 183, 61, 0.32)',
  },
  award: {
    bg: 'var(--warning-soft)',
    fg: 'var(--gold-400)',
    bd: 'rgba(245, 183, 61, 0.32)',
  },
  live: {
    bg: 'var(--danger-soft)',
    fg: 'var(--red-400)',
    bd: 'rgba(255, 77, 94, 0.32)',
  },
};

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
  live = false,
  size = 'md',
  style,
}: BadgeProps): ReactNode {
  const toneStyle = tones[tone];
  const sizeStyle =
    size === 'sm'
      ? { height: 18, paddingX: 7, fontSize: 'var(--text-2xs)' }
      : { height: 22, paddingX: 9, fontSize: 'var(--text-xs)' };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: sizeStyle.height,
        padding: `0 ${sizeStyle.paddingX}px`,
        background: toneStyle.bg,
        color: toneStyle.fg,
        border: `1px solid ${toneStyle.bd}`,
        borderRadius: 'var(--radius-pill)',
        fontFamily: 'var(--font-sans)',
        fontSize: sizeStyle.fontSize,
        fontWeight: 'var(--weight-bold)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {(dot || live) && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'currentColor',
            animation: live ? 'bbg-pulse 1.4s var(--ease-out) infinite' : 'none',
          }}
        />
      )}
      {children}
    </span>
  );
}
