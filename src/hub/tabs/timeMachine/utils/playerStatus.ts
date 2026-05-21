import type { DbRow } from '../../../core/types.js';

/** True when the player should be shown as active (not retired). */
export function isPlayerActive(meta: DbRow): boolean {
  if (meta.is_active === true) return true;
  const toYear = meta.to_year;
  if (toYear === null || toYear === undefined || toYear === '') {
    // null to_year means still playing; is_active is often stale in dim_player
    return true;
  }
  return false;
}

export function formatCareerEndYear(meta: DbRow): string {
  if (meta.to_year === null || meta.to_year === undefined || meta.to_year === '') {
    return isPlayerActive(meta) ? 'Present' : '—';
  }
  return String(meta.to_year);
}

export function formatPlayerStatusLabel(meta: DbRow): 'Active' | 'Retired' {
  return isPlayerActive(meta) ? 'Active' : 'Retired';
}
