/**
 * Clean up markdown text for beautiful terminal display.
 * Removes links, bolding, italics, and resolves special characters.
 */
export function cleanMarkdownText(text: string): string {
  let cleaned = text.trim();
  // Remove markdown links: [Label](url) -> Label
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // Remove bold/italics: **text** or *text* -> text
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
  cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
  cleaned = cleaned.replace(/_([^_]+)_/g, '$1');
  // Remove non-breaking spaces and clean whitespace
  cleaned = cleaned.replace(/\u00a0/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ');
  return cleaned.trim();
}

export interface BbrTable {
  title: string;
  headers: string[];
  rows: Record<string, string>[];
}

export interface BbrPageData {
  title: string;
  subtitle?: string;
  tables: BbrTable[];
}

/**
 * Parses a Basketball-Reference markdown file dynamically.
 * Extracts the page title, subheadings, and parses all markdown tables.
 */
export function parseBbrMarkdown(content: string): BbrPageData {
  const lines = content.split(/\r?\n/);

  let title = 'Basketball-Reference Data';
  let subtitle = '';
  const tables: BbrTable[] = [];

  let currentSection = '';
  let inTable = false;
  let tableHeaders: string[] = [];
  let tableRows: string[][] = [];

  // Helper to push parsed table
  const commitTable = () => {
    if (tableHeaders.length > 0 && tableRows.length > 0) {
      const rows = tableRows.map((row) => {
        const rowObj: Record<string, string> = {};
        tableHeaders.forEach((header, idx) => {
          rowObj[header] = row[idx] !== undefined ? row[idx] : '';
        });
        return rowObj;
      });

      tables.push({
        title: currentSection || 'Data Table',
        headers: tableHeaders,
        rows,
      });
    }
    tableHeaders = [];
    tableRows = [];
    inTable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 1. Parse main page Title
    if (line.startsWith('# ')) {
      title = cleanMarkdownText(line.substring(2));
      continue;
    }

    // 2. Parse Subheadings
    if (line.startsWith('## ') || line.startsWith('### ') || line.startsWith('#### ')) {
      commitTable();
      const level = line.indexOf(' ');
      currentSection = cleanMarkdownText(line.substring(level + 1));
      continue;
    }

    // 3. Identify and Parse Tables
    if (line.startsWith('|')) {
      const isSeparator = /^\|[\s\-:|]+$/.test(line);

      if (isSeparator) {
        if (inTable && tableRows.length === 1) {
          // Multi-tier header support: if we see another separator row immediately after 1 row of data,
          // that row was actually the real column headers.
          tableHeaders = tableRows[0];
          tableRows = [];
        } else if (!inTable && tableHeaders.length > 0) {
          inTable = true;
        }
        continue;
      }

      // Split the row by '|', filter out the outer empty elements
      const parts = line.split('|').map((p) => cleanMarkdownText(p));
      if (parts.length >= 2) {
        const rowCells = parts.slice(1, parts.length - 1);

        if (!inTable) {
          // If we haven't seen a separator yet, this might be the header row
          // If we already had headers, we commit them (e.g. nested headers or multiple tables)
          if (tableHeaders.length > 0) {
            commitTable();
          }
          tableHeaders = rowCells;
        } else {
          // Check if this is a repeat header row (often happens in long BBR tables)
          const isRepeatHeader = rowCells.every((cell, idx) => cell === tableHeaders[idx]);
          if (!isRepeatHeader && rowCells.some((cell) => cell !== '')) {
            tableRows.push(rowCells);
          }
        }
      }
    } else {
      // Non-table line ends the table
      if (inTable) {
        commitTable();
      }

      // Parse subtitles or descriptions if they're near the top
      if (line !== '' && !subtitle && tables.length === 0 && !line.startsWith('[')) {
        subtitle = cleanMarkdownText(line);
      }
    }
  }

  // Commit any final remaining table at end of file
  commitTable();

  return {
    title,
    subtitle: subtitle || undefined,
    tables,
  };
}

export interface BbrSubpageLink {
  label: string;
  year: string;
}

export interface BbrPlayerLinks {
  gamelog: BbrSubpageLink[];
  'gamelog-advanced': BbrSubpageLink[];
  'gamelog-playoffs': BbrSubpageLink[];
  'gamelog-playoffs-advanced': BbrSubpageLink[];
  splits: BbrSubpageLink[];
  shooting: BbrSubpageLink[];
  lineups: BbrSubpageLink[];
  'on-off': BbrSubpageLink[];
}

type BbrLinkCategory = keyof BbrPlayerLinks;

const LINK_CATEGORY_PATTERNS: { category: BbrLinkCategory; patterns: RegExp[] }[] = [
  { category: 'gamelog', patterns: [/game\s*log/i] },
  { category: 'gamelog-advanced', patterns: [/advanced\s*game\s*log/i, /gamelog-advanced/i] },
  {
    category: 'gamelog-playoffs-advanced',
    patterns: [/playoff.*advanced/i, /gamelog-playoffs-advanced/i],
  },
  { category: 'gamelog-playoffs', patterns: [/playoff\s*log/i, /gamelog-playoffs/i] },
  { category: 'splits', patterns: [/split/i] },
  { category: 'shooting', patterns: [/shooting/i] },
  { category: 'lineups', patterns: [/lineup/i] },
  { category: 'on-off', patterns: [/on\/off/i, /on-off/i] },
];

function emptyPlayerLinks(): BbrPlayerLinks {
  return {
    gamelog: [],
    'gamelog-advanced': [],
    'gamelog-playoffs': [],
    'gamelog-playoffs-advanced': [],
    splits: [],
    shooting: [],
    lineups: [],
    'on-off': [],
  };
}

function detectLinkCategory(text: string, url: string): BbrLinkCategory | null {
  const haystack = `${text} ${url}`.toLowerCase();
  for (const entry of LINK_CATEGORY_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(haystack))) {
      return entry.category;
    }
  }
  return null;
}

function extractYearFromUrl(url: string, category: BbrLinkCategory): string {
  const cleanUrl = url.replace(/\/$/, '');
  const parts = cleanUrl.split('/');

  if (category === 'gamelog-playoffs' || category === 'gamelog-playoffs-advanced') {
    return category === 'gamelog-playoffs' ? 'playoffs' : 'playoffs-advanced';
  }

  let year = parts[parts.length - 1];
  const bareTypes = ['splits', 'gamelog', 'lineups', 'shooting', 'on-off', 'gamelog-advanced'];
  if (bareTypes.includes(year)) {
    year = '';
  } else if (cleanUrl.includes('gamelog-playoffs')) {
    year = 'playoffs';
  }
  return year;
}

/**
 * Parses player sub-navigation links dynamically from a profile page content.
 */
export function parseBbrPlayerSublinks(content: string): BbrPlayerLinks {
  const lines = content.split(/\r?\n/);
  const links = emptyPlayerLinks();

  let currentCategory: BbrLinkCategory | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith('**') && line.endsWith('**')) {
      const catText = line.slice(2, -2);
      currentCategory = detectLinkCategory(catText, '');
      continue;
    }

    if (line.startsWith('#') || line.startsWith('##')) {
      currentCategory = null;
      continue;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      const linkMatch = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (!linkMatch) {
        continue;
      }

      const label = cleanMarkdownText(linkMatch[1]);
      const url = linkMatch[2].trim();
      const category = currentCategory ?? detectLinkCategory(label, url);
      if (!category) {
        continue;
      }

      const year = extractYearFromUrl(url, category);
      links[category].push({ label, year });
    }
  }

  return links;
}
