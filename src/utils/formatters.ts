/**
 * BBallGenius Terminal Hub Formatting Utilities
 */
import { createTextAttributes, parseColor, StyledText, type TextChunk } from '@opentui/core';
import type { TableDataRow } from '../types.js';
import { ansiBrightGreen, ansiBrightRed, ansiGreen, ansiRed, isNoColor } from './theme.js';

export { isNoColor } from './theme.js';

const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;]*m/g;

/** Removes ANSI SGR escape sequences from a string. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, '');
}

/**
 * Formats a grid/table of data with clean Unicode borders and column alignments.
 * Supports both arrays of objects and arrays of arrays, with smart numeric right-alignment.
 */
export function formatTable(
  headers: string[],
  rows: TableDataRow[],
  options: {
    alignments?: ('left' | 'right')[];
    maxRows?: number;
    colKeys?: string[];
  } = {},
): string[] {
  if (!headers || headers.length === 0) return [];

  // Identify column keys to map objects to columns
  const keys = options.colKeys || headers;

  // Standardize rows to string arrays
  const stringRows: string[][] = [];
  const limit = options.maxRows ? Math.min(rows.length, options.maxRows) : rows.length;

  for (let r = 0; r < limit; r++) {
    const row = rows[r];
    const stringRow: string[] = [];
    for (let c = 0; c < headers.length; c++) {
      let val = '';
      if (Array.isArray(row)) {
        val = row[c] !== undefined && row[c] !== null ? String(row[c]) : '';
      } else if (row && typeof row === 'object') {
        const key = keys[c];
        const rawVal = row[key] !== undefined && row[key] !== null ? row[key] : '';
        val = typeof rawVal === 'object' ? JSON.stringify(rawVal) : String(rawVal);
      }
      stringRow.push(val);
    }
    stringRows.push(stringRow);
  }

  // Calculate column widths based on headers and data
  const colWidths = headers.map((header, c) => {
    let maxLen = header.length;
    for (let r = 0; r < stringRows.length; r++) {
      if (stringRows[r][c].length > maxLen) {
        maxLen = stringRows[r][c].length;
      }
    }
    return maxLen;
  });

  // Determine alignments (right-align numbers automatically if not specified)
  const alignments = headers.map((_, c) => {
    if (options.alignments?.[c]) {
      return options.alignments[c];
    }
    // Check if column values are mostly numeric
    let numericCount = 0;
    for (let r = 0; r < stringRows.length; r++) {
      const val = stringRows[r][c].trim();
      if (val !== '' && !Number.isNaN(Number(val))) {
        numericCount++;
      }
    }
    return numericCount > stringRows.length / 2 ? 'right' : 'left';
  });

  const lines: string[] = [];

  // Top border
  let topBorder = '┌';
  colWidths.forEach((w, idx) => {
    topBorder += '─'.repeat(w + 2);
    if (idx < colWidths.length - 1) topBorder += '┬';
  });
  topBorder += '┐';
  lines.push(topBorder);

  // Header row
  let headerLine = '│';
  headers.forEach((h, c) => {
    const w = colWidths[c];
    const padded = alignments[c] === 'right' ? h.padStart(w) : h.padEnd(w);
    headerLine += ` ${padded} │`;
  });
  lines.push(headerLine);

  // Separator border
  let sepBorder = '├';
  colWidths.forEach((w, idx) => {
    sepBorder += '─'.repeat(w + 2);
    if (idx < colWidths.length - 1) sepBorder += '┼';
  });
  sepBorder += '┤';
  lines.push(sepBorder);

  // Data rows
  stringRows.forEach((row) => {
    let rowLine = '│';
    row.forEach((val, c) => {
      const w = colWidths[c];
      const padded = alignments[c] === 'right' ? val.padStart(w) : val.padEnd(w);
      rowLine += ` ${padded} │`;
    });
    lines.push(rowLine);
  });

  // Bottom border
  let botBorder = '└';
  colWidths.forEach((w, idx) => {
    botBorder += '─'.repeat(w + 2);
    if (idx < colWidths.length - 1) botBorder += '┴';
  });
  botBorder += '┘';
  lines.push(botBorder);

  return lines;
}

/**
 * Draws a regulation half-court grid and overlays shot locations (makes/misses)
 * with ANSI colors using the @opentui styles or raw ANSI escapes.
 *
 * @param shots Array of shots with normalized x,y coordinates (0-100)
 * @param activePlayerId Optional ID of player to highlight their shots specially
 */
