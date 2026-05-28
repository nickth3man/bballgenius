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
  borderNormal: '#383e5a',
  borderStyle: 'rounded' as const,
  titleAlignment: 'left' as const,
};

export function dimOrPlain(text: string): string {
  if (isNoColor()) return text;
  return `\x1b[2m${text}\x1b[0m`;
}

export function statusText(text: string): string {
  return text;
}

export function bold(text: string): string {
  if (isNoColor()) return text;
  return `\x1b[1m${text}\x1b[0m`;
}

export function label(text: string, colorCode: string): string {
  if (isNoColor()) return text;
  return `\x1b[1;${colorCode}m${text}\x1b[0m`;
}

export function youLabel(): string {
  return label('[You]', '34');
}

export function aiLabel(): string {
  return label('[AI]', '32');
}

export function sqlLabel(): string {
  if (isNoColor()) return '[SQL]';
  return '\x1b[36m[SQL]\x1b[0m';
}

export function errorLabel(): string {
  return label('[Error]', '31');
}
