import type { CSSProperties, ReactNode } from 'react';

type TabValue = string;
type TabDefinition = TabValue | { id: TabValue; label: ReactNode };
type TabsVariant = 'segmented' | 'underline';
type TabsSize = 'sm' | 'md';

interface TabsProps {
  tabs?: TabDefinition[];
  value: TabValue;
  onChange?: (id: TabValue) => void;
  variant?: TabsVariant;
  size?: TabsSize;
  style?: CSSProperties;
}

function normalizeTab(tab: TabDefinition): { id: TabValue; label: ReactNode } {
  return typeof tab === 'string' ? { id: tab, label: tab } : tab;
}

export function Tabs({
  tabs = [],
  value,
  onChange,
  variant = 'segmented',
  size = 'md',
  style,
}: TabsProps): ReactNode {
  const height = size === 'sm' ? 28 : 34;
  const fontSize = size === 'sm' ? 'var(--text-xs)' : 'var(--text-sm)';

  if (variant === 'underline') {
    return (
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-4)',
          borderBottom: '1px solid var(--border)',
          ...style,
        }}
      >
        {tabs.map(normalizeTab).map((tab) => {
          const active = tab.id === value;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange?.(tab.id)}
              style={{
                appearance: 'none',
                background: 'none',
                border: 'none',
                padding: '0 0 9px',
                marginBottom: -1,
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                fontSize,
                fontWeight: 'var(--weight-semibold)',
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                transition: 'var(--transition-colors)',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        padding: 3,
        gap: 2,
        background: 'var(--surface-sunken)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        ...style,
      }}
    >
      {tabs.map(normalizeTab).map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange?.(tab.id)}
            style={{
              appearance: 'none',
              height,
              padding: '0 14px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize,
              fontWeight: 'var(--weight-semibold)',
              whiteSpace: 'nowrap',
              background: active ? 'var(--primary)' : 'transparent',
              color: active ? 'var(--primary-fg)' : 'var(--text-secondary)',
              boxShadow: active ? 'var(--shadow-xs)' : 'none',
              transition: 'var(--transition-colors)',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
