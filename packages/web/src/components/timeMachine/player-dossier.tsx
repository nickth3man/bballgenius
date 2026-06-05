import { type KeyboardEvent, type ReactNode, useCallback, useMemo, useState } from 'react';

/**
 * Player dossier subcomponents. Purely presentational: every prop is a typed
 * data row from `packages/data/src/tabs/timeMachine/queries.ts`. No data
 * fetching inside these components — the page route handles all queries.
 */

import type {
  CareerStatRow,
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

function PctBar({ value }: { value: number | string | null | undefined }): ReactNode {
  if (value == null) return <span className="text-fg-dim">—</span>;
  const n = Number(value);
  if (!Number.isFinite(n)) return <span className="text-fg-dim">—</span>;
  const pct = Math.round(Math.min(100, Math.max(0, n * 100)));
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block w-10 h-1.5 rounded-full bg-surface-alt overflow-hidden"
        aria-hidden="true"
      >
        <span className="block h-full rounded-full bg-primary/60" style={{ width: `${pct}%` }} />
      </span>
      <span>{formatPct(value)}</span>
    </span>
  );
}

function formatSeason(seasonEndYear: number | string | null | undefined): string {
  if (seasonEndYear == null) return '—';
  const y = Number(seasonEndYear);
  if (!Number.isFinite(y)) return String(seasonEndYear);
  return `${y - 1}-${String(y).slice(-2)}`;
}

