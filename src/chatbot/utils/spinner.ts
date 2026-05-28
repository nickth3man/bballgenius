export const SPINNER_FRAMES: readonly string[] = [
  '⠋',
  '⠙',
  '⠹',
  '⠸',
  '⠼',
  '⠴',
  '⠦',
  '⠧',
  '⠇',
  '⠏',
] as const;

export function getSpinnerFrame(tick: number, text?: string): string {
  const frame = SPINNER_FRAMES[tick % SPINNER_FRAMES.length]!;
  if (text === undefined || text === '') {
    return frame;
  }
  return `${frame} ${text}`;
}
