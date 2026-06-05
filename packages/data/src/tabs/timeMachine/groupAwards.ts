/**
 * Pure helpers for grouping `PlayerAwardRow[]` into display buckets for the
 * Player Dossier UI. This module has **no** dependencies on `core/db.js`
 * (no DuckDB imports) so it is safe to import from any module bundled into
 * the web client — it cannot pull a CJS native addon into the client graph.
 *
 * Kept as the canonical home for `groupAwardsByCategory`, `GroupedAward`, and
 * `PlayerAwardRow`. Re-exported from `queries.ts` for back-compat.
 */

export interface PlayerAwardRow {
  award: string;
  season_year: string;
  count: number | string;
}

export interface GroupedAward {
  category: string;
  awards: { season: string; label: string }[];
}

/**
 * Groups award rows by the leading token of the award label.
 * e.g. "All-NBA 1st" → group "All-NBA", "All-Star" → group "All-Star".
 * All-NBA groups sort by team number.
 */
export function groupAwardsByCategory(awards: PlayerAwardRow[]): GroupedAward[] {
  const map = new Map<string, { season: string; label: string }[]>();

  for (const a of awards) {
    const label = a.award;
    // Leading token is the first word(s) before a space followed by a number (e.g. "All-NBA 1st")
    // or just the first word (e.g. "All-Star")
    const leading = label.split(/\s+/).slice(0, -1).join(' ') || label;
    const category = leading || label;

    if (!map.has(category)) {
      map.set(category, []);
    }
    map.get(category)!.push({ season: a.season_year, label });
  }

  // Sort All-NBA groups by team number ascending
  for (const [, entries] of map) {
    entries.sort((a, b) => {
      const aNum = extractTeamNumber(a.label);
      const bNum = extractTeamNumber(b.label);
      if (aNum !== null && bNum !== null) return aNum - bNum;
      return a.label.localeCompare(b.label);
    });
  }

  return Array.from(map.entries()).map(([category, awards]) => ({
    category,
    awards,
  }));
}

/** Extract the team number from labels like "All-NBA 1st" → 1. */
function extractTeamNumber(label: string): number | null {
  const m = label.match(/(\d+)(st|nd|rd|th)$/);
  return m ? Number(m[1]) : null;
}
