import type { GroupedAward } from 'data/tabs/time-machine/queries';
import type { ReactNode } from 'react';

import { SectionCard } from '../internal/section-card.js';
import { SectionHeader } from '../internal/section-header.js';

/** Title-case an award label (handles "nba mvp" \u2192 "NBA MVP", "all-nba 1st" \u2192 "All-NBA 1st"). */
function titleCase(label: string): string {
  return label
    .split(/\s+/)
    .map((w) => {
      const upper = w.toUpperCase();
      if (
        upper === 'NBA' ||
        upper === 'MVP' ||
        upper === 'ROY' ||
        upper === 'DPOY' ||
        upper === 'POY'
      ) {
        return upper;
      }
      if (
        upper === 'ALL-NBA' ||
        upper === 'ALL-STAR' ||
        upper === 'ALL-DEFENSE' ||
        upper === 'ALL-ROOKIE'
      ) {
        return upper;
      }
      if (/^\d/.test(w) || /^(st|nd|rd|th)$/i.test(w)) return w;
      if (w.length === 0) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

export function AwardsGrouped({ groups }: { groups: GroupedAward[] }): ReactNode {
  if (groups.length === 0) return null;

  // Sub-group awards by their label within each category
  // e.g., ALL-NBA \u2192 { "All-NBA 1st": [seasons...], "All-NBA 2nd": [seasons...] }
  const grouped = groups.map((g) => {
    const subMap = new Map<string, string[]>();
    for (const a of g.awards) {
      const existing = subMap.get(a.label) ?? [];
      existing.push(a.season);
      subMap.set(a.label, existing);
    }
    return { category: g.category, subGroups: Array.from(subMap.entries()) };
  });

  return (
    <section>
      <SectionHeader>Awards &amp; Honors</SectionHeader>
      <SectionCard>
        <div className="space-y-3">
          {grouped.map((g) => (
            <div key={g.category}>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg-muted">
                {titleCase(g.category)}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.subGroups.map(([label, seasons]) => {
                  const count = seasons.length;
                  // Sort seasons ascending for clean range display
                  const sorted = [...seasons].sort((a, b) => a.localeCompare(b));
                  const teamNum = label.match(/(\d+)(st|nd|rd|th)\s*Team/i);
                  const lower = label.toLowerCase();
                  const isMajor = lower.includes('mvp') || lower.includes('roy');
                  const isAllStar = lower.includes('all-star') || lower.includes('all star');
                  return (
                    <span
                      key={label}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs transition-colors ${
                        isMajor
                          ? 'border-warning/30 bg-warning/10 text-warning'
                          : teamNum && teamNum[1] === '1'
                            ? 'border-primary/30 bg-primary/10 text-primary'
                            : isAllStar
                              ? 'border-secondary/30 bg-secondary/10 text-secondary'
                              : 'border-border/60 bg-surface-alt/60 text-fg-muted'
                      }`}
                    >
                      {count > 1 && <span className="font-bold">{count}\u00d7</span>}
                      <span className={count > 1 ? '' : 'font-medium'}>
                        {titleCase(label.replace(/\s+\d+(st|nd|rd|th)\s+Team/i, ''))}
                      </span>
                      <span className="text-fg-dim/70">
                        {count === 1 ? sorted[0] : `${sorted[0]}\u2013${sorted[sorted.length - 1]}`}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </section>
  );
}
