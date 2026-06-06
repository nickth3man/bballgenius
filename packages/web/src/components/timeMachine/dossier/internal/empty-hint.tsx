import type { ReactNode } from 'react';

interface EmptyHintProps {
  children: ReactNode;
}

export function EmptyHint({ children }: EmptyHintProps): ReactNode {
  return <div className="text-fg-dim text-xs italic">{children}</div>;
}
