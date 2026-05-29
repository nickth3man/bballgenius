import { isNoColor, Theme } from '../../../shared/utils/theme.js';

export { isNoColor, Theme };

export function dimOrPlain(text: string): string {
  if (isNoColor()) return text;
  return `\x1b[2m${text}\x1b[0m`;
}

export function statusText(text: string): string {
  return dimOrPlain(text);
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
