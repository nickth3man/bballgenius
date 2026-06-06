import type { ReactNode } from 'react';

interface SectionCardProps {
  children: ReactNode;
}

export function SectionCard({ children }: SectionCardProps): ReactNode {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="h-0.5 w-full bg-gradient-to-r from-primary/60 to-transparent" />
      <div className="p-3">{children}</div>
    </section>
  );
}
