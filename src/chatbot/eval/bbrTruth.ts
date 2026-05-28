/**
 * BBR-truth resolver: the authoritative source of truth for the eval harness.
 *
 * Reads eval/bbr-truth.json (values scraped live from basketball-reference.com,
 * NBA-only, stamped with an asOf date) and resolves a groundTruthId to the BBR
 * value. This is the anchor of the three-way comparison: agent vs DB vs BBR.
 *
 * Per project rule: nothing in the legacy ground-truth.json is trusted. Only
 * entries marked verified:true here count as fact. For unverified ids,
 * `verified` comes back false and the harness must NOT classify a DB mismatch
 * as a data-quality issue (it cannot know which side is right).
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// JSON import kept via require so this works under both bun and tsc/node ESM.
const TRUTH = require('./bbr-truth.json') as BbrTruthFile;

interface LeaderRow {
  rank: number;
  player: string;
  value: number;
}
interface VerifiedBlock<T> {
  verified: boolean;
  rows?: T;
}
interface BbrTruthFile {
  _meta: { source: string; asOf: string; league_scope: string };
  career_points_leaders: VerifiedBlock<LeaderRow[]>;
  career_assists_leaders: VerifiedBlock<LeaderRow[]>;
  [key: string]: unknown;
}

export interface BbrTruthResult {
  id: string;
  /** True when a value exists for this id (verified or not). */
  supported: boolean;
  /** True only when the value is scrape-verified and may anchor a data-quality verdict. */
  verified: boolean;
  value: string | number | null;
  extra?: Record<string, unknown>;
  asOf: string;
  source?: string;
}

const LEADER_BLOCKS = new Set([
  'career_points_leaders',
  'career_assists_leaders',
  'career_rebounds_leaders',
  'career_steals_leaders',
  'career_blocks_leaders',
  'career_three_pointers_leaders',
]);

function seasonEndYear(season: string): number | null {
  const m = season.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const startCentury = Math.floor(Number(m[1]) / 100) * 100;
  const end = startCentury + Number(m[2]);
  return end < Number(m[1]) ? end + 100 : end;
}

const asOf = (): string => TRUTH._meta?.asOf ?? 'unknown';

function none(id: string): BbrTruthResult {
  return { id, supported: false, verified: false, value: null, asOf: asOf() };
}

export function resolveBbrValue(id: string): BbrTruthResult {
  const parts = id.split('.');
  const head = parts[0] ?? '';
  const p = (i: number): string => parts[i] ?? '';
  // biome-ignore lint/suspicious/noExplicitAny: truth file is dynamically shaped JSON.
  const t = TRUTH as any;

  // career_<stat>_leaders.<rank>
  if (LEADER_BLOCKS.has(head)) {
    const block = t[head];
    if (!block?.rows) return none(id);
    const rank = Number(p(1));
    const row = block.rows.find((r: LeaderRow) => r.rank === rank);
    if (!row)
      return {
        id,
        supported: false,
        verified: false,
        value: null,
        asOf: asOf(),
        source: block.source,
      };
    return {
      id,
      supported: true,
      verified: !!block.verified,
      value: row.player,
      extra: { value: row.value },
      asOf: asOf(),
      source: block.source,
    };
  }

  // player_career_totals.<Player>.<stat>
  if (head === 'player_career_totals') {
    const player = p(1);
    const stat = p(2) ?? 'points';
    const block = t.player_career_totals?.[player];
    const field = block?.[stat];
    if (!field) return none(id);
    return {
      id,
      supported: true,
      verified: !!field.verified,
      value: field.value,
      asOf: asOf(),
      source: block.source,
    };
  }

  // mvp_winners.<season>  |  mvp_winners.<Player_Name> (count)
  if (head === 'mvp_winners') {
    const block = t.mvp_winners;
    if (!block?.rows) return none(id);
    const arg = parts.slice(1).join('.');
    const year = seasonEndYear(arg);
    if (year != null) {
      const row = block.rows.find((r: { season: string; player: string }) => r.season === arg);
      if (!row) return none(id);
      return {
        id,
        supported: true,
        verified: !!block.verified,
        value: row.player,
        asOf: asOf(),
        source: block.source,
      };
    }
    const name = arg.replace(/_/g, ' ');
    const count = block.rows.filter((r: { player: string }) => r.player === name).length;
    return {
      id,
      supported: true,
      verified: !!block.verified,
      value: count,
      asOf: asOf(),
      source: block.source,
    };
  }

  // team_records.<Team_Year> -> "W-L"
  if (head === 'team_records') {
    const key = parts.slice(1).join('.');
    const block = t.team_records?.[key];
    if (!block || block.wins == null) return none(id);
    return {
      id,
      supported: true,
      verified: !!block.verified,
      value: `${block.wins}-${block.losses}`,
      extra: { wins: block.wins, losses: block.losses },
      asOf: asOf(),
      source: block.source,
    };
  }

  // season_leaders_2024.<stat>.<rank> (rank 1 only)
  if (head === 'season_leaders_2024') {
    const block = t.season_leaders_2024?.[p(1)];
    if (!block?.leader) return none(id);
    return {
      id,
      supported: true,
      verified: !!block.verified,
      value: block.leader.player,
      extra: { value: block.leader.value },
      asOf: asOf(),
      source: block.source,
    };
  }

  // single_games.2016_finals_game7[.leading_scorers]
  if (head === 'single_games') {
    const block = t.single_games?.[p(1)];
    if (!block) return none(id);
    if (p(2) === 'leading_scorers') {
      const top = [...block.leading_scorers].sort(
        (a: { points: number }, b: { points: number }) => b.points - a.points,
      )[0];
      if (!top) return none(id);
      return {
        id,
        supported: true,
        verified: !!block.verified,
        value: top.player,
        extra: { points: top.points },
        asOf: asOf(),
        source: block.source,
      };
    }
    return {
      id,
      supported: true,
      verified: !!block.verified,
      value: `${block.away_team} ${block.away_score}, ${block.home_team} ${block.home_score}`,
      extra: { away_score: block.away_score, home_score: block.home_score },
      asOf: asOf(),
      source: block.source,
    };
  }

  return none(id);
}
