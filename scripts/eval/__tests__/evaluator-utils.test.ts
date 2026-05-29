import { describe, expect, it } from 'bun:test';
import {
  countOccurrences,
  detectDuplicateFinalAnswer,
  normalizeNumeric,
  normalizeText,
} from '../iterate_loop.js';

describe('normalizeText', () => {
  it('lowercases', () => {
    expect(normalizeText('LeBron James')).toContain('lebron james');
  });

  it('replaces smart quotes with ASCII', () => {
    const result = normalizeText("Joki\u0107's \u201cMVP\u201d \u2018title\u2019");
    expect(result).not.toContain('\u201c');
    expect(result).not.toContain('\u2019');
    expect(result).toContain('mvp');
  });

  it('collapses whitespace', () => {
    expect(normalizeText('  hello    world  ')).toBe('hello world');
  });

  it('strips special characters beyond allowed', () => {
    const result = normalizeText('Score: 101-99! @home #win');
    expect(result).toContain('score');
    expect(result).toContain('101-99');
    expect(result).toContain('home');
    expect(result).toContain('win');
  });

  it('handles empty string', () => {
    expect(normalizeText('')).toBe('');
  });
});

describe('normalizeNumeric', () => {
  it('extracts digits and dots from formatted numbers', () => {
    expect(normalizeNumeric('43,440 points')).toBe('43440');
  });

  it('preserves decimal points', () => {
    expect(normalizeNumeric('29.3 PPG')).toBe('29.3');
  });

  it('preserves negative signs', () => {
    expect(normalizeNumeric('-12.5 differential')).toBe('-12.5');
  });

  it('returns only digits when no other numeric chars', () => {
    expect(normalizeNumeric('LeBron James')).toBe('');
  });

  it('handles empty string', () => {
    expect(normalizeNumeric('')).toBe('');
  });
});

describe('countOccurrences', () => {
  it('counts non-overlapping occurrences', () => {
    expect(countOccurrences('banana', 'ana')).toBe(1);
  });

  it('returns 0 for empty needle', () => {
    expect(countOccurrences('hello', '')).toBe(0);
  });

  it('returns 0 when needle not found', () => {
    expect(countOccurrences('hello', 'xyz')).toBe(0);
  });

  it('counts single char occurrences', () => {
    expect(countOccurrences('mississippi', 's')).toBe(4);
  });

  it('is case sensitive', () => {
    expect(countOccurrences('Hello hello HELLO', 'hello')).toBe(1);
  });
});

describe('detectDuplicateFinalAnswer', () => {
  it('returns no duplicate for normal answer', () => {
    const result = detectDuplicateFinalAnswer(
      'LeBron James is the all-time scoring leader with 43,440 career points.',
      'LeBron James',
    );
    expect(result.duplicate).toBe(false);
  });

  it('detects repeated expected token 4+ times', () => {
    const result = detectDuplicateFinalAnswer(
      'LeBron James LeBron James LeBron James LeBron James is the leader.',
      'LeBron James',
    );
    expect(result.duplicate).toBe(true);
    // Evidence message uses original (non-normalized) string
    expect(result.evidence).toContain('LeBron James');
  });

  it('detects sentence repeated 3+ times', () => {
    const repeated =
      'He is the best player in the league. He is the best player in the league. He is the best player in the league.';
    const result = detectDuplicateFinalAnswer(repeated, 'Jordan');
    expect(result.duplicate).toBe(true);
  });

  it('detects repeated paragraphs', () => {
    const repeated =
      'LeBron James scored 43,440 points in his career. He is the NBA all-time scoring leader.\n\nLeBron James scored 43,440 points in his career. He is the NBA all-time scoring leader.';
    const result = detectDuplicateFinalAnswer(repeated, 'LeBron');
    expect(result.duplicate).toBe(true);
  });

  it('handles empty answer', () => {
    const result = detectDuplicateFinalAnswer('', 'LeBron');
    expect(result.duplicate).toBe(false);
  });

  it('skips expected-token check for clarification/not-available expected', () => {
    // When expectedKind is 'clarification', the normalized expected is 'clarification',
    // which triggers the skip in detectDuplicateFinalAnswer (line 511 in iterate_loop.ts)
    const result = detectDuplicateFinalAnswer(
      'clarification clarification clarification clarification',
      'clarification',
    );
    expect(result.duplicate).toBe(false);
  });

  it('does not flag short sentences for repetition', () => {
    const result = detectDuplicateFinalAnswer('Yes. No. Yes. No.', 'anything');
    expect(result.duplicate).toBe(false);
  });
});