export function drawHalfCourt(
  shots: { x: number; y: number; shot_result: string; player_id?: string | number | null }[],
  activePlayerId?: string | number | null,
): string[] {
  const rows = 18;
  const cols = 40;
  const grid: string[][] = Array.from({ length: rows }, () => Array(cols).fill(' '));

  // 1. Draw static court lines into grid
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Baseline
      if (r === 0) {
        grid[r][c] = '─';
        continue;
      }
      // Sidelines
      if (c === 0 || c === cols - 1) {
        grid[r][c] = '│';
        continue;
      }
      // Half court line (midcourt is bottom line)
      if (r === rows - 1) {
        grid[r][c] = '╌';
        continue;
      }

      // Paint lines (key)
      // NBA key is 16 feet wide. Width is 50. Center is 20.
      // Left paint = 20 - 6 = 14 (idx 13)
      // Right paint = 20 + 6 = 26 (idx 26)
      // Length is 19 feet from baseline. 19/47 * 17 = 6.8 rows (idx 7)
      if (r >= 1 && r <= 7) {
        if (c === 13) {
          grid[r][c] = '│';
          continue;
        }
        if (c === 26) {
          grid[r][c] = '│';
          continue;
        }
      }
      if (r === 7 && c > 13 && c < 26) {
        grid[r][c] = '─';
        continue;
      }

      // Hoop and backboard
      // Hoop is 4.75 ft from baseline (r = 2). Backboard is 4 ft (r = 1).
      // Backboard is 6 ft wide (col 18 to 22)
      if (r === 1 && c >= 18 && c <= 22) {
        grid[r][c] = '═';
        continue;
      }
      if (r === 2 && c === 20) {
        grid[r][c] = '○'; // Hoop rim
        continue;
      }
      if (r === 2 && (c === 19 || c === 21)) {
        grid[r][c] = '─'; // Net attachment
        continue;
      }

      // Three-point line
      // Corner three parallel to sidelines up to 14 ft out.
      // 3 ft from sidelines (c = 2, c = 37). r = 1..5
      if (r >= 1 && r <= 5) {
        if (c === 2 || c === 37) {
          grid[r][c] = '│';
          continue;
        }
      }

      // Three-point arc mathematical drawing
      // Distance from hoop (row 2, col 20) in feet:
      const dy = (r - 2) * (47 / (rows - 1)); // Feet along length
      const dx = (c - 20) * (50 / (cols - 1)); // Feet along width
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Arc radius is 23.75 feet
      if (r >= 5 && Math.abs(dist - 23.75) < 0.95) {
        grid[r][c] = '·';
      }
    }
  }

  // Corner paint corners
  if (grid[7][13] === '│') grid[7][13] = '└';
  if (grid[7][26] === '│') grid[7][26] = '┘';

  // 2. Plot shots — green 'o' (made), red 'x' (missed); monochrome uses plain symbols
  shots.forEach((shot) => {
    // Normalise coordinates
    // Database coordinates: x=0..100 (left baseline to right baseline), y=0..100 (bottom sideline to top sideline)
    // We fold into left half-court where x is distance from nearest baseline (0..50)
    let x_half = shot.x;
    if (x_half > 50) {
      x_half = 100 - x_half;
    }

    const grid_r = Math.floor((x_half / 50) * (rows - 1));
    const grid_c = Math.floor((shot.y / 100) * (cols - 1));

    // Ensure within bounds
    if (grid_r >= 0 && grid_r < rows && grid_c >= 0 && grid_c < cols) {
      const isMade = shot.shot_result.toLowerCase().includes('made') || shot.shot_result === '1';
      const symbol = isMade ? 'o' : 'x';
      const isHighlighted = activePlayerId && String(shot.player_id) === String(activePlayerId);

      let displaySymbol: string;
      if (isNoColor()) {
        displaySymbol = isHighlighted ? `[${symbol}]` : symbol;
      } else if (isHighlighted) {
        displaySymbol = isMade ? ansiBrightGreen(symbol) : ansiBrightRed(symbol);
      } else {
        displaySymbol = isMade ? ansiGreen(symbol) : ansiRed(symbol);
      }

      grid[grid_r][grid_c] = displaySymbol;
    }
  });

  // Convert grid to lines
  return grid.map((row) => row.join(''));
}

/**
 * Converts a string with standard ANSI escape sequences into an OpenTUI StyledText object.
 * This prevents layout calculations from including zero-width formatting codes, and
 * avoids escape sequences leaking/breaking in rendering.
 */
