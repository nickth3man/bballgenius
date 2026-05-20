/**
 * Parses team search input into team name fragment and season year.
 * Examples: "Bulls 1996", "1996 Chicago Bulls", "GSW 2024-25".
 */
export function parseTeamQuery(input: string): { teamQuery: string; year: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const yearMatch = trimmed.match(/\b(19\d{2}|20\d{2})(-\d{2,4})?\b/);
  if (!yearMatch) {
    return null;
  }

  const matchedStr = yearMatch[0];
  const year = yearMatch[1];
  const teamQuery = trimmed.replace(matchedStr, '').replace(/\s+/g, ' ').trim();
  if (!teamQuery) {
    return null;
  }

  return { teamQuery, year };
}
