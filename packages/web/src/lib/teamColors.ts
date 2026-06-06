/**
 * NBA team primary brand colors — keyed by 3-letter team abbreviation
 * (e.g. `teamColors['LAL']` = '#552583').
 *
 * Source: official NBA team brand guidelines (publicly published).
 * Used to color TeamCrest chips in the Game Center score banner so the
 * crests reflect team identity rather than falling back to brand tokens.
 *
 * If the data layer ever exposes a per-team `primary_color` column, this
 * file can be replaced with a lookup against the DB.
 */

export const teamColors: Record<string, string> = {
  ATL: '#E03A3E',
  BOS: '#007A33',
  BKN: '#000000',
  CHA: '#1D1160',
  CHI: '#CE1141',
  CLE: '#860038',
  DAL: '#00538C',
  DEN: '#0E2240',
  DET: '#C8102E',
  GSW: '#1D428A',
  HOU: '#CE1141',
  IND: '#002D62',
  LAC: '#C8102E',
  LAL: '#552583',
  MEM: '#5D76A9',
  MIA: '#98002E',
  MIL: '#00471B',
  MIN: '#0C2340',
  NOP: '#0C2340',
  NYK: '#006BB6',
  OKC: '#007AC1',
  ORL: '#0077C0',
  PHI: '#006BB6',
  PHX: '#1D1160',
  POR: '#E03A3E',
  SAC: '#5A2D81',
  SAS: '#C4CED4',
  TOR: '#CE1141',
  UTA: '#002B5C',
  WAS: '#002B5C',
};

/**
 * Returns the team primary color for the given 3-letter abbreviation, falling
 * back to the brand `--primary` (jersey blue) when the team is unknown
 * (e.g. historical franchises, ABA, or new expansion teams not yet mapped).
 */
export function teamColor(abbrev: string | null | undefined): string {
  if (!abbrev) return 'var(--primary)';
  return teamColors[abbrev.toUpperCase()] ?? 'var(--primary)';
}
