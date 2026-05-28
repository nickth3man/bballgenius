import { describe, expect, it } from 'bun:test';
import { getSpinnerFrame, SPINNER_FRAMES } from '../utils/spinner.js';

describe('SPINNER_FRAMES', () => {
  it('is a non-empty readonly array of strings', () => {
    expect(Array.isArray(SPINNER_FRAMES)).toBe(true);
    expect(SPINNER_FRAMES.length).toBeGreaterThan(0);
    for (const frame of SPINNER_FRAMES) {
      expect(typeof frame).toBe('string');
    }
  });

  it('contains exactly 10 braille characters', () => {
    expect(SPINNER_FRAMES).toHaveLength(10);
    expect(SPINNER_FRAMES).toEqual(['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']);
  });
});

describe('getSpinnerFrame', () => {
  it('returns first frame for tick 0', () => {
    expect(getSpinnerFrame(0)).toBe('⠋');
  });

  it('returns second frame for tick 1', () => {
    expect(getSpinnerFrame(1)).toBe('⠙');
  });

  it('wraps around at tick 10 to first frame', () => {
    expect(getSpinnerFrame(10)).toBe(getSpinnerFrame(0));
  });

  it('appends text when provided', () => {
    expect(getSpinnerFrame(0, 'thinking...')).toBe('⠋ thinking...');
  });

  it('returns just the frame character without text', () => {
    expect(getSpinnerFrame(5)).toBe('⠴');
  });

  it('wraps large tick values correctly', () => {
    expect(getSpinnerFrame(100)).toBe(getSpinnerFrame(0));
  });

  it('treats empty text as no text', () => {
    expect(getSpinnerFrame(0, '')).toBe('⠋');
  });
});
