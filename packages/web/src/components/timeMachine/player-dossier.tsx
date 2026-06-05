import { type ReactNode, useState } from 'react';

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
    <div className="mb-2 border-b border-border pb-1 text-xs uppercase tracking-wide text-fg-muted">
      {children}
    </div>
  );
}

function SectionCard({ children }: { children: ReactNode }): ReactNode {
  return <section className="rounded border border-border bg-surface p-3">{children}</section>;
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
    totals != null && totals.first_season && totals.last_season
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
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-2 font-mono text-xs text-fg-muted">
          <CareerStat label="GP" value={formatNumber(totals.career_gp, 0)} />
          <CareerStat label="PPG" value={formatNumber(totals.career_ppg)} />
          <CareerStat label="RPG" value={formatNumber(totals.career_rpg)} />
          <CareerStat label="APG" value={formatNumber(totals.career_apg)} />
          <CareerStat label="SPG" value={formatNumber(totals.career_spg)} />
          <CareerStat label="BPG" value={formatNumber(totals.career_bpg)} />
          <CareerStat label="FG%" value={formatPct(totals.career_fg_pct)} />
          <CareerStat label="3P%" value={formatPct(totals.career_fg3_pct)} />
          <CareerStat label="FT%" value={formatPct(totals.career_ft_pct)} />
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

function CareerStat({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <div>
      <span className="text-fg-dim">{label}</span> <span className="text-fg">{value}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Awards Grouped                                                            */
/* -------------------------------------------------------------------------- */

export function AwardsGrouped({ groups }: { groups: GroupedAward[] }): ReactNode {
  if (groups.length === 0) return null;
  return (
    <section>
      <SectionHeader>Awards & Honors</SectionHeader>
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.category} className="flex flex-wrap items-baseline gap-x-2">
            <span className="rounded bg-surface-alt px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-widest text-fg-dim">
              {g.category}
            </span>
            <span className="font-mono text-xs text-fg-muted">
              {g.awards.map((a, i) => (
                <span key={`${a.season}-${a.label}`}>
                  {i > 0 ? ', ' : ''}
                  {a.label} ({a.season})
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
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
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
        {allStarYears.length > 0 ? (
          <span className="text-fg-muted">
            <span className="font-semibold text-secondary">{allStarYears.length}×</span> All-Star
            <span className="ml-1 font-mono text-fg-dim">({allStarYears.join(', ')})</span>
          </span>
        ) : null}
        {topVotes.map((v) => (
          <span key={`${v.award}-${v.season_end_year}`} className="text-fg-muted">
            <span className="text-fg">{String(v.award).toUpperCase()}</span>{' '}
            <span className="font-mono text-fg-dim">
              {formatSeason(v.season_end_year)} · pts {v.pts_won}/{v.pts_max} ·{' '}
              {formatPct(v.share, 1)} share
            </span>
          </span>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Season Tabs                                                               */
/* -------------------------------------------------------------------------- */

const STATS_TABS = [
  'Per Game',
  'Totals',
  'Per 36',
  'Advanced',
  'Shooting',
  'Play-by-Play',
] as const;
type StatsTab = (typeof STATS_TABS)[number];

export interface SeasonTabsProps {
  perGame: PlayerPerGameRow[];
  totals: PlayerTotalsRow[];
  per36: PlayerPer36Row[];
  advanced: PlayerAdvancedRow[];
  shooting: PlayerShootingRow[];
  playByPlay: PlayerPlayByPlayRow[];
}

export function SeasonTabs(props: SeasonTabsProps): ReactNode {
  const [tab, setTab] = useState<StatsTab>('Per Game');
  return (
    <section>
      <SectionHeader>Season Stats</SectionHeader>
      <div className="mb-2 flex flex-wrap gap-1">
        {STATS_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              tab === t ? 'bg-primary text-bg' : 'text-fg-muted hover:bg-surface-alt hover:text-fg'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded border border-border bg-surface">
        {tab === 'Per Game' ? <PerGameTable rows={props.perGame} /> : null}
        {tab === 'Totals' ? <TotalsTable rows={props.totals} /> : null}
        {tab === 'Per 36' ? <Per36Table rows={props.per36} /> : null}
        {tab === 'Advanced' ? <AdvancedTable rows={props.advanced} /> : null}
        {tab === 'Shooting' ? <ShootingTable rows={props.shooting} /> : null}
        {tab === 'Play-by-Play' ? <PlayByPlayTable rows={props.playByPlay} /> : null}
      </div>
    </section>
  );
}

function PerGameTable({ rows }: { rows: PlayerPerGameRow[] }): ReactNode {
  if (rows.length === 0) return <EmptyHint>No per-game data available</EmptyHint>;
  return (
    <table className="min-w-full font-mono text-xs">
      <thead>
        <tr className="text-fg-dim">
          {[
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
          ].map((h) => (
            <th key={h} className="border-b border-surface-alt px-2 py-1 text-left font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={`per-game-${r.season_end_year}-${r.team ?? ''}-${r.pos ?? ''}`}
            className="border-b border-surface-alt text-fg-muted last:border-b-0"
          >
            <td className="px-2 py-0.5">{formatSeason(r.season_end_year)}</td>
            <td className="px-2 py-0.5">{r.age ?? '—'}</td>
            <td className="px-2 py-0.5">{r.team ?? '—'}</td>
            <td className="px-2 py-0.5">{r.pos ?? '—'}</td>
            <td className="px-2 py-0.5">{r.g ?? '—'}</td>
            <td className="px-2 py-0.5">{r.gs ?? '—'}</td>
            <td className="px-2 py-0.5">{formatNumber(r.mp_per_game)}</td>
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
            <td className="px-2 py-0.5">{formatNumber(r.trb_per_game, 1)}</td>
            <td className="px-2 py-0.5">{formatNumber(r.ast_per_game, 1)}</td>
            <td className="px-2 py-0.5">{formatNumber(r.stl_per_game, 1)}</td>
            <td className="px-2 py-0.5">{formatNumber(r.blk_per_game, 1)}</td>
            <td className="px-2 py-0.5">{formatNumber(r.tov_per_game, 1)}</td>
            <td className="px-2 py-0.5">{formatNumber(r.pf_per_game, 1)}</td>
            <td className="px-2 py-0.5">{formatNumber(r.pts_per_game, 1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TotalsTable({ rows }: { rows: PlayerTotalsRow[] }): ReactNode {
  if (rows.length === 0) return <EmptyHint>No totals data available</EmptyHint>;
  const headers = [
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
  ];
  return (
    <table className="min-w-full font-mono text-xs">
      <thead>
        <tr className="text-fg-dim">
          {headers.map((h) => (
            <th key={h} className="border-b border-surface-alt px-2 py-1 text-left font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={`row-${r.season_end_year}-${r.team ?? ''}-${r.pos ?? ''}`}
            className="border-b border-surface-alt text-fg-muted last:border-b-0"
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
      </tbody>
    </table>
  );
}

function Per36Table({ rows }: { rows: PlayerPer36Row[] }): ReactNode {
  if (rows.length === 0) return <EmptyHint>No per-36 data available</EmptyHint>;
  return (
    <table className="min-w-full font-mono text-xs">
      <thead>
        <tr className="text-fg-dim">
          {[
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
          ].map((h) => (
            <th key={h} className="border-b border-surface-alt px-2 py-1 text-left font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={`row-${r.season_end_year}-${r.team ?? ''}-${r.pos ?? ''}`}
            className="border-b border-surface-alt text-fg-muted last:border-b-0"
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
      </tbody>
    </table>
  );
}

function AdvancedTable({ rows }: { rows: PlayerAdvancedRow[] }): ReactNode {
  if (rows.length === 0) return <EmptyHint>No advanced stats available</EmptyHint>;
  return (
    <table className="min-w-full font-mono text-xs">
      <thead>
        <tr className="text-fg-dim">
          {[
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
          ].map((h) => (
            <th key={h} className="border-b border-surface-alt px-2 py-1 text-left font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={`row-${r.season_end_year}-${r.team ?? ''}-${r.pos ?? ''}`}
            className="border-b border-surface-alt text-fg-muted last:border-b-0"
          >
            <td className="px-2 py-0.5">{formatSeason(r.season_end_year)}</td>
            <td className="px-2 py-0.5">{r.team ?? '—'}</td>
            <td className="px-2 py-0.5">{r.age ?? '—'}</td>
            <td className="px-2 py-0.5">{r.g ?? '—'}</td>
            <td className="px-2 py-0.5">{r.mp ?? '—'}</td>
            <td className="px-2 py-0.5">{formatNumber(r.per)}</td>
            <td className="px-2 py-0.5">{formatPct(r.ts_percent)}</td>
            <td className="px-2 py-0.5">{formatPct(r.x3p_ar)}</td>
            <td className="px-2 py-0.5">{formatPct(r.f_tr)}</td>
            <td className="px-2 py-0.5">{formatPct(r.orb_percent)}</td>
            <td className="px-2 py-0.5">{formatPct(r.drb_percent)}</td>
            <td className="px-2 py-0.5">{formatPct(r.trb_percent)}</td>
            <td className="px-2 py-0.5">{formatPct(r.ast_percent)}</td>
            <td className="px-2 py-0.5">{formatPct(r.stl_percent)}</td>
            <td className="px-2 py-0.5">{formatPct(r.blk_percent)}</td>
            <td className="px-2 py-0.5">{formatPct(r.tov_percent)}</td>
            <td className="px-2 py-0.5">{formatPct(r.usg_percent)}</td>
            <td className="px-2 py-0.5">{formatNumber(r.ows, 1)}</td>
            <td className="px-2 py-0.5">{formatNumber(r.dws, 1)}</td>
            <td className="px-2 py-0.5">{formatNumber(r.ws, 1)}</td>
            <td className="px-2 py-0.5">{formatNumber(r.ws_48, 3)}</td>
            <td className="px-2 py-0.5">{formatNumber(r.obpm, 1)}</td>
            <td className="px-2 py-0.5">{formatNumber(r.dbpm, 1)}</td>
            <td className="px-2 py-0.5">{formatNumber(r.bpm, 1)}</td>
            <td className="px-2 py-0.5">{formatNumber(r.vorp, 1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ShootingTable({ rows }: { rows: PlayerShootingRow[] }): ReactNode {
  if (rows.length === 0) return <EmptyHint>No shooting data available (post-2000 era)</EmptyHint>;
  return (
    <table className="min-w-full font-mono text-xs">
      <thead>
        <tr className="text-fg-dim">
          {[
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
          ].map((h) => (
            <th key={h} className="border-b border-surface-alt px-2 py-1 text-left font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={`row-${r.season_end_year}-${r.team ?? ''}-${r.pos ?? ''}`}
            className="border-b border-surface-alt text-fg-muted last:border-b-0"
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
      </tbody>
    </table>
  );
}

function PlayByPlayTable({ rows }: { rows: PlayerPlayByPlayRow[] }): ReactNode {
  if (rows.length === 0) return <EmptyHint>No play-by-play data available</EmptyHint>;
  return (
    <table className="min-w-full font-mono text-xs">
      <thead>
        <tr className="text-fg-dim">
          {[
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
          ].map((h) => (
            <th key={h} className="border-b border-surface-alt px-2 py-1 text-left font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={`row-${r.season_end_year}-${r.team ?? ''}-${r.pos ?? ''}`}
            className="border-b border-surface-alt text-fg-muted last:border-b-0"
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
      </tbody>
    </table>
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
        <table className="min-w-full font-mono text-xs">
          <thead>
            <tr className="text-fg-dim">
              <th className="border-b border-surface-alt px-2 py-1 text-left font-semibold">
                Zone
              </th>
              <th className="border-b border-surface-alt px-2 py-1 text-left font-semibold">FGA</th>
              <th className="border-b border-surface-alt px-2 py-1 text-left font-semibold">FGM</th>
              <th className="border-b border-surface-alt px-2 py-1 text-left font-semibold">FG%</th>
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <tr
                key={z.zone}
                className="border-b border-surface-alt text-fg-muted last:border-b-0"
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
          </tbody>
        </table>
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
            <table className="min-w-full font-mono text-xs">
              <thead>
                <tr className="text-fg-dim">
                  {[
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
                  ].map((h) => (
                    <th
                      key={h}
                      className="border-b border-surface-alt px-2 py-1 text-left font-semibold"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => (
                  <tr
                    key={`gamelog-${g.game_date}-${g.matchup ?? ''}`}
                    className="border-b border-surface-alt text-fg-muted last:border-b-0"
                  >
                    <td className="px-2 py-0.5">{formatDate(g.game_date)}</td>
                    <td className="px-2 py-0.5">{g.matchup ?? '—'}</td>
                    <td
                      className={`px-2 py-0.5 font-semibold ${
                        g.wl === 'W'
                          ? 'text-success'
                          : g.wl === 'L'
                            ? 'text-danger'
                            : 'text-fg-muted'
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
              </tbody>
            </table>
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
                  {formatPct(combine.body_fat_pct, 1)}
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
