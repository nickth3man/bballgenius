# `packages/web/src/lib/`

## Responsibility

Lightweight library modules for the web package — shared utility code that is conceptually "library-grade" rather than "utility-grade". Currently contains a single module: NBA team color mappings used by the Game Center score banner. This directory is for code that has a specific domain concept (team branding) rather than generic formatting functions.

## Design

### `teamColors.ts`

A static lookup table mapping NBA team 3-letter abbreviations to their official primary brand colors.

```ts
export const teamColors: Record<string, string> = {
  ATL: '#E03A3E',   // Atlanta Hawks - Torch Red
  BOS: '#007A33',   // Boston Celtics - Shamrock Green
  LAL: '#552583',   // Los Angeles Lakers - Purple
  // ... 30 teams total
};

export function teamColor(abbrev: string | null | undefined): string {
  if (!abbrev) return 'var(--primary)';
  return teamColors[abbrev.toUpperCase()] ?? 'var(--primary)';
}
```

**Design decisions:**
- **Static map** — Colors are hardcoded from published NBA brand guidelines. If the data layer ever exposes a `primary_color` column, this can be replaced with a DB lookup.
- **Fallback** — Unknown/historical franchises fall back to `var(--primary)` (jersey blue) rather than crashing.
- **Single consumer** — Used exclusively by `TeamCrest` in `components/ui/team-crest.tsx` to color team abbreviation badges in the game center score banner.

## Flow

```
game-center.tsx
  └─ <TeamCrest abbrev={awayAbbrev} color={teamColor(awayAbbrev)} />
       └─ teamColor('LAL') → '#552583'
       └─ TeamCrest renders <span> with background/ border in that color
```

## Integration

- **Consumer** — `routes/game-center.tsx` (the `ScoreBanner` sub-component).
- **No data package dependency** — Pure static data, no imports from `packages/data`.
- **No other consumers** — Not used by time-machine, chat, or SQL sandbox.
