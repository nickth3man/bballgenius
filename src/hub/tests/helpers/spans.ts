import { expect } from 'bun:test';
import type { CapturedFrame, CapturedSpan, RGBA } from '@opentui/core';

export function framePlainText(frame: CapturedFrame): string {
  return frame.lines.map((line) => line.spans.map((s) => s.text).join('')).join('\n');
}

export function findSpansContaining(frame: CapturedFrame, substring: string): CapturedSpan[] {
  const matches: CapturedSpan[] = [];
  for (const line of frame.lines) {
    for (const span of line.spans) {
      if (span.text.includes(substring)) {
        matches.push(span);
      }
    }
  }
  return matches;
}

export function rgbaMatches(a: RGBA, b: RGBA, epsilon = 1): boolean {
  return (
    Math.abs(a.r - b.r) <= epsilon &&
    Math.abs(a.g - b.g) <= epsilon &&
    Math.abs(a.b - b.b) <= epsilon
  );
}

export function getSpanAt(
  frame: CapturedFrame,
  row: number,
  col: number,
): CapturedSpan | undefined {
  const line = frame.lines[row];
  if (!line) return undefined;

  let colIdx = 0;
  for (const span of line.spans) {
    const spanEnd = colIdx + span.width;
    if (col >= colIdx && col < spanEnd) {
      return span;
    }
    colIdx = spanEnd;
  }
  return undefined;
}

export function assertSpanFgNear(
  frame: CapturedFrame,
  row: number,
  col: number,
  expected: RGBA,
  epsilon = 1,
): void {
  const span = getSpanAt(frame, row, col);
  expect(span).toBeDefined();
  expect(rgbaMatches(span!.fg, expected, epsilon)).toBe(true);
}
