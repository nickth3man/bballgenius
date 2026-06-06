import type {
  PlayerCareerTotalsRow,
  PlayerFranchiseStandingRow,
  PlayerMetaRow,
} from 'data/tabs/time-machine/queries';
import { type ReactNode, useState } from 'react';

import { formatNumber, formatPct } from '../../../../utils/formatters.js';
import { adjustColor, getInitials, pickPlayerColor } from '../../../../utils/theme.js';
import { SectionCard } from '../internal/section-card.js';

export interface DossierHeaderProps {
  meta: PlayerMetaRow | null;
  totals: PlayerCareerTotalsRow | null;
  franchise: PlayerFranchiseStandingRow[];
  isActive: boolean;
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

function formatBirthDate(value: string | null | undefined): string {
  if (!value) return '\u2014';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function ageString(birthDate: string | null | undefined): string {
  if (!birthDate) return '\u2014';
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return '\u2014';
  const ageMs = Date.now() - d.getTime();
  const years = ageMs / (365.25 * 24 * 60 * 60 * 1000);
  return `${Math.floor(years)} yrs`;
}

function heightInchesToFtIn(heightInches: number | null | string | undefined): string {
  if (heightInches == null) return '\u2014';
  const inches = Number(heightInches);
  if (!Number.isFinite(inches) || inches <= 0) return '\u2014';
  const ft = Math.floor(inches / 12);
  const rem = Math.round(inches - ft * 12);
  return `${ft}\u2032${rem}\u2033`;
}

export function DossierHeader({
  meta,
  totals,
  franchise,
  isActive,
}: DossierHeaderProps): ReactNode {
  const [imgError, setImgError] = useState(false);
  const fullName = meta?.full_name ?? '\u2014';
  const position = meta?.primary_position ?? '\u2014';
  const heightFt = heightInchesToFtIn(meta?.height_inches);
  const weight = meta?.body_weight_lbs != null ? `${meta.body_weight_lbs} lbs` : '\u2014';
  const born = formatBirthDate(meta?.birth_date);
  const age = ageString(meta?.birth_date);
  const school = meta?.school || '\u2014';
  const country = meta?.country || '\u2014';

  const draftLine =
    meta?.draft_year != null
      ? `${meta.draft_year} \u00b7 R${meta.draft_round ?? '?'} \u00b7 P${meta.draft_number ?? '?'}`
      : 'Undrafted';

  const seasonSpan =
    totals?.first_season && totals.last_season
      ? `${totals.first_season} \u2192 ${totals.last_season} \u00b7 ${totals.seasons_played ?? '?'} seasons`
      : meta?.from_year != null && meta?.to_year != null
        ? `${meta.from_year} \u2192 ${isActive ? 'Present' : meta.to_year}`
        : '\u2014';

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
        {/* Player headshot with initials fallback */}
        <div className="relative h-24 w-24 shrink-0">
          {meta?.person_id && !imgError ? (
            <img
              src={`https://cdn.nba.com/headshots/nba/latest/260x190/${meta.person_id}.png`}
              alt={fullName}
              className="h-full w-full rounded-full border-2 object-cover shadow-md"
              style={{
                borderColor: adjustColor(playerColor, -20),
                background: `linear-gradient(135deg, ${playerColor}, ${adjustColor(playerColor, -30)})`,
              }}
              onError={() => setImgError(true)}
              loading="lazy"
            />
          ) : null}
          {imgError || !meta?.person_id ? (
            <div
              className="flex h-full w-full items-center justify-center rounded-full border-2 text-2xl font-black text-white shadow-md"
              style={{
                background: `linear-gradient(135deg, ${playerColor}, ${adjustColor(playerColor, -30)})`,
                borderColor: adjustColor(playerColor, -20),
              }}
              aria-hidden="true"
            >
              {getInitials(fullName)}
            </div>
          ) : null}
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
