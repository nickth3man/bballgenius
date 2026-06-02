import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drawHalfCourt, formatTable, isNoColor, stripAnsi } from '../formatters.js';

describe('Table Formatter (formatTable)', () => {
  test('should format an array of objects into an aligned ASCII grid with headers', () => {
    const headers = ['Player', 'Team', 'PTS'];
    const rows = [
      { Player: 'LeBron James', Team: 'LAL', PTS: 27 },
      { Player: 'Stephen Curry', Team: 'GSW', PTS: 31 },
    ];

    const lines = formatTable(headers, rows);

    // Check that we got top, header, divider, data, bottom borders (total of 6 lines)
    expect(lines.length).toBe(6);
    expect(lines[0]).toContain('┌');
    expect(lines[1]).toContain('Player');
    expect(lines[1]).toContain('Team');
    expect(lines[1]).toContain('PTS');
    expect(lines[2]).toContain('├');
    expect(lines[3]).toContain('LeBron James');
    expect(lines[5]).toContain('└');
  });

  test('should automatically right-align columns with primarily numeric data', () => {
    const headers = ['Player', 'PTS'];
    const rows = [
      { Player: 'LeBron James', PTS: '27' },
      { Player: 'Stephen Curry', PTS: '31' },
    ];

    const lines = formatTable(headers, rows);
    // PTS column should be right-padded/aligned
    expect(lines[3]).toContain(' 27 │');
    expect(lines[4]).toContain(' 31 │');
  });

  test('should map object rows via colKeys when keys differ from headers', () => {
    const lines = formatTable(['Name', 'Pts'], [{ player: 'LeBron', points: 30 }], {
      colKeys: ['player', 'points'],
    });
    const body = lines.join('\n');
    expect(body).toContain('LeBron');
    expect(body).toContain('30');
  });

  test('should respect maxRows and only render the first N data rows', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ Name: `P${i}`, Pts: String(i) }));
    const lines = formatTable(['Name', 'Pts'], rows, { maxRows: 2 });
    const dataLines = lines.filter(
      (l) => l.startsWith('│') && !l.includes('Name') && !l.includes('Pts'),
    );
    expect(dataLines.length).toBe(2);
    expect(lines.join('\n')).toContain('P0');
    expect(lines.join('\n')).toContain('P1');
    expect(lines.join('\n')).not.toContain('P2');
  });

  test('should honor explicit alignments option (right column left-padded)', () => {
    const lines = formatTable(
      ['Label', 'Num'],
      [
        { Label: 'A', Num: '9' },
        { Label: 'B', Num: '100' },
      ],
      { alignments: ['left', 'right'], colKeys: ['Label', 'Num'] },
    );
    // Right-aligned "9" in a width-3 column appears as "  9" before the cell border
    expect(lines[3]).toMatch(/│\s+9\s+│/);
    expect(lines[4]).toMatch(/│\s+100\s+│/);
  });

  test('should accept array-of-arrays rows', () => {
    const lines = formatTable(
      ['Name', 'Pts'],
      [
        ['Alice', '10'],
        ['Bob', '20'],
      ],
    );
    const body = lines.join('\n');
    expect(body).toContain('Alice');
    expect(body).toContain('Bob');
  });

  test('should return at least the header row when rows is empty', () => {
    const lines = formatTable(['Name', 'Pts'], []);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.some((l) => l.includes('Name') && l.includes('Pts'))).toBe(true);
  });
});

