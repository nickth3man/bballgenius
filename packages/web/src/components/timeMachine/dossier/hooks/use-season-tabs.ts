import type { KeyboardEvent } from 'react';
import { useCallback } from 'react';

import type { PhaseId, StatsTabId } from '../tables/season-tabs.js';
import { PHASE_TABS, STATS_TABS } from '../tables/season-tabs.js';

export function useSeasonTabs(
  phase: PhaseId,
  tab: StatsTabId,
  onPhaseChange?: (p: PhaseId) => void,
  onTabChange?: (t: StatsTabId) => void,
): {
  phaseKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  tabKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
} {
  const activePhaseIndex = PHASE_TABS.findIndex((t) => t.id === phase);
  const activeTabIndex = STATS_TABS.findIndex((t) => t.id === tab);

  const phaseKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>): void => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const nextPhase = PHASE_TABS.at(
        (activePhaseIndex + direction + PHASE_TABS.length) % PHASE_TABS.length,
      );
      if (!nextPhase) return;
      onPhaseChange?.(nextPhase.id);
      globalThis.setTimeout(() => {
        document.getElementById(`season-phase-tab-${nextPhase.id}`)?.focus();
      }, 0);
    },
    [activePhaseIndex, onPhaseChange],
  );

  const tabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>): void => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const nextTab = STATS_TABS.at(
        (activeTabIndex + direction + STATS_TABS.length) % STATS_TABS.length,
      );
      if (!nextTab) return;
      onTabChange?.(nextTab.id);
      globalThis.setTimeout(() => {
        document.getElementById(`season-stats-tab-${nextTab.id}`)?.focus();
      }, 0);
    },
    [activeTabIndex, onTabChange],
  );

  return { phaseKeyDown, tabKeyDown };
}
