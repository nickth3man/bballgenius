export function formatResultsTable(results: Record<string, unknown>[]): string {
  if (results.length === 0) {
    return 'Query returned no results.';
  }

  const headers = Object.keys(results[0]!);
  const displayResults = results.slice(0, 20);
  const rows = displayResults.map((row) =>
    headers.map((h) => {
      const val = row[h];
      return val === null || val === undefined ? '' : String(val);
    }),
  );

  const colWidths = headers.map((h, i) => {
    const maxVal = Math.max(...rows.map((r) => r[i]!.length));
    return Math.max(h.length, maxVal);
  });

  const isNumeric = headers.map((_, i) =>
    rows.every((r) => {
      const v = r[i]!;
      return v !== '' && !Number.isNaN(Number(v));
    }),
  );

  const topLine = `┌${colWidths.map((w) => '─'.repeat(w + 2)).join('┬')}┐`;
  const headerLine = `│ ${headers.map((h, i) => h.padEnd(colWidths[i]!)).join(' │ ')} │`;
  const sepLine = `├${colWidths.map((w) => '─'.repeat(w + 2)).join('┼')}┤`;
  const dataLines = rows.map(
    (r) =>
      `│ ${r
        .map((v, i) => (isNumeric[i] ? v.padStart(colWidths[i]!) : v.padEnd(colWidths[i]!)))
        .join(' │ ')} │`,
  );
  const botLine = `└${colWidths.map((w) => '─'.repeat(w + 2)).join('┴')}┘`;

  const lines = [topLine, headerLine, sepLine, ...dataLines, botLine];

  if (results.length > 20) {
    lines.unshift(`Rows: ${results.length} (showing first 20)`);
  }

  return lines.join('\n');
}
