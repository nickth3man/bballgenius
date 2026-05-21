import type { CareerStatRow } from '../queries.js';

/** Maps calendar-year labels (e.g. 2025) to NBA season labels (e.g. 2024-25). */
export function canonicalSeasonKey(seasonYear: string): string {
  if (/^\d{4}-\d{2,4}$/.test(seasonYear)) {
    return seasonYear;
  }
  const y = Number.parseInt(seasonYear, 10);
  if (Number.isNaN(y)) {
    return seasonYear;
  }
  const start = y - 1;
  const end = String(y).slice(-2);
  return `${start}-${end}`;
}

function statCompleteness(row: CareerStatRow): number {
  return [row.reb, row.stl, row.blk, row.gs, row.ts_pct, row.per].filter(
    (v) => v !== null && v !== undefined,
  ).length;
}

/**
 * Removes duplicate season stat rows from nbadb-style double labeling
 * (e.g. both "2025" and "2024-25" for the same season).
 */
export function dedupeCareerStats(rows: CareerStatRow[]): CareerStatRow[] {
  const byKey = new Map<string, CareerStatRow>();

  for (const row of rows) {
    const key = `${canonicalSeasonKey(String(row.season_year))}|${row.is_playoffs}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }

    const rowHasHyphen = String(row.season_year).includes('-');
    const existingHasHyphen = String(existing.season_year).includes('-');

    if (rowHasHyphen && !existingHasHyphen) {
      byKey.set(key, row);
    } else if (rowHasHyphen === existingHasHyphen) {
      if (statCompleteness(row) > statCompleteness(existing)) {
        byKey.set(key, row);
      }
    }
  }

  return [...byKey.values()].sort((a, b) => {
    const bySeason = String(b.season_year).localeCompare(String(a.season_year));
    if (bySeason !== 0) return bySeason;
    return Number(b.is_playoffs) - Number(a.is_playoffs);
  });
}