/** Generate a deterministic color from a string (player_id). */
function pickPlayerColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 45%)`;
}

/** Darken/lighten an HSL color by adjusting lightness. */
function adjustColor(hsl: string, amount: number): string {
  const m = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!m) return hsl;
  const h = Number(m[1]);
  const s = Number(m[2]);
  const l = Math.max(0, Math.min(100, Number(m[3]) + amount));
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/** Get initials from a full name (e.g. "Pete Maravich" → "PM"). */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return value;
}

function DataTable({
  headers,
  children,
  caption,
}: {
  headers: string[];
  children: ReactNode;
  caption?: string;
}): ReactNode {
  return (
    <div className="relative">
      {/* Right-edge fade scroll indicator */}
      <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-8 bg-gradient-to-l from-surface/80 to-transparent" />
      {/* Bottom-edge fade scroll indicator */}
      <div className="pointer-events-none absolute bottom-0 left-0 z-10 h-6 w-full bg-gradient-to-t from-surface/60 to-transparent" />
      <table className="min-w-full font-mono text-xs [&_tbody_td:first-child]:sticky [&_tbody_td:first-child]:left-0 [&_tbody_td:first-child]:z-[5] [&_tbody_td:first-child]:bg-surface [&_tbody_td:first-child]:font-medium [&_tbody_td:first-child]:text-fg [&_thead_th:first-child]:sticky [&_thead_th:first-child]:left-0 [&_thead_th:first-child]:z-20 [&_thead_th:first-child]:bg-surface [&_tbody_td:nth-child(2)]:sticky [&_tbody_td:nth-child(2)]:left-[4.5rem] [&_tbody_td:nth-child(2)]:z-[5] [&_tbody_td:nth-child(2)]:bg-surface [&_thead_th:nth-child(2)]:sticky [&_thead_th:nth-child(2)]:left-[4.5rem] [&_thead_th:nth-child(2)]:z-20 [&_thead_th:nth-child(2)]:bg-surface [&_tbody_td:nth-child(3)]:sticky [&_tbody_td:nth-child(3)]:left-[7rem] [&_tbody_td:nth-child(3)]:z-[5] [&_tbody_td:nth-child(3)]:bg-surface [&_thead_th:nth-child(3)]:sticky [&_thead_th:nth-child(3)]:left-[7rem] [&_thead_th:nth-child(3)]:z-20 [&_thead_th:nth-child(3)]:bg-surface [&_tbody_td:nth-child(4)]:sticky [&_tbody_td:nth-child(4)]:left-[9.5rem] [&_tbody_td:nth-child(4)]:z-[5] [&_tbody_td:nth-child(4)]:bg-surface [&_thead_th:nth-child(4)]:sticky [&_thead_th:nth-child(4)]:left-[9.5rem] [&_thead_th:nth-child(4)]:z-20 [&_thead_th:nth-child(4)]:bg-surface">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
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

function SectionHeader({
  children,
  variant = 'primary',
}: {
  children: ReactNode;
  variant?: 'primary' | 'accent';
}): ReactNode {
  const accentBar = variant === 'accent' ? 'bg-accent/60' : 'bg-primary/60';
  return (
    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-fg-muted">
      <span className={`inline-block h-3.5 w-0.5 rounded-full ${accentBar}`} />
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

  // Color accent based on player_id (deterministic per-player)
  const playerColor = pickPlayerColor(meta?.person_id ?? '');

  return (
    <SectionCard>
      {/* Team-color accent gradient at top */}
      <div
        className="mb-3 -mx-3 -mt-3 h-1.5 rounded-t-lg"
        style={{
          background: `linear-gradient(90deg, ${playerColor}, ${adjustColor(playerColor, -40)})`,
        }}
      />

      <div className="mb-3 flex items-start gap-4">
        {/* Player avatar placeholder */}
        <div
          className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 text-2xl font-black text-white shadow-md"
          style={{
            background: `linear-gradient(135deg, ${playerColor}, ${adjustColor(playerColor, -30)})`,
            borderColor: adjustColor(playerColor, -20),
          }}
          aria-hidden="true"
        >
          {getInitials(fullName)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="mb-1 flex items-baseline gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-fg">{fullName}</h1>
            {meta?.is_hall_of_fame ? (
              <span className="rounded border border-warning/40 bg-warning/20 px-2 py-0.5 text-xs font-bold text-warning">
                HOF
              </span>
            ) : null}
            {isActive ? (
              <span className="inline-block h-2 w-2 rounded-full bg-success" title="Active" />
            ) : null}
          </div>

          <div className="mb-2 grid grid-cols-2 gap-x-5 gap-y-0.5 text-xs sm:grid-cols-3">
            <Fact label="Position" value={position} />
            <Fact label="Height" value={heightFt} />
            <Fact label="Weight" value={weight} />
            <Fact label="Born" value={`${born} (${age})`} />
            <Fact label="College" value={school} />
            <Fact label="Country" value={country} />
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-fg-muted">
            <span>
              <span className="text-fg-dim">Draft:</span> {draftLine}
            </span>
            <span>
              <span className="text-fg-dim">Career:</span> {seasonSpan}
            </span>
          </div>

          {franchiseLine ? (
            <div className="mt-1 text-xs italic text-secondary">{franchiseLine}</div>
          ) : null}
        </div>
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

function CareerLineChart({
  rows,
  valueKey,
  color,
  honorSeasons,
}: {
  rows: PlayerPerGameRow[];
  valueKey: string;
  color: string;
  honorSeasons?: Set<number>;
}): ReactNode {
  if (rows.length === 0) return null;

  const values = rows.map((r) => {
    const v = (r as unknown as Record<string, unknown>)[valueKey];
    return typeof v === 'number' ? v : Number(v) || 0;
  });
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  if (max === 0) return null;

  const H = 64;
  const W = 200;
  const points = values
    .map((v, i) => {
      const x = values.length > 1 ? (i / (values.length - 1)) * W : W / 2;
      const y = H - ((v - min) / range) * H;
      return `${x},${y}`;
    })
    .join(' ');

  const areaPath = `${0},${H} ${points} ${W},${H}`;

  return (
    <div className="relative">
      <div className="mb-0.5 flex items-baseline justify-between text-[9px] text-fg-dim">
        <span>{formatNumber(Math.max(...values), 1)}</span>
        <span className="text-fg-dim/50">{formatNumber(min, 1)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full overflow-visible" aria-hidden="true">
        {/* Honor season star markers */}
        {values.map((v, i) =>
          honorSeasons?.has(Number(rows[i].season_end_year)) ? (
            <text
              key={`star-${rows[i].season_end_year}`}
              x={values.length > 1 ? (i / (values.length - 1)) * W : W / 2}
              y={H - ((v - min) / range) * H - 8}
              textAnchor="middle"
              fontSize={10}
              fill="#f59e0b"
            >
              ★
            </text>
          ) : null,
        )}
        {/* Area fill */}
        <polygon fill={color} fillOpacity={0.1} points={areaPath} />
        {/* Line */}
        <polyline
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
        {/* Dot markers every 3 seasons */}
        {values.map((v, i) =>
          values.length <= 12 || i % Math.max(1, Math.floor(values.length / 8)) === 0 ? (
            <circle
              key={`dot-${rows[i].season_end_year}`}
              cx={values.length > 1 ? (i / (values.length - 1)) * W : W / 2}
              cy={H - ((v - min) / range) * H}
              r={2}
              fill={color}
            />
          ) : null,
        )}
      </svg>
      <div className="flex justify-between text-[8px] text-fg-dim">
        {rows.length > 0 && <span>{formatSeason(rows[0].season_end_year)}</span>}
        {rows.length > 1 && <span>{formatSeason(rows[rows.length - 1].season_end_year)}</span>}
      </div>
    </div>
  );
}

function CareerSparkline({
  rows,
  valueKey,
  honorSeasons,
}: {
  rows: PlayerPerGameRow[];
  valueKey: string;
  honorSeasons?: Set<number>;
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
                {honorSeasons?.has(Number(season)) ? (
                  <span className="mb-0.5 text-[8px] text-warning" title="All-Star">
                    ★
                  </span>
                ) : (
                  <div className="h-3" />
                )}
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

export function CareerTrajectory({
  perGame,
  allStarSeasons,
}: {
  perGame: PlayerPerGameRow[];
  allStarSeasons?: Set<number>;
}): ReactNode {
  const regularSeasonRows = perGame.filter((row) => !('is_playoffs' in row) || !row.is_playoffs);
  if (regularSeasonRows.length === 0) return null;

  const sparklineMetrics = [
    { label: 'PPG', key: 'pts_per_game', variant: 'line' as const, color: '#60a5fa' },
    { label: 'RPG', key: 'trb_per_game', variant: 'line' as const, color: '#34d399' },
    { label: 'APG', key: 'ast_per_game', variant: 'line' as const, color: '#f472b6' },
    { label: 'STL', key: 'stl_per_game', variant: 'line' as const, color: '#fbbf24' },
    { label: 'MPG', key: 'mp_per_game', variant: 'bar' as const },
    { label: 'FG%', key: 'fg_percent', variant: 'bar' as const },
    { label: '3P%', key: 'x3p_percent', variant: 'bar' as const },
    { label: 'FT%', key: 'ft_percent', variant: 'bar' as const },
  ];

  // Build honor seasons: seasons where the player was an All-Star
  const honorSeasons = allStarSeasons ?? new Set<number>();

  return (
    <section>
      <SectionHeader>Career Trajectory</SectionHeader>
      <SectionCard>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-4">
          {sparklineMetrics.map((m) => (
            <div key={m.key}>
              <div className="mb-1 text-[10px] uppercase tracking-widest text-fg-dim">
                {m.label}
              </div>
              {m.variant === 'line' ? (
                <CareerLineChart
                  rows={regularSeasonRows}
                  valueKey={m.key}
                  color={m.color}
                  honorSeasons={honorSeasons}
                />
              ) : (
                <CareerSparkline
                  rows={regularSeasonRows}
                  valueKey={m.key}
                  honorSeasons={honorSeasons}
                />
              )}
            </div>
          ))}
        </div>
      </SectionCard>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Playoff Stats                                                             */
/* -------------------------------------------------------------------------- */

export function PlayoffStatsCard({ rows }: { rows: PlayerPerGameRow[] }): ReactNode {
  if (rows.length === 0) return null;
  return (
    <section>
      <SectionHeader variant="accent">Playoff Stats</SectionHeader>
      <SectionCard>
        <p className="mb-3 text-[10px] leading-relaxed text-fg-dim">
          Same format as the regular-season Per Game table.
        </p>
        <p className="mb-1 text-[10px] text-fg-dim sm:hidden">Swipe sideways for more columns.</p>
        <div className="overflow-x-auto rounded border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary/50">
          <PerGameTable rows={rows} awards={[]} />
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
  onPhaseChange?: (phase: PhaseId) => void;
  onTabChange?: (tab: StatsTabId) => void;
}

export function SeasonTabs(props: SeasonTabsProps): ReactNode {
  const phase = props.activePhase ?? 'regular';
  const tab = props.activeTab ?? 'per-game';
  const activePhaseIndex = PHASE_TABS.findIndex((t) => t.id === phase);
  const activeTabIndex = STATS_TABS.findIndex((t) => t.id === tab);

  const handlePhaseKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const nextPhase = PHASE_TABS.at(
      (activePhaseIndex + direction + PHASE_TABS.length) % PHASE_TABS.length,
    );
    if (!nextPhase) return;
    props.onPhaseChange?.(nextPhase.id);
    globalThis.setTimeout(() => {
      document.getElementById(`season-phase-tab-${nextPhase.id}`)?.focus();
    }, 0);
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const nextTab = STATS_TABS.at(
      (activeTabIndex + direction + STATS_TABS.length) % STATS_TABS.length,
    );
    if (!nextTab) return;
    props.onTabChange?.(nextTab.id);
    globalThis.setTimeout(() => {
      document.getElementById(`season-stats-tab-${nextTab.id}`)?.focus();
    }, 0);
  };

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
            onKeyDown={handlePhaseKeyDown}
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
            onKeyDown={handleTabKeyDown}
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
        {tab === 'per-game' ? <PerGameTable rows={activePerGame} awards={props.awards} /> : null}
        {tab === 'totals' ? <TotalsTable rows={props.totals} /> : null}
        {tab === 'per-36' ? <Per36Table rows={props.per36} /> : null}
        {tab === 'advanced' ? <AdvancedTable rows={props.advanced} /> : null}
        {tab === 'shooting' ? <ShootingTable rows={props.shooting} /> : null}
        {tab === 'play-by-play' ? <PlayByPlayTable rows={props.playByPlay} /> : null}
      </div>
    </section>
  );
}

function PerGameTable({
  rows,
  awards,
}: {
  rows: PlayerPerGameRow[];
  awards: PlayerAwardRow[];
}): ReactNode {
  const best = (arr: number[]) => (arr.length > 1 ? Math.max(...arr) : null);
  const worst = (arr: number[]) => (arr.length > 1 ? Math.min(...arr) : null);

  // Hooks must be called unconditionally, before any early returns
  const ptsValues = useMemo(
    () => rows.map((r) => Number(r.pts_per_game)).filter(Number.isFinite),
    [rows],
  );
  const astValues = useMemo(
    () => rows.map((r) => Number(r.ast_per_game)).filter(Number.isFinite),
    [rows],
  );
  const trbValues = useMemo(
    () => rows.map((r) => Number(r.trb_per_game)).filter(Number.isFinite),
    [rows],
  );
  const stlValues = useMemo(
    () => rows.map((r) => Number(r.stl_per_game)).filter(Number.isFinite),
    [rows],
  );
  const blkValues = useMemo(
    () => rows.map((r) => Number(r.blk_per_game)).filter(Number.isFinite),
    [rows],
  );
  const mpValues = useMemo(
    () => rows.map((r) => Number(r.mp_per_game)).filter(Number.isFinite),
    [rows],
  );

  // Build awards lookup by season_end_year
  const awardsBySeason = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const a of awards) {
      // Extract year from season label like "1975-76"
      const seasonStr = typeof a.season_year === 'string' ? a.season_year : String(a.season_year);
      const match = seasonStr.match(/(\d{4})-\d{2}/);
      if (match) {
        const endYear = Number(match[1]) + 1;
        const existing = map.get(endYear) ?? [];
        existing.push(String(a.award));
        map.set(endYear, existing);
      }
    }
    return map;
  }, [awards]);

  // Column sorting state
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sortedRows = useMemo(() => {
    if (!sortCol) return rows;
    const getVal = (r: PlayerPerGameRow): number => {
      const v = (r as unknown as Record<string, unknown>)[sortCol];
      return typeof v === 'number' ? v : Number(v) || 0;
    };
    const sorted = [...rows].sort((a, b) => {
      const va = getVal(a);
      const vb = getVal(b);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return sorted;
  }, [rows, sortCol, sortDir]);

  const handleSort = useCallback((col: string) => {
    setSortCol((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return col;
      }
      setSortDir('desc'); // default to descending for new column
      return col;
    });
  }, []);

  // Compute career summary rows
  const summaryRows = useMemo(() => {
    if (rows.length === 0) return [];
    const validRows = rows.filter((r) => r.g != null && Number(r.g) > 0);
    if (validRows.length === 0) return [];

    // Career totals (games-weighted)
    const totalG = validRows.reduce((sum, r) => sum + (Number(r.g) || 0), 0);
    const avg = (key: keyof PlayerPerGameRow): number => {
      const weighted = validRows.reduce(
        (sum, r) => sum + (Number(r[key]) || 0) * (Number(r.g) || 0),
        0,
      );
      return totalG > 0 ? weighted / totalG : 0;
    };
    const avgPct = (key: keyof PlayerPerGameRow): number => {
      // For pct columns, compute from totals
      const attemptsKey =
        key === 'fg_percent'
          ? 'fga_per_game'
          : key === 'x3p_percent'
            ? 'x3pa_per_game'
            : key === 'x2p_percent'
              ? 'x2pa_per_game'
              : key === 'ft_percent'
                ? 'fta_per_game'
                : null;
      const makesKey =
        key === 'fg_percent'
          ? 'fg_per_game'
          : key === 'x3p_percent'
            ? 'x3p_per_game'
            : key === 'x2p_percent'
              ? 'x2p_per_game'
              : key === 'ft_percent'
                ? 'ft_per_game'
                : null;
      if (!attemptsKey || !makesKey) return avg(key);
      const totalMakes = validRows.reduce(
        (sum, r) => sum + (Number(r[makesKey]) || 0) * (Number(r.g) || 0),
        0,
      );
      const totalAttempts = validRows.reduce(
        (sum, r) => sum + (Number(r[attemptsKey]) || 0) * (Number(r.g) || 0),
        0,
      );
      return totalAttempts > 0 ? totalMakes / totalAttempts : 0;
    };

    // Per-team summary
    const teamGroups = new Map<string, PlayerPerGameRow[]>();
    for (const r of validRows) {
      const tm = String(r.team ?? 'TOT');
      const existing = teamGroups.get(tm) ?? [];
      existing.push(r);
      teamGroups.set(tm, existing);
    }

    const summaries: Array<{ label: string; isBold: boolean; row: Partial<PlayerPerGameRow> }> = [];

    // Career row
    const careerRow: Partial<PlayerPerGameRow> = {
      season_end_year: 0,
      age: null,
      team: '',
      pos: '',
      lg: '',
      g: totalG,
      gs: null,
      mp_per_game: avg('mp_per_game'),
      fg_per_game: avg('fg_per_game'),
      fga_per_game: avg('fga_per_game'),
      fg_percent: avgPct('fg_percent'),
      x3p_per_game: avg('x3p_per_game'),
      x3pa_per_game: avg('x3pa_per_game'),
      x3p_percent: avgPct('x3p_percent'),
      x2p_per_game: avg('x2p_per_game'),
      x2pa_per_game: avg('x2pa_per_game'),
      x2p_percent: avgPct('x2p_percent'),
      e_fg_percent: avg('e_fg_percent'),
      ft_per_game: avg('ft_per_game'),
      fta_per_game: avg('fta_per_game'),
      ft_percent: avgPct('ft_percent'),
      orb_per_game: avg('orb_per_game'),
      drb_per_game: avg('drb_per_game'),
      trb_per_game: avg('trb_per_game'),
      ast_per_game: avg('ast_per_game'),
      stl_per_game: avg('stl_per_game'),
      blk_per_game: avg('blk_per_game'),
      tov_per_game: avg('tov_per_game'),
      pf_per_game: avg('pf_per_game'),
      pts_per_game: avg('pts_per_game'),
    };
    summaries.push({
      label: `${validRows.length > 0 ? validRows.length : rows.length} Yrs`,
      isBold: true,
      row: careerRow,
    });

    // Per-team rows (only if player played for multiple teams, skip aggregate markers)
    if (teamGroups.size > 1) {
      for (const [team, teamRows] of teamGroups) {
        if (team === '2TM' || team === 'TOT') continue;
        const tG = teamRows.reduce((s, r) => s + (Number(r.g) || 0), 0);
        if (tG === 0) continue;
        const tAvg = (key: keyof PlayerPerGameRow): number =>
          teamRows.reduce((s, r) => s + (Number(r[key]) || 0) * (Number(r.g) || 0), 0) / tG;
        const tRow: Partial<PlayerPerGameRow> = {
          season_end_year: 0,
          age: null,
          team,
          pos: '',
          lg: '',
          g: tG,
          gs: null,
          mp_per_game: tAvg('mp_per_game'),
          fg_per_game: tAvg('fg_per_game'),
          fga_per_game: tAvg('fga_per_game'),
          fg_percent: tAvg('fg_percent'),
          x3p_per_game: tAvg('x3p_per_game'),
          x3pa_per_game: tAvg('x3pa_per_game'),
          x3p_percent: tAvg('x3p_percent'),
          x2p_per_game: tAvg('x2p_per_game'),
          x2pa_per_game: tAvg('x2pa_per_game'),
          x2p_percent: tAvg('x2p_percent'),
          e_fg_percent: tAvg('e_fg_percent'),
          ft_per_game: tAvg('ft_per_game'),
          fta_per_game: tAvg('fta_per_game'),
          ft_percent: tAvg('ft_percent'),
          orb_per_game: tAvg('orb_per_game'),
          drb_per_game: tAvg('drb_per_game'),
          trb_per_game: tAvg('trb_per_game'),
          ast_per_game: tAvg('ast_per_game'),
          stl_per_game: tAvg('stl_per_game'),
          blk_per_game: tAvg('blk_per_game'),
          tov_per_game: tAvg('tov_per_game'),
          pf_per_game: tAvg('pf_per_game'),
          pts_per_game: tAvg('pts_per_game'),
        };
        const yrLabel = teamRows.length === 1 ? '1 Yr' : `${teamRows.length} Yrs`;
        summaries.push({ label: `${team} (${yrLabel})`, isBold: true, row: tRow });
      }
    }

    return summaries;
  }, [rows]);

  const perGameHeaders = [
    'Season',
    'Age',
    'Tm',
    'Lg',
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
    '2P',
    '2PA',
    '2P%',
    'eFG%',
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
    'Awards',
  ];

  const sortKeyMap: Record<string, string> = {
    Season: 'season_end_year',
    Age: 'age',
    Tm: 'team',
    Lg: 'lg',
    Pos: 'pos',
    G: 'g',
    GS: 'gs',
    MP: 'mp_per_game',
    FG: 'fg_per_game',
    FGA: 'fga_per_game',
    'FG%': 'fg_percent',
    '3P': 'x3p_per_game',
    '3PA': 'x3pa_per_game',
    '3P%': 'x3p_percent',
    '2P': 'x2p_per_game',
    '2PA': 'x2pa_per_game',
    '2P%': 'x2p_percent',
    'eFG%': 'e_fg_percent',
    FT: 'ft_per_game',
    FTA: 'fta_per_game',
    'FT%': 'ft_percent',
    ORB: 'orb_per_game',
    DRB: 'drb_per_game',
    TRB: 'trb_per_game',
    AST: 'ast_per_game',
    STL: 'stl_per_game',
    BLK: 'blk_per_game',
    TOV: 'tov_per_game',
    PF: 'pf_per_game',
    PTS: 'pts_per_game',
  };

  const renderCell = (r: PlayerPerGameRow | Partial<PlayerPerGameRow>, col: string) => {
    switch (col) {
      case 'Season':
        if ('season_end_year' in r && r.season_end_year && r.season_end_year > 0)
          return formatSeason(r.season_end_year);
        return (r as { label?: string }).label ?? '—';
      case 'Age':
        return r.age ?? '—';
      case 'Tm':
        return r.team === '2TM' ? (
          <span className="italic text-fg-dim">{r.team}</span>
        ) : (
          (r.team ?? '—')
        );
      case 'Lg':
        return ('lg' in r ? r.lg : '—') ?? '—';
      case 'Pos':
        return r.pos ?? '—';
      case 'G':
        return r.g ?? '—';
      case 'GS':
        return r.gs ?? '—';
      case 'MP':
        return (
          <span className={highlightClass(r.mp_per_game, best(mpValues), worst(mpValues))}>
            {formatNumber(r.mp_per_game)}
          </span>
        );
      case 'FG':
        return formatNumber(r.fg_per_game);
      case 'FGA':
        return formatNumber(r.fga_per_game);
      case 'FG%':
        return <PctBar value={r.fg_percent} />;
      case '3P':
        return formatNumber(r.x3p_per_game, 1);
      case '3PA':
        return formatNumber(r.x3pa_per_game, 1);
      case '3P%':
        return <PctBar value={r.x3p_percent} />;
      case '2P':
        return formatNumber(r.x2p_per_game, 1);
      case '2PA':
        return formatNumber(r.x2pa_per_game, 1);
      case '2P%':
        return <PctBar value={r.x2p_percent} />;
      case 'eFG%':
        return <PctBar value={r.e_fg_percent} />;
      case 'FT':
        return formatNumber(r.ft_per_game, 1);
      case 'FTA':
        return formatNumber(r.fta_per_game, 1);
      case 'FT%':
        return <PctBar value={r.ft_percent} />;
      case 'ORB':
        return formatNumber(r.orb_per_game, 1);
      case 'DRB':
        return formatNumber(r.drb_per_game, 1);
      case 'TRB':
        return (
          <span className={highlightClass(r.trb_per_game, best(trbValues), worst(trbValues))}>
            {formatNumber(r.trb_per_game, 1)}
          </span>
        );
      case 'AST':
        return (
          <span className={highlightClass(r.ast_per_game, best(astValues), worst(astValues))}>
            {formatNumber(r.ast_per_game, 1)}
          </span>
        );
      case 'STL':
        return (
          <span className={highlightClass(r.stl_per_game, best(stlValues), worst(stlValues))}>
            {formatNumber(r.stl_per_game, 1)}
          </span>
        );
      case 'BLK':
        return (
          <span className={highlightClass(r.blk_per_game, best(blkValues), worst(blkValues))}>
            {formatNumber(r.blk_per_game, 1)}
          </span>
        );
      case 'TOV':
        return formatNumber(r.tov_per_game, 1);
      case 'PF':
        return formatNumber(r.pf_per_game, 1);
      case 'PTS':
        return (
          <span className={highlightClass(r.pts_per_game, best(ptsValues), worst(ptsValues))}>
            {formatNumber(r.pts_per_game, 1)}
          </span>
        );
      case 'Awards':
        if ('season_end_year' in r && r.season_end_year && r.season_end_year > 0) {
          const yrAwards = awardsBySeason.get(Number(r.season_end_year));
          return yrAwards?.length ? yrAwards.join(', ') : '';
        }
        return '';
      default:
        return '';
    }
  };

  const getStickyClass = (col: string): string => {
    switch (col) {
      case 'Season':
        return 'sticky left-0 z-[5] bg-surface';
      case 'Age':
        return 'sticky left-[4.5rem] z-[5] bg-surface';
      case 'Tm':
        return 'sticky left-[7rem] z-[5] bg-surface';
      case 'G':
        return 'sticky left-[9.5rem] z-[5] bg-surface';
      default:
        return '';
    }
  };

  return (
    <div className="relative">
      {/* Right-edge fade scroll indicator */}
      <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-8 bg-gradient-to-l from-surface/80 to-transparent" />
      {/* Bottom-edge fade scroll indicator */}
      <div className="pointer-events-none absolute bottom-0 left-0 z-10 h-6 w-full bg-gradient-to-t from-surface/60 to-transparent" />
      <table className="min-w-full font-mono text-xs">
        <thead className="sticky top-0 z-10">
          <tr className="bg-surface text-fg-dim">
            {perGameHeaders.map((h) => {
              const sortKey = sortKeyMap[h];
              const isActive = sortCol === sortKey;
              return (
                <th
                  key={h}
                  onClick={sortKey ? () => handleSort(sortKey) : undefined}
                  className={`border-b-2 border-border px-2 py-1.5 text-left font-semibold whitespace-nowrap ${getStickyClass(h)} ${sortKey ? 'cursor-pointer hover:text-fg select-none' : ''}`}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {h}
                    {isActive && (
                      <span className="text-[8px] leading-none">
                        {sortDir === 'desc' ? '▼' : '▲'}
                      </span>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/* Season rows */}
          {sortedRows.map((r) => (
            <tr
              key={`per-game-${r.season_end_year}-${r.team ?? ''}-${r.pos ?? ''}`}
              className="border-b border-surface-alt/50 text-fg-muted last:border-b-0 hover:bg-surface-alt/40 transition-colors even:bg-surface-alt/20"
            >
              {perGameHeaders.map((col) => (
                <td
                  key={col}
                  className={`px-2 py-0.5 ${getStickyClass(col)} ${col === 'Season' ? 'font-medium text-fg whitespace-nowrap' : ''}`}
                >
                  {renderCell(r, col)}
                </td>
              ))}
            </tr>
          ))}
          {/* Summary rows */}
          {summaryRows.map((s) => (
            <tr
              key={`summary-pergame-${s.label.replace(/\s+/g, '-')}`}
              className={`border-t-2 border-border text-fg last:border-b-0 ${
                s.isBold ? 'font-bold' : 'font-medium'
              } bg-surface-alt/40`}
            >
              {perGameHeaders.map((col) => (
                <td
                  key={col}
                  className={`px-2 py-0.5 ${getStickyClass(col)} ${
                    col === 'Season'
                      ? 'font-bold text-fg whitespace-nowrap'
                      : col === 'Age' || col === 'Tm' || col === 'G'
                        ? 'text-fg-muted'
                        : ''
                  }`}
                >
                  {col === 'Season' ? s.label : renderCell(s.row as PlayerPerGameRow, col)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
          <td className="px-2 py-0.5">
            <PctBar value={r.ts_percent} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.x3p_ar} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.f_tr} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.orb_percent} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.drb_percent} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.trb_percent} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.ast_percent} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.stl_percent} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.blk_percent} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.tov_percent} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.usg_percent} />
          </td>
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
          <td className="px-2 py-0.5">
            <PctBar value={r.fg_percent} />
          </td>
          <td className="px-2 py-0.5">{formatNumber(r.avg_dist_fga, 1)}</td>
          <td className="px-2 py-0.5">
            <PctBar value={r.percent_fga_from_x0_3_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.percent_fga_from_x3_10_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.percent_fga_from_x10_16_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.percent_fga_from_x16_3p_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.percent_fga_from_x3p_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.fg_percent_from_x0_3_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.fg_percent_from_x3_10_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.fg_percent_from_x10_16_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.fg_percent_from_x16_3p_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.fg_percent_from_x3p_range} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.percent_assisted_x2p_fg} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.percent_assisted_x3p_fg} />
          </td>
          <td className="px-2 py-0.5">
            <PctBar value={r.percent_dunks_of_fga} />
          </td>
          <td className="px-2 py-0.5">{r.num_of_dunks ?? '—'}</td>
          <td className="px-2 py-0.5">
            <PctBar value={r.percent_corner_3s_of_3pa} />
          </td>
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
          <td className="px-2 py-0.5">{formatPctValue(r.pg_percent)}</td>
          <td className="px-2 py-0.5">{formatPctValue(r.sg_percent)}</td>
          <td className="px-2 py-0.5">{formatPctValue(r.sf_percent)}</td>
          <td className="px-2 py-0.5">{formatPctValue(r.pf_percent)}</td>
          <td className="px-2 py-0.5">{formatPctValue(r.c_percent)}</td>
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
                <PctBar value={z.fg_pct} />
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
  CareerStatRow,
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
