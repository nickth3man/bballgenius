import type {
  PlayerAdvancedRow,
  PlayerAwardRow,
  PlayerPer36Row,
  PlayerPerGameRow,
  PlayerPlayByPlayRow,
  PlayerShootingRow,
  PlayerTotalsRow,
} from 'data/tabs/time-machine/queries';
import type { ReactNode } from 'react';

import { useSeasonTabs } from '../hooks/use-season-tabs.js';
import { SectionHeader } from '../internal/section-header.js';
import { AdvancedTable } from './advanced-table.js';
import { Per36Table } from './per-36-table.js';
import { PerGameTable } from './per-game-table.js';
import { PlayByPlayTable } from './play-by-play-table.js';
import { ShootingTable } from './shooting-table.js';
import { TotalsTable } from './totals-table.js';

export const PHASE_TABS = [
  { id: 'regular', label: 'Regular Season' },
  { id: 'playoffs', label: 'Playoffs' },
] as const;
export const PHASE_IDS = PHASE_TABS.map((t) => t.id) as [
  (typeof PHASE_TABS)[number]['id'],
  ...(typeof PHASE_TABS)[number]['id'][],
];
export type PhaseId = (typeof PHASE_TABS)[number]['id'];

export const STATS_TABS = [
  { id: 'per-game', label: 'Per Game' },
  { id: 'totals', label: 'Totals' },
  { id: 'per-36', label: 'Per 36' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'shooting', label: 'Shooting' },
  { id: 'play-by-play', label: 'Play-by-Play' },
] as const;
export const STATS_TAB_IDS = STATS_TABS.map((tab) => tab.id) as [
  (typeof STATS_TABS)[number]['id'],
  ...(typeof STATS_TABS)[number]['id'][],
];
export type StatsTabId = (typeof STATS_TABS)[number]['id'];

export interface SeasonTabsProps {
  perGame: PlayerPerGameRow[];
  playoffPerGame: PlayerPerGameRow[];
  totals: PlayerTotalsRow[];
  per36: PlayerPer36Row[];
  advanced: PlayerAdvancedRow[];
  shooting: PlayerShootingRow[];
  playByPlay: PlayerPlayByPlayRow[];
  awards: PlayerAwardRow[];
  activePhase?: PhaseId;
  activeTab?: StatsTabId;
  activeSort?: string;
  activeSortDir?: 'asc' | 'desc';
  onSortChange?: (col: string | null, dir: 'asc' | 'desc') => void;
  onPhaseChange?: (phase: PhaseId) => void;
  onTabChange?: (tab: StatsTabId) => void;
}

export function SeasonTabs(props: SeasonTabsProps): ReactNode {
  const phase = props.activePhase ?? 'regular';
  const tab = props.activeTab ?? 'per-game';

  const { phaseKeyDown, tabKeyDown } = useSeasonTabs(
    phase,
    tab,
    props.onPhaseChange,
    props.onTabChange,
  );

  // Pick the active row set based on phase
  const activePerGame = phase === 'regular' ? props.perGame : props.playoffPerGame;

  return (
    <section>
      <SectionHeader>Season Stats</SectionHeader>

      {/* Phase tabs: Regular Season | Playoffs */}
      <div className="mb-3 flex gap-0" role="tablist" aria-label="Season phase">
        {PHASE_TABS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            id={`season-phase-tab-${p.id}`}
            aria-selected={phase === p.id}
            aria-controls={`season-phase-panel-${p.id}`}
            tabIndex={phase === p.id ? 0 : -1}
            onClick={() => props.onPhaseChange?.(p.id)}
            onKeyDown={phaseKeyDown}
            className={`px-4 py-1.5 text-xs font-medium transition-colors border ${
              phase === p.id
                ? 'bg-primary text-bg border-primary'
                : 'text-fg-muted border-border bg-surface hover:bg-surface-alt'
            } ${p.id === 'regular' ? 'rounded-l-md' : 'rounded-r-md border-l-0'}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Sub-tabs: Per Game | Totals | Per 36 | Advanced | Shooting | Play-by-Play */}
      <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="Season stat table">
        {STATS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`season-stats-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`season-stats-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => props.onTabChange?.(t.id)}
            onKeyDown={tabKeyDown}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              tab === t.id
                ? 'bg-primary text-bg'
                : 'text-fg-muted hover:bg-surface-alt hover:text-fg'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mb-1 text-[10px] text-fg-dim sm:hidden">Swipe sideways for more columns.</p>
      <div
        role="tabpanel"
        aria-labelledby={`season-phase-tab-${phase}`}
        className="overflow-x-auto rounded border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary/50"
      >
        {tab === 'per-game' ? (
          <PerGameTable
            rows={activePerGame}
            awards={props.awards}
            {...(props.activeSort !== undefined ? { activeSort: props.activeSort } : {})}
            {...(props.activeSortDir !== undefined ? { activeSortDir: props.activeSortDir } : {})}
            {...(props.onSortChange !== undefined ? { onSortChange: props.onSortChange } : {})}
          />
        ) : null}
        {tab === 'totals' ? <TotalsTable rows={props.totals} /> : null}
        {tab === 'per-36' ? <Per36Table rows={props.per36} /> : null}
        {tab === 'advanced' ? <AdvancedTable rows={props.advanced} /> : null}
        {tab === 'shooting' ? <ShootingTable rows={props.shooting} /> : null}
        {tab === 'play-by-play' ? <PlayByPlayTable rows={props.playByPlay} /> : null}
      </div>
    </section>
  );
}
