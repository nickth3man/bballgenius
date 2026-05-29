import { describe, expect, test } from 'bun:test';
import { toAppKeyEvent } from '../core/input.js';

describe('app key event normalization', () => {
  test('normalizes framework key event fields used by app routing', () => {
    let stopped = false;
    let prevented = false;

    const event = toAppKeyEvent({
      name: 'tab',
      sequence: '\t',
      ctrl: false,
      shift: true,
      stopPropagation: () => {
        stopped = true;
      },
      preventDefault: () => {
        prevented = true;
      },
    });

    expect(event).toEqual({
      name: 'tab',
      sequence: '\t',
      ctrl: false,
      shift: true,
      stopPropagation: event.stopPropagation,
      preventDefault: event.preventDefault,
    });

    event.stopPropagation();
    event.preventDefault();

    expect(stopped).toBe(true);
    expect(prevented).toBe(true);
  });
});
