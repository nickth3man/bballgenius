import { expect } from 'bun:test';
import type { StyledText } from '@opentui/core';

// Matches a full escape sequence: ESC + [
const RAW_ESCAPE = /\x1b\[/;

// Matches a surviving SGR bracket fragment when the ESC byte was stripped but
// the `[<code>m` tail leaked through (e.g. "[32m", "[1;35m", "[0m").
// Covers all numeric SGR codes regardless of which color/attribute is used.
const LEAKED_SGR_FRAGMENT = /\[\d+(;\d+)*m/;

export function styledPlainText(styled: StyledText): string {
  return styled.chunks.map((c) => c.text).join('');
}

export function assertNoAnsiLeaks(text: string) {
  expect(text).not.toMatch(RAW_ESCAPE);         // full \x1b[ sequence
  expect(text).not.toMatch(LEAKED_SGR_FRAGMENT); // partial leak (ESC byte stripped, bracket remained)
}

export function normalizeFrameForSnapshot(frame: string): string {
  return frame
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}
