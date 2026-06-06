function heightInchesToFtIn(heightInches: number | null | string | undefined): string {
  if (heightInches == null) return '\u2014';
  const inches = Number(heightInches);
  if (!Number.isFinite(inches) || inches <= 0) return '\u2014';
  const ft = Math.floor(inches / 12);
  const rem = Math.round(inches - ft * 12);
  return `${ft}\u2032${rem}\u2033`;
}

function formatNumber(value: number | string | null | undefined, digits = 1): string {
  if (value == null) return '\u2014';
  const n = Number(value);
  if (!Number.isFinite(n)) return '\u2014';
  return n.toFixed(digits);
}

function formatPct(value: number | string | null | undefined, digits = 1): string {
  if (value == null) return '\u2014';
  const n = Number(value);
  if (!Number.isFinite(n)) return '\u2014';
  return `${(n * 100).toFixed(digits)}%`;
}

/** Format a value that is already in percentage units (e.g. 6.7 means 6.7%). */
function formatPctValue(value: number | string | null | undefined, digits = 1): string {
  if (value == null) return '\u2014';
  const n = Number(value);
  if (!Number.isFinite(n)) return '\u2014';
  return `${n.toFixed(digits)}%`;
}

function formatSeason(seasonEndYear: number | string | null | undefined): string {
  if (seasonEndYear == null) return '\u2014';
  const y = Number(seasonEndYear);
  if (!Number.isFinite(y)) return String(seasonEndYear);
  return `${y - 1}-${String(y).slice(-2)}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '\u2014';
  return value;
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

export {
  ageString,
  formatBirthDate,
  formatDate,
  formatNumber,
  formatPct,
  formatPctValue,
  formatSeason,
  heightInchesToFtIn,
};
