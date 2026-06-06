import type { CSSProperties, ReactNode } from 'react';

type CardAccent = 'primary' | 'accent' | 'made' | 'award' | string;
type CardPad = 'none' | 'sm' | 'md' | 'lg';

interface CardProps {
  children: ReactNode;
  title?: ReactNode;
  action?: ReactNode;
  accent?: CardAccent | null;
  pad?: CardPad;
  elevated?: boolean;
  style?: CSSProperties;
}

const pads: Record<CardPad, string | number> = {
  none: 0,
  sm: 'var(--space-3)',
  md: 'var(--space-4)',
  lg: 'var(--space-6)',
};

const accents: Record<string, string> = {
  primary: 'var(--primary)',
  accent: 'var(--accent)',
  made: 'var(--made)',
  award: 'var(--award)',
};

export function Card({
  children,
  title = null,
  action = null,
  accent = null,
  pad = 'md',
  elevated = false,
  style,
}: CardProps): ReactNode {
  const padding = pads[pad];
  const bar = accent ? (accents[accent] ?? accent) : null;

  return (
    <section
      style={{
        position: 'relative',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: elevated ? 'var(--shadow-md)' : 'var(--shadow-xs)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {bar && (
        <div
          style={{
            height: 2,
            width: '100%',
            background: `linear-gradient(90deg, ${bar}, transparent)`,
          }}
        />
      )}
      {(title || action) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `var(--space-3) ${padding}`,
            paddingBottom: 'var(--space-2)',
          }}
        >
          {title && (
            <h3
              style={{
                margin: 0,
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-bold)',
                letterSpacing: 'var(--tracking-label)',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}
            >
              {title}
            </h3>
          )}
          {action}
        </header>
      )}
      <div
        style={{
          padding,
          paddingTop: title || action ? 0 : padding,
        }}
      >
        {children}
      </div>
    </section>
  );
}
