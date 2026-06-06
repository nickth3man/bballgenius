/** Generate a deterministic color from a string (player_id). */
function pickPlayerColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 45%)`;
}

/** Darken/lighten an HSL color by adjusting lightness. */
function adjustColor(hsl: string, amount: number): string {
  const m = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!m) return hsl;
  const h = Number(m[1]);
  const s = Number(m[2]);
  const l = Math.max(0, Math.min(100, Number(m[3]) + amount));
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/** Get initials from a full name (e.g. "Pete Maravich" \u2192 "PM"). */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

export { adjustColor, getInitials, pickPlayerColor };
