export function isNoColor(): boolean {
  const value = process.env['NO_COLOR'];
  return value !== undefined && value !== '';
}

export const Theme = {
  primary: '#7aa2f7',
  secondary: '#bb9af7',
  accent: '#2ac3de',
  success: '#9ece6a',
  error: '#f7768e',
  warning: '#e0af68',
  foreground: '#a9b1d6',
  background: '#1a1b26',
  borderFocused: '#bb9af7',
  borderNormal: '#4a5280',
  borderStyle: 'single' as const,
  titleAlignment: 'left' as const,
};