export function ansiToStyledText(text: string): StyledText {
  const chunks: TextChunk[] = [];
  const regex = /\x1b\[([0-9;]*)m/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  let currentFg: string | undefined;
  let currentBg: string | undefined;
  let isBold = false;
  let isDim = false;
  let isItalic = false;
  let isUnderline = false;

  const colorMap: Record<string, string> = {
    '30': 'black',
    '31': 'red',
    '32': 'green',
    '33': 'yellow',
    '34': 'blue',
    '35': 'magenta',
    '36': 'cyan',
    '37': 'white',
    '90': 'brightBlack',
    '91': 'brightRed',
    '92': 'brightGreen',
    '93': 'brightYellow',
    '94': 'brightBlue',
    '95': 'brightMagenta',
    '96': 'brightCyan',
    '97': 'brightWhite',
    '40': 'black',
    '41': 'red',
    '42': 'green',
    '43': 'yellow',
    '44': 'blue',
    '45': 'magenta',
    '46': 'cyan',
    '47': 'white',
    '100': 'brightBlack',
    '101': 'brightRed',
    '102': 'brightGreen',
    '103': 'brightYellow',
    '104': 'brightBlue',
    '105': 'brightMagenta',
    '106': 'brightCyan',
    '107': 'brightWhite',
  };

  while ((match = regex.exec(text)) !== null) {
    const textPart = text.slice(lastIndex, match.index);
    if (textPart) {
      chunks.push(
        createChunk(textPart, {
          fg: currentFg,
          bg: currentBg,
          bold: isBold,
          dim: isDim,
          italic: isItalic,
          underline: isUnderline,
        }),
      );
    }

    const code = match[1];
    const params = code.split(';');

    for (let i = 0; i < params.length; i++) {
      const p = params[i] || '0';
      if (p === '0') {
        currentFg = undefined;
        currentBg = undefined;
        isBold = false;
        isDim = false;
        isItalic = false;
        isUnderline = false;
      } else if (p === '1') {
        isBold = true;
      } else if (p === '2') {
        isDim = true;
      } else if (p === '3') {
        isItalic = true;
      } else if (p === '4') {
        isUnderline = true;
      } else if (p === '22') {
        isBold = false;
        isDim = false;
      } else if (p === '23') {
        isItalic = false;
      } else if (p === '24') {
        isUnderline = false;
      } else if (p === '39') {
        currentFg = undefined;
      } else if (p === '49') {
        currentBg = undefined;
      } else if (p === '38' && params[i + 1] === '2') {
        const r = params[i + 2] || '0';
        const g = params[i + 3] || '0';
        const b = params[i + 4] || '0';
        currentFg = `rgb(${r},${g},${b})`;
        i += 4;
      } else if (p === '48' && params[i + 1] === '2') {
        const r = params[i + 2] || '0';
        const g = params[i + 3] || '0';
        const b = params[i + 4] || '0';
        currentBg = `rgb(${r},${g},${b})`;
        i += 4;
      } else if (p === '38' && params[i + 1] === '5') {
        const index = params[i + 2] || '0';
        currentFg = `ansi256:${index}`;
        i += 2;
      } else if (p === '48' && params[i + 1] === '5') {
        const index = params[i + 2] || '0';
        currentBg = `ansi256:${index}`;
        i += 2;
      } else {
        const pNum = parseInt(p, 10);
        if (pNum >= 30 && pNum <= 37) {
          currentFg = colorMap[p];
        } else if (pNum >= 90 && pNum <= 97) {
          currentFg = colorMap[p];
        } else if (pNum >= 40 && pNum <= 47) {
          currentBg = colorMap[p];
        } else if (pNum >= 100 && pNum <= 107) {
          currentBg = colorMap[p];
        }
      }
    }

    lastIndex = regex.lastIndex;
  }

  const trailing = text.slice(lastIndex);
  if (trailing) {
    chunks.push(
      createChunk(trailing, {
        fg: currentFg,
        bg: currentBg,
        bold: isBold,
        dim: isDim,
        italic: isItalic,
        underline: isUnderline,
      }),
    );
  }

  return new StyledText(chunks);
}

function createChunk(
  text: string,
  style: {
    fg?: string;
    bg?: string;
    bold?: boolean;
    dim?: boolean;
    italic?: boolean;
    underline?: boolean;
  },
) {
  const chunk: TextChunk = {
    __isChunk: true as const,
    text,
  };

  if (style.fg) {
    if (style.fg.startsWith('rgb(') || style.fg.startsWith('ansi256:')) {
      // rgb(R,G,B) parsed natively
      // ansi256:I parsed natively by converting to hex or mapping
      chunk.fg = parseColor(style.fg.startsWith('ansi256:') ? '#888888' : style.fg);
    } else {
      chunk.fg = parseColor(style.fg);
    }
  }

  if (style.bg) {
    if (style.bg.startsWith('rgb(')) {
      chunk.bg = parseColor(style.bg);
    } else {
      chunk.bg = parseColor(style.bg);
    }
  }

  const attributes = createTextAttributes(style);
  if (attributes) {
    chunk.attributes = attributes;
  }

  return chunk;
}
