import type { ReactNode } from 'react';
import { Card, Skeleton as UISkeleton } from '../ui';

function Skeleton({ className }: { className?: string }): ReactNode {
  // Map Tailwind h-/w- class sizes to pixel values for the local shimmer skeleton.
  const cls = className ?? 'h-3 w-full';
  const hMatch = cls.match(/\bh-(\d+)\b/);
  const wMatch = cls.match(/\bw-(\d+)\b/);
  const height = hMatch ? Number(hMatch[1]) * 4 : 12;
  const width = wMatch ? `${Number(wMatch[1]) * 4}px` : '100%';
  return <UISkeleton width={width} height={height} style={{ borderRadius: 4, opacity: 0.7 }} />;
}

function HeaderSkeleton(): ReactNode {
  const hdrCells = Array.from({ length: 6 });
  const statCells = Array.from({ length: 9 });
  return (
    <Card accent="primary" pad="md">
      <Skeleton className="h-7 w-48" />
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-3">
        {hdrCells.map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static decorative skeleton
          <Skeleton key={i} className="h-3 w-32" />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 pt-3 sm:grid-cols-5 md:grid-cols-9">
        {statCells.map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static decorative skeleton
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </Card>
  );
}

function CardSkeleton({ rows = 4 }: { rows?: number }): ReactNode {
  const cells = Array.from({ length: rows });
  return (
    <section>
      <Skeleton className="mb-3 h-3 w-32" />
      <Card pad="md">
        <div className="space-y-2">
          {cells.map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static decorative skeleton
            <Skeleton key={i} className="h-3 w-full" />
          ))}
        </div>
      </Card>
    </section>
  );
}

export function DossierSkeleton(): ReactNode {
  const sections = Array.from({ length: 5 });
  return (
    <div className="space-y-8">
      <HeaderSkeleton />
      {sections.map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static decorative skeleton
        <CardSkeleton key={i} rows={3 + i} />
      ))}
    </div>
  );
}

export { DossierSkeleton as default };
