import type { ReactNode } from 'react';

/**
 * Player dossier subcomponents. Purely presentational: every prop is a typed
 * data row from `packages/data/src/tabs/timeMachine/queries.ts`. No data
 * fetching inside these components — the page route handles all queries.
 */

import type {
  GroupedAward,
  PlayerAdvancedRow,
  PlayerAllStarRow,
  PlayerAwardRow,
  PlayerAwardVoteRow,
  PlayerCareerTotalsRow,
  PlayerCombineRow,
  PlayerDraftRow,
  PlayerFranchiseStandingRow,
  PlayerGameLogRow,
  PlayerMetaRow,
  PlayerPer36Row,
  PlayerPerGameRow,
  PlayerPlayByPlayRow,
  PlayerShootingRow,
  PlayerShotZoneRow,
  PlayerTotalsRow,
} from 'data/tabs/time-machine/queries';

/* -------------------------------------------------------------------------- */
/*  Utility helpers                                                           */
/* -------------------------------------------------------------------------- */

function heightInchesToFtIn(heightInches: number | null | string | undefined): string {
  if (heightInches == null) return '—';
  const inches = Number(heightInches);
  if (!Number.isFinite(inches) || inches <= 0) return '—';
  const ft = Math.floor(inches / 12);
  const rem = Math.round(inches - ft * 12);
  return `${ft}′${rem}″`;
}

