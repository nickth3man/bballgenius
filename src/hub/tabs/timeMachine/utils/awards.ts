import type { PlayerAwardRow } from '../queries.js';
import { canonicalSeasonKey } from './careerStats.js';

const ACRONYM_LABELS: Record<string, string> = {
  mvp: 'MVP',
  roy: 'Rookie of the Year',
  dpoy: 'Defensive Player of the Year',
  mip: 'Most Improved Player',
  clutch_poy: 'Clutch Player of the Year',
  fmvp: 'Finals MVP',
  all_nba: 'All-NBA',
  all_star: 'All-Star',
};

/** Human-readable label for fact_player_awards.award values (e.g. nba_mvp → NBA MVP). */
export function formatAwardLabel(award: string): string {
  const normalized = award
    .trim()
    .toLowerCase()
    .replace(/^nba[_ ]/, '');
  if (ACRONYM_LABELS[normalized]) {
    return `NBA ${ACRONYM_LABELS[normalized]}`;
  }
  const words = normalized.split(/[_ ]+/).map((word) => {
    if (ACRONYM_LABELS[word]) return ACRONYM_LABELS[word];
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
  return `NBA ${words.join(' ')}`;
}

export interface GroupedPlayerAward {
  award: string;
  label: string;
  seasons: string[];
}

/** Groups award rows by award type; dedupes paired season labels (e.g. 2025 vs 2024-25). */
export function groupPlayerAwards(rows: PlayerAwardRow[]): GroupedPlayerAward[] {
  const byAward = new Map<string, Map<string, string>>();

  for (const row of rows) {
    const awardKey = String(row.award);
    const seasonLabel = String(row.season_year);
    const canon = canonicalSeasonKey(seasonLabel);
    const seasons = byAward.get(awardKey) ?? new Map<string, string>();
    const existing = seasons.get(canon);
    if (!existing || (seasonLabel.includes('-') && !existing.includes('-'))) {
      seasons.set(canon, seasonLabel);
    }
    byAward.set(awardKey, seasons);
  }

  return [...byAward.entries()]
    .map(([award, seasonMap]) => {
      const seasons = [...seasonMap.values()].sort((a, b) => b.localeCompare(a));
      return {
        award,
        label: formatAwardLabel(award),
        seasons,
      };
    })
    .sort((a, b) => b.seasons.length - a.seasons.length || a.label.localeCompare(b.label));
}

/** Formats season list across multiple indented lines for the dossier panel. */
export function formatAwardSeasonLines(seasons: string[], perLine = 4): string[] {
  const lines: string[] = [];
  for (let i = 0; i < seasons.length; i += perLine) {
    lines.push(seasons.slice(i, i + perLine).join(', '));
  }
  return lines;
}
