import type { CSSProperties, ReactNode } from 'react';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: CSSProperties;
}

export function Skeleton({
  width = '100%',
  height = 12,
  radius = 'var(--radius-sm)',
  style,
}: SkeletonProps): ReactNode {
  return (
    <span
      style={{
        display: 'block',
        width,
        height,
        borderRadius: radius,
        background:
          'linear-gradient(90deg, var(--surface-alt) 0%, var(--surface-elevated) 50%, var(--surface-alt) 100%)',
        backgroundSize: '200% 100%',
        animation: 'bbg-shimmer 1.3s var(--ease-in-out) infinite',
        ...style,
      }}
    />
  );
}
