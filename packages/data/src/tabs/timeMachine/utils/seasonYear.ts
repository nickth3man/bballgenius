/** Maps season end year (e.g. 2013) to NBA label (e.g. 2012-13). */
export function seasonEndYearToNbaLabel(seasonEndYear: number | string): string {
  const year = Number(seasonEndYear);
  if (Number.isNaN(year)) return String(seasonEndYear);
  const start = year - 1;
  const end = String(year).slice(-2);
  return `${start}-${end}`;
}
