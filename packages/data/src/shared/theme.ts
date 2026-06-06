/**
 * BBallGenius Terminal Hub Theme Settings
 * Consistent TokyoNight style colors and borders with polished contrast.
 */

export const Theme = {
  primary: '#7aa2f7',
  secondary: '#bb9af7',
  accent: '#2ac3de',
  success: '#9ece6a',
  error: '#f7768e',
  warning: '#e0af68',
  foreground: '#a9b1d6',
  foregroundMuted: '#565f89',
  foregroundSubtle: '#414868',
  background: '#1a1b26',
  surface: '#16161e',
  surfaceElevated: '#1a1b26',
  surfaceAlt: '#1f2231',
  inputBg: '#24283b',
  borderFocused: '#2ac3de',
  borderNormal: '#383e5a',

  borderStyle: 'rounded' as const,
  titleAlignment: 'left' as const,
  gap: 1 as const,
  panelPaddingX: 1 as const,
  footerPaddingX: 2 as const,
};

/** True when `NO_COLOR` is set to any non-empty value (https://no-color.org/). */
export function isNoColor(): boolean {
  const value = process.env['NO_COLOR'];
  return value !== undefined && value !== '';
}

/** Live check; prefer `isNoColor()` for dynamic env (e.g. tests). */
export const noColor: boolean = isNoColor();

export type ThemeFgRole =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'success'
  | 'error'
  | 'warning'
  | 'foreground'
  | 'foregroundMuted'
  | 'foregroundSubtle';

const THEME_FG_RGB: Record<ThemeFgRole, [number, number, number]> = {
  primary: [122, 162, 247],
  secondary: [187, 154, 247],
  accent: [42, 195, 222],
  success: [158, 206, 106],
  error: [247, 118, 142],
  warning: [224, 175, 104],
  foreground: [169, 177, 214],
  foregroundMuted: [86, 95, 137],
  foregroundSubtle: [65, 72, 104],
};

function ansiReset(): string {
  return isNoColor() ? '' : '\x1b[0m';
}

function ansiWrap(openSequence: string, text: string): string {
  if (isNoColor()) return text;
  return `${openSequence}${text}${ansiReset()}`;
}

/** 24-bit foreground using theme hex roles. */
export function themeFg(role: ThemeFgRole, text: string): string {
  if (isNoColor()) return text;
  const [r, g, b] = THEME_FG_RGB[role];
  return ansiWrap(`\x1b[38;2;${r};${g};${b}m`, text);
}

export function ansiBold(text: string): string {
  return ansiWrap('\x1b[1m', text);
}

export function ansiDim(text: string): string {
  return ansiWrap('\x1b[2m', text);
}

export function ansiItalic(text: string): string {
  return ansiWrap('\x1b[3m', text);
}

export function ansiUnderline(text: string): string {
  return ansiWrap('\x1b[4m', text);
}

export function ansiGreen(text: string): string {
  return ansiWrap('\x1b[32m', text);
}

export function ansiRed(text: string): string {
  return ansiWrap('\x1b[31m', text);
}

export function ansiYellow(text: string): string {
  return ansiWrap('\x1b[33m', text);
}

export function ansiCyan(text: string): string {
  return ansiWrap('\x1b[36m', text);
}

export function ansiMagenta(text: string): string {
  return ansiWrap('\x1b[35m', text);
}

export function ansiBrightGreen(text: string): string {
  return ansiWrap('\x1b[1;32;40m', text);
}

export function ansiBrightRed(text: string): string {
  return ansiWrap('\x1b[1;31;40m', text);
}