function formatNumber(value: number | string | null | undefined, digits = 1): string {
  if (value == null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function formatPct(value: number | string | null | undefined, digits = 1): string {
  if (value == null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

/** Format a value that is already in percentage units (e.g. 6.7 means 6.7%). */
function formatPctValue(value: number | string | null | undefined, digits = 1): string {
  if (value == null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

function formatSeason(seasonEndYear: number | string | null | undefined): string {
  if (seasonEndYear == null) return '—';
  const y = Number(seasonEndYear);
  if (!Number.isFinite(y)) return String(seasonEndYear);
  return `${y - 1}-${String(y).slice(-2)}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return value;
}

function DataTable({ headers, children }: { headers: string[]; children: ReactNode }): ReactNode {
  return (
    <div className="relative">
      {/* Right-edge fade scroll indicator */}
      <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-8 bg-gradient-to-l from-surface/80 to-transparent" />
      <table className="min-w-full font-mono text-xs">
        <thead className="sticky top-0 z-10">
          <tr className="bg-surface text-fg-dim">
            {headers.map((h) => (
              <th
                key={h}
                className="border-b-2 border-border px-2 py-1.5 text-left font-semibold whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function highlightClass(
  value: number | string | null | undefined,
  best: number | null,
  worst: number | null,
  higherIsBetter: boolean = true,
): string {
  if (value == null || best == null || worst == null || best === worst) return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (higherIsBetter && n === best) return 'font-bold text-primary';
  if (!higherIsBetter && n === best) return 'font-bold text-primary';
  if (n === worst) return 'text-danger/70';
  return '';
}

function formatBirthDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function ageString(birthDate: string | null | undefined): string {
  if (!birthDate) return '—';
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return '—';
  const ageMs = Date.now() - d.getTime();
  const years = ageMs / (365.25 * 24 * 60 * 60 * 1000);
  return `${Math.floor(years)} yrs`;
}

/* -------------------------------------------------------------------------- */
/*  Section primitives                                                        */
/* -------------------------------------------------------------------------- */

function SectionHeader({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-fg-muted">
      <span className="inline-block h-3.5 w-0.5 rounded-full bg-primary/60" />
      {children}
    </div>
  );
}

function SectionCard({ children }: { children: ReactNode }): ReactNode {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="h-0.5 w-full bg-gradient-to-r from-primary/60 to-transparent" />
      <div className="p-3">{children}</div>
    </section>
  );
}

function EmptyHint({ children }: { children: ReactNode }): ReactNode {
  return <div className="text-fg-dim text-xs italic">{children}</div>;
}

/* -------------------------------------------------------------------------- */
/*  Dossier Header                                                            */
/* -------------------------------------------------------------------------- */

export interface DossierHeaderProps {
  meta: PlayerMetaRow | null;
  totals: PlayerCareerTotalsRow | null;
  franchise: PlayerFranchiseStandingRow[];
  isActive: boolean;
}

export function DossierHeader({
  meta,
  totals,
  franchise,
  isActive,
}: DossierHeaderProps): ReactNode {
  const fullName = meta?.full_name ?? '—';
  const position = meta?.primary_position ?? '—';
  const heightFt = heightInchesToFtIn(meta?.height_inches);
  const weight = meta?.body_weight_lbs != null ? `${meta.body_weight_lbs} lbs` : '—';
  const born = formatBirthDate(meta?.birth_date);
  const age = ageString(meta?.birth_date);
  const school = meta?.school || '—';
  const country = meta?.country || '—';

  const draftLine =
    meta?.draft_year != null
      ? `${meta.draft_year} · R${meta.draft_round ?? '?'} · P${meta.draft_number ?? '?'}`
      : 'Undrafted';

  const seasonSpan =
    totals?.first_season && totals.last_season
      ? `${totals.first_season} → ${totals.last_season} · ${totals.seasons_played ?? '?'} seasons`
      : meta?.from_year != null && meta?.to_year != null
        ? `${meta.from_year} → ${isActive ? 'Present' : meta.to_year}`
        : '—';

  const franchiseLine =
    franchise.length > 0
      ? `Franchise all-time leader in ${franchise.map((f) => f.category).join(', ')}${
          franchise[0]?.team ? ` for ${franchise[0].team}` : ''
        }`
      : null;

  return (
    <SectionCard>
      <div className="mb-2 flex items-baseline gap-3">
        <div>
          <div className="text-2xl font-bold text-fg">{fullName}</div>
        </div>
        {meta?.is_hall_of_fame ? (
          <span className="rounded border border-warning/40 bg-warning/20 px-2 py-0.5 text-xs font-bold text-warning">
            HOF
          </span>
        ) : null}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-3">
        <Fact label="Position" value={position} />
        <Fact label="Height" value={heightFt} />
        <Fact label="Weight" value={weight} />
        <Fact label="Born" value={`${born} (${age})`} />
        <Fact label="College" value={school} />
        <Fact label="Country" value={country} />
      </div>

      <div className="mb-1 text-xs text-fg-muted">
        <span className="text-fg-dim">Draft:</span> {draftLine}
      </div>

      {franchiseLine ? (
        <div className="mb-1 text-xs italic text-secondary">{franchiseLine}</div>
      ) : null}

      <div className="mb-3 text-xs text-fg-muted">
        <span className="text-fg-dim">Career span:</span> {seasonSpan}
      </div>

      {totals ? (
        <div className="border-t border-border pt-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-fg-dim">
            Career Averages
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-9">
            <StatCard label="GP" value={formatNumber(totals.career_gp, 0)} />
            <StatCard label="PPG" value={formatNumber(totals.career_ppg)} />
            <StatCard label="RPG" value={formatNumber(totals.career_rpg)} />
            <StatCard label="APG" value={formatNumber(totals.career_apg)} />
            <StatCard label="SPG" value={formatNumber(totals.career_spg)} />
            <StatCard label="BPG" value={formatNumber(totals.career_bpg)} />
            <StatCard label="FG%" value={formatPct(totals.career_fg_pct)} />
            <StatCard label="3P%" value={formatPct(totals.career_fg3_pct)} />
            <StatCard label="FT%" value={formatPct(totals.career_ft_pct)} />
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <div>
      <span className="text-fg-dim">{label}: </span>
      <span className="text-fg">{value}</span>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <div className="rounded-lg border border-border/60 bg-surface-elevated/60 px-3 py-2.5 text-center transition-colors hover:border-primary/30">
      <div className="text-lg font-bold text-fg sm:text-xl">{value}</div>
      <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-fg-dim">
        {label}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Career Trajectory Sparklines                                              */
/* -------------------------------------------------------------------------- */

function CareerSparkline({
  rows,
  valueKey,
}: {
  rows: PlayerPerGameRow[];
  valueKey: string;
}): ReactNode {
  if (rows.length === 0) return null;

  const values = rows.map((r) => {
    const v = (r as unknown as Record<string, unknown>)[valueKey];
    return typeof v === 'number' ? v : Number(v) || 0;
  });
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  if (max === 0) return null;

  const barHeight = 64;
  const barWidth = Math.max(4, Math.min(14, Math.floor(500 / rows.length)));

  return (
    <div className="relative">
      {/* Max value label */}
      <div className="mb-0.5 flex items-baseline justify-between text-[9px] text-fg-dim">
        <span>{formatNumber(max, 1)}</span>
      </div>
      <div className="relative" style={{ height: barHeight + 2 }}>
        {/* Average reference line */}
        <div
          className="absolute left-0 right-0 border-t border-dashed border-primary/20"
          style={{ top: barHeight - (avg / max) * barHeight }}
        />
        <div className="flex items-end gap-px" style={{ height: barHeight }}>
          {values.map((v, i) => {
            const h = max > 0 ? (v / max) * barHeight : 0;
            const season = rows[i].season_end_year;
            const isPeak = v === max;
            return (
              <div key={season} className="group relative flex flex-col items-center">
                <div
                  className={`w-full rounded-t transition-all duration-150 hover:opacity-100 ${
                    isPeak ? 'bg-accent' : 'bg-primary/50 hover:bg-primary'
                  }`}
                  style={{ width: barWidth, height: Math.max(1, h) }}
                />
                <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-bg px-1.5 py-0.5 text-[10px] font-medium text-fg opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100">
                  {formatNumber(v, 1)}
                  <span className="ml-1 text-fg-dim">{formatSeason(season)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Season labels */}
      <div className="flex justify-between text-[8px] text-fg-dim">
        {rows.length > 0 && <span>{formatSeason(rows[0].season_end_year)}</span>}
        {rows.length > 1 && <span>{formatSeason(rows[rows.length - 1].season_end_year)}</span>}
      </div>
    </div>
  );
}

export function CareerTrajectory({ perGame }: { perGame: PlayerPerGameRow[] }): ReactNode {
  if (perGame.length === 0) return null;
  return (
    <section>
      <SectionHeader>Career Trajectory</SectionHeader>
      <SectionCard>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-widest text-fg-dim">PPG</div>
            <CareerSparkline rows={perGame} valueKey="pts_per_game" />
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-widest text-fg-dim">RPG</div>
            <CareerSparkline rows={perGame} valueKey="trb_per_game" />
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-widest text-fg-dim">APG</div>
            <CareerSparkline rows={perGame} valueKey="ast_per_game" />
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-widest text-fg-dim">MPG</div>
            <CareerSparkline rows={perGame} valueKey="mp_per_game" />
          </div>
        </div>
      </SectionCard>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Awards Grouped                                                            */
/* -------------------------------------------------------------------------- */

export function AwardsGrouped({ groups }: { groups: GroupedAward[] }): ReactNode {
  if (groups.length === 0) return null;

  // Sub-group awards by their label within each category
  // e.g., ALL-NBA → { "All-NBA 1st": [seasons...], "All-NBA 2nd": [seasons...] }
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
      <SectionHeader>Awards & Honors</SectionHeader>
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
                      {count > 1 && <span className="font-bold">{count}×</span>}
                      <span className={count > 1 ? '' : 'font-medium'}>
                        {titleCase(label.replace(/\s+\d+(st|nd|rd|th)\s+Team/i, ''))}
                      </span>
                      <span className="text-fg-dim/70">
                        {count === 1 ? sorted[0] : `${sorted[0]}–${sorted[sorted.length - 1]}`}
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

/** Title-case an award label (handles "nba mvp" → "NBA MVP", "all-nba 1st" → "All-NBA 1st"). */
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

/* -------------------------------------------------------------------------- */
/*  Award Votes Strip                                                         */
/* -------------------------------------------------------------------------- */

export function AwardVotesStrip({
  allStar,
  votes,
}: {
  allStar: PlayerAllStarRow[];
  votes: PlayerAwardVoteRow[];
}): ReactNode {
  if (allStar.length === 0 && votes.length === 0) return null;

  const allStarYears = allStar
    .map((s) => s.season_end_year)
    .filter((y): y is number => y != null)
    .sort((a, b) => b - a);

  const topVotes = votes.filter((v) => !v.winner).slice(0, 6);

  return (
    <section>
      <SectionHeader>All-Star &amp; Award Voting</SectionHeader>
      <SectionCard>
        <div className="space-y-2">
          {allStarYears.length > 0 ? (
            <div className="flex items-baseline gap-2">
              <span className="rounded-md border border-secondary/30 bg-secondary/10 px-2.5 py-1 font-mono text-sm font-bold text-secondary">
                {allStarYears.length}×
              </span>
              <span className="text-xs text-fg-muted">NBA All-Star</span>
              <span className="font-mono text-[10px] text-fg-dim">
                ({allStarYears.slice(0, 5).join(', ')}
                {allStarYears.length > 5 ? ` +${allStarYears.length - 5} more` : ''})
              </span>
            </div>
          ) : null}

          {topVotes.length > 0 ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {topVotes.map((v) => {
                const share = Number(v.share);
                const isHighShare = share >= 0.5;
                return (
                  <span
                    key={`${v.award}-${v.season_end_year}`}
                    className={`rounded px-2 py-0.5 font-mono text-[11px] ${
                      isHighShare ? 'bg-success/10 text-success' : 'bg-surface-alt/60 text-fg-muted'
                    }`}
                  >
                    <span className="font-medium uppercase">{String(v.award)}</span>{' '}
                    <span className="text-fg-dim">{formatSeason(v.season_end_year)}</span>
                    {' · '}
                    {formatPct(v.share, 1)} share
                    {' · '}
                    <span className="text-fg-dim">
                      {v.pts_won}/{v.pts_max}
                    </span>
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      </SectionCard>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Season Tabs                                                               */
/* -------------------------------------------------------------------------- */

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
  totals: PlayerTotalsRow[];
  per36: PlayerPer36Row[];
  advanced: PlayerAdvancedRow[];
  shooting: PlayerShootingRow[];
  playByPlay: PlayerPlayByPlayRow[];
  activeTab?: StatsTabId;
  onTabChange?: (tab: StatsTabId) => void;
}

export function SeasonTabs(props: SeasonTabsProps): ReactNode {
  const tab = props.activeTab ?? 'per-game';
  return (
    <section>
      <SectionHeader>Season Stats</SectionHeader>
      <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="Season stat table">
        {STATS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => props.onTabChange?.(t.id)}
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
      <div className="overflow-x-auto rounded border border-border bg-surface">
        {tab === 'per-game' ? <PerGameTable rows={props.perGame} /> : null}
        {tab === 'totals' ? <TotalsTable rows={props.totals} /> : null}
        {tab === 'per-36' ? <Per36Table rows={props.per36} /> : null}
        {tab === 'advanced' ? <AdvancedTable rows={props.advanced} /> : null}
        {tab === 'shooting' ? <ShootingTable rows={props.shooting} /> : null}
        {tab === 'play-by-play' ? <PlayByPlayTable rows={props.playByPlay} /> : null}
      </div>
    </section>
  );
}

function PerGameTable({ rows }: { rows: PlayerPerGameRow[] }): ReactNode {
  if (rows.length === 0) return <EmptyHint>No per-game data available</EmptyHint>;

  const ptsValues = rows.map((r) => Number(r.pts_per_game)).filter(Number.isFinite);
  const astValues = rows.map((r) => Number(r.ast_per_game)).filter(Number.isFinite);
  const trbValues = rows.map((r) => Number(r.trb_per_game)).filter(Number.isFinite);
  const stlValues = rows.map((r) => Number(r.stl_per_game)).filter(Number.isFinite);
  const blkValues = rows.map((r) => Number(r.blk_per_game)).filter(Number.isFinite);
  const mpValues = rows.map((r) => Number(r.mp_per_game)).filter(Number.isFinite);
  const best = (arr: number[]) => (arr.length > 1 ? Math.max(...arr) : null);
  const worst = (arr: number[]) => (arr.length > 1 ? Math.min(...arr) : null);

  return (
    <DataTable
      headers={[
        'Season',
        'Age',
        'Tm',
        'Pos',
        'G',
        'GS',
        'MP',
        'FG',
        'FGA',
        'FG%',
        '3P',
        '3PA',
        '3P%',
        'FT',
        'FTA',
        'FT%',
        'ORB',
        'DRB',
        'TRB',
        'AST',
        'STL',
        'BLK',
        'TOV',
        'PF',
        'PTS',
      ]}
    >
      {rows.map((r) => (
        <tr
          key={`per-game-${r.season_end_year}-${r.team ?? ''}-${r.pos ?? ''}`}
          className="border-b border-surface-alt/50 text-fg-muted even:bg-surface-alt/20 last:border-b-0 hover:bg-surface-alt/40 transition-colors"
        >
          <td className="sticky left-0 z-[5] whitespace-nowrap bg-surface px-2 py-0.5 font-medium text-fg">
            {formatSeason(r.season_end_year)}
          </td>
          <td className="px-2 py-0.5">{r.age ?? '—'}</td>
          <td className="px-2 py-0.5">{r.team ?? '—'}</td>
          <td className="px-2 py-0.5">{r.pos ?? '—'}</td>
          <td className="px-2 py-0.5">{r.g ?? '—'}</td>
          <td className="px-2 py-0.5">{r.gs ?? '—'}</td>
          <td
            className={`px-2 py-0.5 ${highlightClass(r.mp_per_game, best(mpValues), worst(mpValues))}`}
          >
            {formatNumber(r.mp_per_game)}
          </td>
          <td className="px-2 py-0.5">{formatNumber(r.fg_per_game)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.fga_per_game)}</td>
          <td className="px-2 py-0.5">{formatPct(r.fg_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.x3p_per_game, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.x3pa_per_game, 1)}</td>
          <td className="px-2 py-0.5">{formatPct(r.x3p_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.ft_per_game, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.fta_per_game, 1)}</td>
          <td className="px-2 py-0.5">{formatPct(r.ft_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.orb_per_game, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.drb_per_game, 1)}</td>
          <td
            className={`px-2 py-0.5 ${highlightClass(r.trb_per_game, best(trbValues), worst(trbValues))}`}
          >
            {formatNumber(r.trb_per_game, 1)}
          </td>
          <td
            className={`px-2 py-0.5 ${highlightClass(r.ast_per_game, best(astValues), worst(astValues))}`}
          >
            {formatNumber(r.ast_per_game, 1)}
          </td>
          <td
            className={`px-2 py-0.5 ${highlightClass(r.stl_per_game, best(stlValues), worst(stlValues))}`}
          >
            {formatNumber(r.stl_per_game, 1)}
          </td>
          <td
            className={`px-2 py-0.5 ${highlightClass(r.blk_per_game, best(blkValues), worst(blkValues))}`}
          >
            {formatNumber(r.blk_per_game, 1)}
          </td>
          <td className="px-2 py-0.5">{formatNumber(r.tov_per_game, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.pf_per_game, 1)}</td>
          <td
            className={`px-2 py-0.5 ${highlightClass(r.pts_per_game, best(ptsValues), worst(ptsValues))}`}
          >
            {formatNumber(r.pts_per_game, 1)}
          </td>
        </tr>
      ))}
    </DataTable>
  );
}

function TotalsTable({ rows }: { rows: PlayerTotalsRow[] }): ReactNode {
  if (rows.length === 0) return <EmptyHint>No totals data available</EmptyHint>;
  return (
    <DataTable
      headers={[
        'Season',
        'Tm',
        'Pos',
        'G',
        'GS',
        'MP',
        'FG',
        'FGA',
        'FG%',
        '3P',
        '3PA',
        '3P%',
        'FT',
        'FTA',
        'FT%',
        'ORB',
        'DRB',
        'TRB',
        'AST',
        'STL',
        'BLK',
        'TOV',
        'PF',
        'PTS',
        'Trp-Dbl',
      ]}
    >
      {rows.map((r) => (
        <tr
          key={`row-${r.season_end_year}-${r.team ?? ''}-${r.pos ?? ''}`}
          className="border-b border-surface-alt/50 text-fg-muted even:bg-surface-alt/20 last:border-b-0 hover:bg-surface-alt/40 transition-colors"
        >
          <td className="px-2 py-0.5">{formatSeason(r.season_end_year)}</td>
          <td className="px-2 py-0.5">{r.team ?? '—'}</td>
          <td className="px-2 py-0.5">{r.pos ?? '—'}</td>
          <td className="px-2 py-0.5">{r.g ?? '—'}</td>
          <td className="px-2 py-0.5">{r.gs ?? '—'}</td>
          <td className="px-2 py-0.5">{r.mp ?? '—'}</td>
          <td className="px-2 py-0.5">{formatNumber(r.fg, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.fga, 0)}</td>
          <td className="px-2 py-0.5">{formatPct(r.fg_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.x3p, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.x3pa, 0)}</td>
          <td className="px-2 py-0.5">{formatPct(r.x3p_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.ft, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.fta, 0)}</td>
          <td className="px-2 py-0.5">{formatPct(r.ft_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.orb, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.drb, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.trb, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.ast, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.stl, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.blk, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.tov, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.pf, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.pts, 0)}</td>
          <td className="px-2 py-0.5">{r.trp_dbl ?? '—'}</td>
        </tr>
      ))}
    </DataTable>
  );
}

function Per36Table({ rows }: { rows: PlayerPer36Row[] }): ReactNode {
  if (rows.length === 0) return <EmptyHint>No per-36 data available</EmptyHint>;
  return (
    <DataTable
      headers={[
        'Season',
        'Tm',
        'G',
        'MP',
        'FG',
        'FGA',
        'FG%',
        '3P',
        '3PA',
        '3P%',
        'FT',
        'FTA',
        'FT%',
        'ORB',
        'DRB',
        'TRB',
        'AST',
        'STL',
        'BLK',
        'TOV',
        'PF',
        'PTS',
      ]}
    >
      {rows.map((r) => (
        <tr
          key={`row-${r.season_end_year}-${r.team ?? ''}-${r.pos ?? ''}`}
          className="border-b border-surface-alt/50 text-fg-muted even:bg-surface-alt/20 last:border-b-0 hover:bg-surface-alt/40 transition-colors"
        >
          <td className="px-2 py-0.5">{formatSeason(r.season_end_year)}</td>
          <td className="px-2 py-0.5">{r.team ?? '—'}</td>
          <td className="px-2 py-0.5">{r.g ?? '—'}</td>
          <td className="px-2 py-0.5">{r.mp ?? '—'}</td>
          <td className="px-2 py-0.5">{formatNumber(r.fg_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.fga_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatPct(r.fg_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.x3p_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.x3pa_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatPct(r.x3p_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.ft_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.fta_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatPct(r.ft_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.orb_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.drb_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.trb_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.ast_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.stl_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.blk_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.tov_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.pf_per_36_min, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.pts_per_36_min, 1)}</td>
        </tr>
      ))}
    </DataTable>
  );
}

function AdvancedTable({ rows }: { rows: PlayerAdvancedRow[] }): ReactNode {
  if (rows.length === 0) return <EmptyHint>No advanced stats available</EmptyHint>;

  const perValues = rows.map((r) => Number(r.per)).filter(Number.isFinite);
  const wsValues = rows.map((r) => Number(r.ws)).filter(Number.isFinite);
  const bpmValues = rows.map((r) => Number(r.bpm)).filter(Number.isFinite);
  const vorpValues = rows.map((r) => Number(r.vorp)).filter(Number.isFinite);
  const best = (arr: number[]) => (arr.length > 1 ? Math.max(...arr) : null);
  const worst = (arr: number[]) => (arr.length > 1 ? Math.min(...arr) : null);

  return (
    <DataTable
      headers={[
        'Season',
        'Tm',
        'Age',
        'G',
        'MP',
        'PER',
        'TS%',
        '3PAr',
        'FTr',
        'ORB%',
        'DRB%',
        'TRB%',
        'AST%',
        'STL%',
        'BLK%',
        'TOV%',
        'USG%',
        'OWS',
        'DWS',
        'WS',
        'WS/48',
        'OBPM',
        'DBPM',
        'BPM',
        'VORP',
      ]}
    >
      {rows.map((r) => (
        <tr
          key={`row-${r.season_end_year}-${r.team ?? ''}-${r.pos ?? ''}`}
          className="border-b border-surface-alt/50 text-fg-muted even:bg-surface-alt/20 last:border-b-0 hover:bg-surface-alt/40 transition-colors"
        >
          <td className="px-2 py-0.5">{formatSeason(r.season_end_year)}</td>
          <td className="px-2 py-0.5">{r.team ?? '—'}</td>
          <td className="px-2 py-0.5">{r.age ?? '—'}</td>
          <td className="px-2 py-0.5">{r.g ?? '—'}</td>
          <td className="px-2 py-0.5">{r.mp ?? '—'}</td>
          <td className={`px-2 py-0.5 ${highlightClass(r.per, best(perValues), worst(perValues))}`}>
            {formatNumber(r.per)}
          </td>
          <td className="px-2 py-0.5">{formatPct(r.ts_percent)}</td>
          <td className="px-2 py-0.5">{formatPct(r.x3p_ar)}</td>
          <td className="px-2 py-0.5">{formatPct(r.f_tr)}</td>
          <td className="px-2 py-0.5">{formatPctValue(r.orb_percent)}</td>
          <td className="px-2 py-0.5">{formatPctValue(r.drb_percent)}</td>
          <td className="px-2 py-0.5">{formatPctValue(r.trb_percent)}</td>
          <td className="px-2 py-0.5">{formatPctValue(r.ast_percent)}</td>
          <td className="px-2 py-0.5">{formatPctValue(r.stl_percent)}</td>
          <td className="px-2 py-0.5">{formatPctValue(r.blk_percent)}</td>
          <td className="px-2 py-0.5">{formatPctValue(r.tov_percent)}</td>
          <td className="px-2 py-0.5">{formatPctValue(r.usg_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.ows, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.dws, 1)}</td>
          <td className={`px-2 py-0.5 ${highlightClass(r.ws, best(wsValues), worst(wsValues))}`}>
            {formatNumber(r.ws, 1)}
          </td>
          <td className="px-2 py-0.5">{formatNumber(r.ws_48, 3)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.obpm, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.dbpm, 1)}</td>
          <td className={`px-2 py-0.5 ${highlightClass(r.bpm, best(bpmValues), worst(bpmValues))}`}>
            {formatNumber(r.bpm, 1)}
          </td>
          <td
            className={`px-2 py-0.5 ${highlightClass(r.vorp, best(vorpValues), worst(vorpValues))}`}
          >
            {formatNumber(r.vorp, 1)}
          </td>
        </tr>
      ))}
    </DataTable>
  );
}

function ShootingTable({ rows }: { rows: PlayerShootingRow[] }): ReactNode {
  if (rows.length === 0) return <EmptyHint>No shooting data available (post-2000 era)</EmptyHint>;
  return (
    <DataTable
      headers={[
        'Season',
        'Tm',
        'G',
        'MP',
        'FG%',
        'Dist',
        '%FGA 0-3',
        '%FGA 3-10',
        '%FGA 10-16',
        '%FGA 16-3P',
        '%FGA 3P',
        'FG% 0-3',
        'FG% 3-10',
        'FG% 10-16',
        'FG% 16-3P',
        'FG% 3P',
        '%Ast 2P',
        '%Ast 3P',
        '%Dunks',
        '#Dunks',
        'Corner3 %',
      ]}
    >
      {rows.map((r) => (
        <tr
          key={`row-${r.season_end_year}-${r.team ?? ''}-${r.pos ?? ''}`}
          className="border-b border-surface-alt/50 text-fg-muted even:bg-surface-alt/20 last:border-b-0 hover:bg-surface-alt/40 transition-colors"
        >
          <td className="px-2 py-0.5">{formatSeason(r.season_end_year)}</td>
          <td className="px-2 py-0.5">{r.team ?? '—'}</td>
          <td className="px-2 py-0.5">{r.g ?? '—'}</td>
          <td className="px-2 py-0.5">{r.mp ?? '—'}</td>
          <td className="px-2 py-0.5">{formatPct(r.fg_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.avg_dist_fga, 1)}</td>
          <td className="px-2 py-0.5">{formatPct(r.percent_fga_from_x0_3_range)}</td>
          <td className="px-2 py-0.5">{formatPct(r.percent_fga_from_x3_10_range)}</td>
          <td className="px-2 py-0.5">{formatPct(r.percent_fga_from_x10_16_range)}</td>
          <td className="px-2 py-0.5">{formatPct(r.percent_fga_from_x16_3p_range)}</td>
          <td className="px-2 py-0.5">{formatPct(r.percent_fga_from_x3p_range)}</td>
          <td className="px-2 py-0.5">{formatPct(r.fg_percent_from_x0_3_range)}</td>
          <td className="px-2 py-0.5">{formatPct(r.fg_percent_from_x3_10_range)}</td>
          <td className="px-2 py-0.5">{formatPct(r.fg_percent_from_x10_16_range)}</td>
          <td className="px-2 py-0.5">{formatPct(r.fg_percent_from_x16_3p_range)}</td>
          <td className="px-2 py-0.5">{formatPct(r.fg_percent_from_x3p_range)}</td>
          <td className="px-2 py-0.5">{formatPct(r.percent_assisted_x2p_fg)}</td>
          <td className="px-2 py-0.5">{formatPct(r.percent_assisted_x3p_fg)}</td>
          <td className="px-2 py-0.5">{formatPct(r.percent_dunks_of_fga)}</td>
          <td className="px-2 py-0.5">{r.num_of_dunks ?? '—'}</td>
          <td className="px-2 py-0.5">{r.percent_corner_3s_of_3pa ?? '—'}</td>
        </tr>
      ))}
    </DataTable>
  );
}

function PlayByPlayTable({ rows }: { rows: PlayerPlayByPlayRow[] }): ReactNode {
  if (rows.length === 0) return <EmptyHint>No play-by-play data available</EmptyHint>;
  return (
    <DataTable
      headers={[
        'Season',
        'Tm',
        'G',
        'MP',
        '%PG',
        '%SG',
        '%SF',
        '%PF',
        '%C',
        'OnCourt +/-',
        'Net +/-',
        'Pts via AST',
        'FGA Blocked',
      ]}
    >
      {rows.map((r) => (
        <tr
          key={`row-${r.season_end_year}-${r.team ?? ''}-${r.pos ?? ''}`}
          className="border-b border-surface-alt/50 text-fg-muted even:bg-surface-alt/20 last:border-b-0 hover:bg-surface-alt/40 transition-colors"
        >
          <td className="px-2 py-0.5">{formatSeason(r.season_end_year)}</td>
          <td className="px-2 py-0.5">{r.team ?? '—'}</td>
          <td className="px-2 py-0.5">{r.g ?? '—'}</td>
          <td className="px-2 py-0.5">{r.mp ?? '—'}</td>
          <td className="px-2 py-0.5">{formatPct(r.pg_percent)}</td>
          <td className="px-2 py-0.5">{formatPct(r.sg_percent)}</td>
          <td className="px-2 py-0.5">{formatPct(r.sf_percent)}</td>
          <td className="px-2 py-0.5">{formatPct(r.pf_percent)}</td>
          <td className="px-2 py-0.5">{formatPct(r.c_percent)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.on_court_plus_minus_per_100_poss, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.net_plus_minus_per_100_poss, 1)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.points_generated_by_assists, 0)}</td>
          <td className="px-2 py-0.5">{formatNumber(r.fga_blocked, 0)}</td>
        </tr>
      ))}
    </DataTable>
  );
}

/* -------------------------------------------------------------------------- */
/*  Shot Zones                                                                */
/* -------------------------------------------------------------------------- */

export function ShotZonesCard({ zones }: { zones: PlayerShotZoneRow[] }): ReactNode {
  if (zones.length === 0) return null;
  return (
    <section>
      <SectionHeader>Shot Zones</SectionHeader>
      <SectionCard>
        <DataTable headers={['Zone', 'FGA', 'FGM', 'FG%']}>
          {zones.map((z) => (
            <tr
              key={z.zone}
              className="border-b border-surface-alt/50 text-fg-muted even:bg-surface-alt/20 last:border-b-0"
            >
              <td className="px-2 py-0.5">{z.zone}</td>
              <td className="px-2 py-0.5">{z.fga}</td>
              <td className="px-2 py-0.5">{z.fgm}</td>
              <td className="px-2 py-0.5">
                <span className="mr-2 inline-block w-12 align-middle">
                  <span
                    className="block h-1.5 rounded bg-primary/40"
                    style={{ width: `${Math.min(100, z.fg_pct * 100)}%` }}
                  />
                </span>
                {formatPct(z.fg_pct)}
              </td>
            </tr>
          ))}
        </DataTable>
      </SectionCard>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Game Log                                                                  */
/* -------------------------------------------------------------------------- */

export function GameLogCard({ rows }: { rows: PlayerGameLogRow[] }): ReactNode {
  return (
    <section>
      <SectionHeader>Recent Games</SectionHeader>
      <SectionCard>
        {rows.length === 0 ? (
          <EmptyHint>No game log data available</EmptyHint>
        ) : (
          <div className="overflow-x-auto">
            <DataTable
              headers={[
                'Date',
                'Matchup',
                'W/L',
                'MIN',
                'PTS',
                'REB',
                'AST',
                'STL',
                'BLK',
                'TOV',
                '+/-',
              ]}
            >
              {rows.map((g) => (
                <tr
                  key={`gamelog-${g.game_date}-${g.matchup ?? ''}`}
                  className="border-b border-surface-alt/50 text-fg-muted even:bg-surface-alt/20 last:border-b-0 hover:bg-surface-alt/40 transition-colors"
                >
                  <td className="px-2 py-0.5">{formatDate(g.game_date)}</td>
                  <td className="px-2 py-0.5">{g.matchup ?? '—'}</td>
                  <td
                    className={`px-2 py-0.5 font-semibold ${
                      g.wl === 'W' ? 'text-success' : g.wl === 'L' ? 'text-danger' : 'text-fg-muted'
                    }`}
                  >
                    {g.wl ?? '—'}
                  </td>
                  <td className="px-2 py-0.5">{formatNumber(g.min, 1)}</td>
                  <td className="px-2 py-0.5">{formatNumber(g.pts, 0)}</td>
                  <td className="px-2 py-0.5">{formatNumber(g.reb, 0)}</td>
                  <td className="px-2 py-0.5">{formatNumber(g.ast, 0)}</td>
                  <td className="px-2 py-0.5">{formatNumber(g.stl, 0)}</td>
                  <td className="px-2 py-0.5">{formatNumber(g.blk, 0)}</td>
                  <td className="px-2 py-0.5">{formatNumber(g.tov, 0)}</td>
                  <td className="px-2 py-0.5">{formatNumber(g.plus_minus, 0)}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}
      </SectionCard>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Draft & Combine                                                           */
/* -------------------------------------------------------------------------- */

export interface DraftCombineProps {
  draft: PlayerDraftRow | null;
  combine: PlayerCombineRow | null;
}

export function DraftCombineCard({ draft, combine }: DraftCombineProps): ReactNode {
  if (!draft && !combine) return null;
  return (
    <section>
      <SectionHeader>Draft & Combine</SectionHeader>
      <SectionCard>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-widest text-fg-dim">Draft</div>
            {draft ? (
              <div className="space-y-0.5 text-xs text-fg">
                <div>
                  <span className="text-fg-dim">Season:</span> {formatSeason(draft.season_end_year)}
                </div>
                <div>
                  <span className="text-fg-dim">Round:</span> {draft.round ?? '—'}
                </div>
                <div>
                  <span className="text-fg-dim">Overall pick:</span> {draft.overall_pick ?? '—'}
                </div>
                <div>
                  <span className="text-fg-dim">Team:</span> {draft.team ?? '—'}
                </div>
              </div>
            ) : (
              <EmptyHint>Undrafted</EmptyHint>
            )}
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-widest text-fg-dim">Combine</div>
            {combine ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-fg">
                <div>
                  <span className="text-fg-dim">Ht w/o shoes:</span>{' '}
                  {formatNumber(combine.height_wo_shoes, 1)}&quot;
                </div>
                <div>
                  <span className="text-fg-dim">Wingspan:</span> {formatNumber(combine.wingspan, 1)}
                  &quot;
                </div>
                <div>
                  <span className="text-fg-dim">Standing reach:</span>{' '}
                  {formatNumber(combine.standing_reach, 1)}&quot;
                </div>
                <div>
                  <span className="text-fg-dim">Body fat:</span>{' '}
                  {formatPctValue(combine.body_fat_pct, 1)}
                </div>
                <div>
                  <span className="text-fg-dim">Standing vert:</span>{' '}
                  {formatNumber(combine.standing_vertical_leap, 1)}&quot;
                </div>
                <div>
                  <span className="text-fg-dim">Max vert:</span>{' '}
                  {formatNumber(combine.max_vertical_leap, 1)}&quot;
                </div>
                <div>
                  <span className="text-fg-dim">Lane agility:</span>{' '}
                  {formatNumber(combine.lane_agility_time, 2)}s
                </div>
                <div>
                  <span className="text-fg-dim">3/4 sprint:</span>{' '}
                  {formatNumber(combine.three_quarter_sprint, 2)}s
                </div>
                <div>
                  <span className="text-fg-dim">Hand length:</span>{' '}
                  {formatNumber(combine.hand_length, 2)}&quot;
                </div>
                <div>
                  <span className="text-fg-dim">Hand width:</span>{' '}
                  {formatNumber(combine.hand_width, 2)}&quot;
                </div>
                <div>
                  <span className="text-fg-dim">Bench:</span> {combine.bench_press ?? '—'}
                </div>
              </div>
            ) : (
              <EmptyHint>No combine measurements on record</EmptyHint>
            )}
          </div>
        </div>
      </SectionCard>
    </section>
  );
}

/* Re-export types so consumers can use the prop shapes directly. */
export type {
  GroupedAward,
  PlayerAdvancedRow,
  PlayerAllStarRow,
  PlayerAwardRow,
  PlayerAwardVoteRow,
  PlayerCareerTotalsRow,
  PlayerCombineRow,
  PlayerDraftRow,
  PlayerFranchiseStandingRow,
  PlayerGameLogRow,
  PlayerMetaRow,
  PlayerPer36Row,
  PlayerPerGameRow,
  PlayerPlayByPlayRow,
  PlayerShootingRow,
  PlayerShotZoneRow,
  PlayerTotalsRow,
};
