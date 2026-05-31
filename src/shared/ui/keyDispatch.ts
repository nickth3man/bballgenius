import type { AppKeyEvent } from '../../core/input.js';

export type KeyHandler = (event: AppKeyEvent) => boolean;

/**
 * Run an ordered list of key handlers, returning at the first one that reports
 * it handled the event (returned `true`). Preserves exact short-circuit order,
 * replacing the repeated `if (handled) return true;` ladders in each tab's
 * `handleKeyPress`.
 */
export function dispatchKey(event: AppKeyEvent, handlers: KeyHandler[]): boolean {
  for (const handler of handlers) {
    if (handler(event)) return true;
  }
  return false;
}