describe('Shot Court Plotter (drawHalfCourt)', () => {
  let savedNoColor: string | undefined;

  beforeEach(() => {
    savedNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
  });

  afterEach(() => {
    if (savedNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = savedNoColor;
    }
  });

  test('should draw a grid with baseline and sideline borders', () => {
    const lines = drawHalfCourt([]);
    expect(lines.length).toBe(18); // 18 rows
    expect(lines[0].length).toBe(40); // 40 columns

    // Check baseline is drawn with standard horizontal single-lines
    expect(lines[0]).toContain('──');
    // Check sidelines are vertical lines
    expect(lines[5].startsWith('│')).toBe(true);
    expect(lines[5].endsWith('│')).toBe(true);
  });

  test('should overlay shots correctly as colored symbols', () => {
    const shots = [
      { x: 10, y: 50, shot_result: 'made', player_id: '1' },
      { x: 20, y: 30, shot_result: 'missed', player_id: '1' },
    ];

    const lines = drawHalfCourt(shots);

    // Convert all lines to a single string to search for plotted shots with ANSI colors
    const courtText = lines.join('\n');
    expect(courtText).toContain('\x1b[32mo\x1b[0m'); // Made shot color
    expect(courtText).toContain('\x1b[31mx\x1b[0m'); // Missed shot color
  });

  test('should gracefully handle extreme edge-case and out-of-bounds coordinates (Poka-Yoke)', () => {
    const edgeShots = [
      { x: -5, y: 50, shot_result: 'made', player_id: '1' }, // Negative X
      { x: 105, y: 50, shot_result: 'made', player_id: '1' }, // Exceeds 100 X
      { x: 20, y: -10, shot_result: 'made', player_id: '1' }, // Negative Y
      { x: 20, y: 110, shot_result: 'made', player_id: '1' }, // Exceeds 100 Y
      { x: 0, y: 0, shot_result: 'made', player_id: '1' }, // Exact bottom-left corner
      { x: 100, y: 100, shot_result: 'made', player_id: '1' }, // Exact top-right corner
    ];

    // Assert that calling drawHalfCourt with extreme values does NOT crash the application
    expect(() => drawHalfCourt(edgeShots)).not.toThrow();

    const lines = drawHalfCourt(edgeShots);
    expect(lines.length).toBe(18);
    expect(lines[0].length).toBeGreaterThan(39); // Layout dimensions remain intact
  });

  test('should map coordinates to precise logical court grid locations', () => {
    // A shot at (x=0, y=50) should map exactly to the rim/center region
    // y=50 maps to center column (index 19 or 20)
    // x=0 maps to baseline row (index 0)
    const shots = [{ x: 0, y: 50, shot_result: 'made', player_id: '1' }];

    const lines = drawHalfCourt(shots);

    // Check that our made shot symbol 'o' with ANSI green code is rendered in row 0
    expect(lines[0]).toContain('\x1b[32mo\x1b[0m');
  });

  test('should use bright highlight ANSI for activePlayerId shots', () => {
    const shots = [
      { x: 10, y: 50, shot_result: 'made', player_id: '1' },
      { x: 20, y: 30, shot_result: 'missed', player_id: '1' },
      { x: 15, y: 40, shot_result: 'made', player_id: '2' },
    ];
    const courtText = drawHalfCourt(shots, '1').join('\n');
    expect(courtText).toMatch(/\x1b\[1;32/);
    expect(courtText).toMatch(/\x1b\[1;31/);
  });
});

describe('NO_COLOR / monochrome (drawHalfCourt)', () => {
  let savedNoColor: string | undefined;

  beforeEach(() => {
    savedNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
  });

  afterEach(() => {
    if (savedNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = savedNoColor;
    }
  });

  test('isNoColor reflects NO_COLOR env', () => {
    expect(isNoColor()).toBe(true);
  });

  test('drawHalfCourt emits no ANSI escapes when NO_COLOR is set', () => {
    const shots = [
      { x: 10, y: 50, shot_result: 'made', player_id: '1' },
      { x: 20, y: 30, shot_result: 'missed', player_id: '1' },
      { x: 15, y: 40, shot_result: 'made', player_id: '2' },
    ];
    const courtText = drawHalfCourt(shots, '1').join('\n');
    expect(courtText).not.toMatch(/\x1b\[/);
    expect(courtText).toContain('[o]');
    expect(courtText).toContain('[x]');
    expect(courtText).toContain('o');
  });

  test('stripAnsi removes escape sequences from colored strings', () => {
    const colored = '\x1b[32mo\x1b[0m';
    expect(stripAnsi(colored)).toBe('o');
  });
});
