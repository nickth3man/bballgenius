import { createTextAttributes, parseColor, StyledText, type TextChunk } from '@opentui/core';

const ANSI_PATTERN = /\x1b\[([0-9;]*)m/g;

export function ansiToStyledText(text: string): StyledText {
  const chunks: TextChunk[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  let currentFg: string | undefined;
  let isBold = false;
  let isDim = false;

  while ((match = ANSI_PATTERN.exec(text)) !== null) {
    const textPart = text.slice(lastIndex, match.index);
    if (textPart) {
      chunks.push(createChunk(textPart, getStyle(currentFg, isBold, isDim)));
    }

    const params = (match[1] ?? '').split(';');
    for (const p of params) {
      if (p === '0') {
        currentFg = undefined;
        isBold = false;
        isDim = false;
      } else if (p === '1') {
        isBold = true;
      } else if (p === '2') {
        isDim = true;
      } else if (p === '22') {
        isBold = false;
        isDim = false;
      } else if (p === '34') {
        currentFg = 'blue';
      } else if (p === '32') {
        currentFg = 'green';
      } else if (p === '31') {
        currentFg = 'red';
      } else if (p === '36') {
        currentFg = 'cyan';
      } else if (p === '37') {
        currentFg = 'white';
      } else if (p === '90') {
        currentFg = 'brightBlack';
      }
    }

    lastIndex = ANSI_PATTERN.lastIndex;
  }

  const trailing = text.slice(lastIndex);
  if (trailing) {
    chunks.push(createChunk(trailing, getStyle(currentFg, isBold, isDim)));
  }

  return new StyledText(chunks);
}

function createChunk(
  text: string,
  style: { fg?: string; bold?: boolean; dim?: boolean },
): TextChunk {
  const chunk: TextChunk = {
    __isChunk: true as const,
    text,
  };
  if (style.fg) {
    chunk.fg = parseColor(style.fg);
  }
  const attributes = createTextAttributes(style);
  if (attributes) {
    chunk.attributes = attributes;
  }
  return chunk;
}

function getStyle(
  fg: string | undefined,
  bold: boolean,
  dim: boolean,
): {
  fg?: string;
  bold: boolean;
  dim: boolean;
} {
  return fg ? { fg, bold, dim } : { bold, dim };
}
