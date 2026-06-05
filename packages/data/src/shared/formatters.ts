/**
 * BBallGenius Formatting Utilities (framework-agnostic)
 */
import type { TableDataRow } from '../core/types.js';
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

  const keys = options.colKeys || headers;

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

  const colWidths = headers.map((header, c) => {
    let maxLen = header.length;
    for (let r = 0; r < stringRows.length; r++) {
      if (stringRows[r][c].length > maxLen) {
        maxLen = stringRows[r][c].length;
      }
    }
    return maxLen;
  });

  const alignments = headers.map((_, c) => {
    if (options.alignments?.[c]) {
      return options.alignments[c];
    }
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

  let topBorder = '┌';
  colWidths.forEach((w, idx) => {
    topBorder += '─'.repeat(w + 2);
    if (idx < colWidths.length - 1) topBorder += '┬';
  });
  topBorder += '┐';
  lines.push(topBorder);

  let headerLine = '│';
  headers.forEach((h, c) => {
    const w = colWidths[c];
    const padded = alignments[c] === 'right' ? h.padStart(w) : h.padEnd(w);
    headerLine += ` ${padded} │`;
  });
  lines.push(headerLine);

  let sepBorder = '├';
  colWidths.forEach((w, idx) => {
    sepBorder += '─'.repeat(w + 2);
    if (idx < colWidths.length - 1) sepBorder += '┼';
  });
  sepBorder += '┤';
  lines.push(sepBorder);

  stringRows.forEach((row) => {
    let rowLine = '│';
    row.forEach((val, c) => {
      const w = colWidths[c];
      const padded = alignments[c] === 'right' ? val.padStart(w) : val.padEnd(w);
      rowLine += ` ${padded} │`;
    });
    lines.push(rowLine);
  });

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
 * with ANSI colors for terminal or web display.
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

  shots.forEach((shot) => {
    // Database coordinates: x=0..100 (left baseline to right baseline), y=0..100 (bottom sideline to top sideline)
    // We fold into left half-court where x is distance from nearest baseline (0..50)
    let x_half = shot.x;
    if (x_half > 50) {
      x_half = 100 - x_half;
    }

    const grid_r = Math.floor((x_half / 50) * (rows - 1));
    const grid_c = Math.floor((shot.y / 100) * (cols - 1));

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

  return grid.map((row) => row.join(''));
}
