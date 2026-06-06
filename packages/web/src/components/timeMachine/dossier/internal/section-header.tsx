import type { ReactNode } from 'react';

interface SectionHeaderProps {
  children: ReactNode;
  variant?: 'primary' | 'accent';
}

export function SectionHeader({ children, variant = 'primary' }: SectionHeaderProps): ReactNode {
  const accentBar = variant === 'accent' ? 'bg-accent/60' : 'bg-primary/60';
  return (
    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-fg-muted">
      <span className={`inline-block h-3.5 w-0.5 rounded-full ${accentBar}`} />
      {children}
    </div>
  );
}
