import { writeFileSync } from 'node:fs';

import { DuckDBInstance } from '@duckdb/node-api';

const CROSSWALK_PATH = 'master-stat-crosswalk.csv';

type Row = Record<string, string>;

type Mapping = {
  canonical_stat: string;
  family: string;
  per_mode: string;
  side: string;
  definition: string;
  confidence: string;
  source_authority: string;
};

const headers = [
  'schema',
  'table',
  'column',
  'type',
  'canonical_stat',
  'family',
  'per_mode',
  'side',
  'definition',
  'confidence',
  'source_authority',
];

const mappings: Record<string, Mapping> = {
  e_off_rating: {
    canonical_stat: 'E_OFF_RATING',
    family: 'advanced',
    per_mode: 'per 100 poss',
    side: '',
    definition: 'Estimated offensive rating: estimated points scored per 100 possessions.',
    confidence: 'nba-bespoke',
    source_authority: 'NBA.com',
  },
  e_def_rating: {
    canonical_stat: 'E_DEF_RATING',
    family: 'advanced',
    per_mode: 'per 100 poss',
    side: '',
    definition: 'Estimated defensive rating: estimated points allowed per 100 possessions.',
    confidence: 'nba-bespoke',
    source_authority: 'NBA.com',
  },
  e_net_rating: {
    canonical_stat: 'E_NET_RATING',
    family: 'advanced',
    per_mode: 'per 100 poss',
    side: '',
    definition: 'Estimated net rating: estimated point differential per 100 possessions.',
    confidence: 'nba-bespoke',
    source_authority: 'NBA.com',
  },
  e_pace: {
    canonical_stat: 'E_PACE',
    family: 'advanced',
    per_mode: 'per 48',
    side: '',
    definition: 'Estimated pace: estimated possessions per 48 minutes.',
    confidence: 'nba-bespoke',
    source_authority: 'NBA.com',
  },
  pct_pts_fb: {
    canonical_stat: '%PTS FBPS',
    family: 'advanced',
    per_mode: '',
    side: '',
    definition:
      'The percentage of points scored by a player or team that are from fast break opportunities.',
    confidence: 'nba-glossary',
    source_authority: 'NBA.com',
  },
  pct_pts_fbps: {
    canonical_stat: '%PTS FBPS',
    family: 'advanced',
    per_mode: '',
    side: '',
    definition:
      'The percentage of points scored by a player or team that are from fast break opportunities.',
    confidence: 'nba-glossary',
    source_authority: 'NBA.com',
  },
  pct_ast: {
    canonical_stat: '%AST',
    family: 'advanced',
    per_mode: '',
    side: '',
    definition: "The percentage of a team's assists that a player has while on the court.",
    confidence: 'nba-glossary',
    source_authority: 'NBA.com',
  },
  pct_ast_2pm: {
    canonical_stat: '2FGM %AST',
    family: 'advanced',
    per_mode: '',
    side: '',
    definition:
      'The percentage of 2 point field goals made by a player or team that are assisted by a teammate.',
    confidence: 'nba-glossary',
    source_authority: 'NBA.com',
  },
  pct_ast_3pm: {
    canonical_stat: '3FGM %AST',
    family: 'advanced',
    per_mode: '',
    side: '',
    definition:
      'The percentage of 3 point field goals made by a player or team that are assisted by a teammate.',
    confidence: 'nba-glossary',
    source_authority: 'NBA.com',
  },
  pct_ast_fgm: {
    canonical_stat: 'FGM %AST',
    family: 'advanced',
    per_mode: '',
    side: '',
    definition:
      'The percentage of total field goals made by a player or team that are assisted by a teammate.',
    confidence: 'nba-glossary',
    source_authority: 'NBA.com',
  },
  pct_uast_2pm: {
    canonical_stat: '2FGM %UAST',
    family: 'advanced',
    per_mode: '',
    side: '',
    definition:
      'The percentage of 2 point field goals made by a player or team that are not assisted by a teammate.',
    confidence: 'nba-glossary',
    source_authority: 'NBA.com',
  },
  pct_uast_3pm: {
    canonical_stat: '3FGM %UAST',
    family: 'advanced',
    per_mode: '',
    side: '',
    definition:
      'The percentage of 3 point field goals made by a player or team that are not assisted by a teammate.',
    confidence: 'nba-glossary',
    source_authority: 'NBA.com',
  },
  pct_uast_fgm: {
    canonical_stat: 'FGM %UAST',
    family: 'advanced',
    per_mode: '',
    side: '',
    definition:
      'The percentage of total field goals made by a player or team that are not assisted by a teammate.',
    confidence: 'nba-glossary',
    source_authority: 'NBA.com',
  },
  nba_fantasy_pts: {
    canonical_stat: 'FP',
    family: 'advanced',
    per_mode: '',
    side: '',
    definition:
      'Fantasy points: points plus weighted rebounds, assists, steals, blocks, and turnovers.',
    confidence: 'nba-glossary',
    source_authority: 'NBA.com',
  },
};

const args = new Set(process.argv.slice(2));

function parseCsv(input: string): Row[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === ',' && !quoted) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(field);
      field = '';
      if (row.some((value) => value !== '')) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += char;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [headerRow, ...dataRows] = rows;
  return dataRows.map((values) =>
    Object.fromEntries(headerRow.map((header, index) => [header, values[index] ?? ''])),
  );
}

function stringifyCsv(rows: Row[]): string {
  const escapeCsvValue = (value: string) => {
    if (/[",\r\n]/.test(value)) {
      return `"${value.replaceAll('"', '""')}"`;
    }
    return value;
  };

  return `${headers.join(',')}\n${rows
    .map((row) => headers.map((header) => escapeCsvValue(row[header] ?? '')).join(','))
    .join('\n')}\n`;
}

function getBaseColumn(column: string) {
  return column.endsWith('_rank') ? column.slice(0, -'_rank'.length) : column;
}

function getSide(column: string) {
  if (column.endsWith('_home')) {
    return 'home';
  }
  if (column.endsWith('_visitor')) {
    return 'away';
  }
  return '';
}

function getMapping(column: string): Mapping | undefined {
  const side = getSide(column);
  const withoutSide = side ? column.replace(/_(home|visitor)$/, '') : column;
  const baseColumn = getBaseColumn(withoutSide);
  const baseMapping = mappings[baseColumn];

  if (!baseMapping) {
    return undefined;
  }

  if (withoutSide.endsWith('_rank')) {
    const rankedDefinition = baseMapping.definition
      .replace(/\.$/, '')
      .replace(/^The /, 'the ')
      .replace(/^Fantasy points:/, 'fantasy points:');

    return {
      ...baseMapping,
      canonical_stat: `Rank: ${baseMapping.canonical_stat}`,
      family: 'rank',
      per_mode: '',
      side,
      definition: `Rank of ${rankedDefinition}.`,
      confidence:
        baseMapping.confidence === 'nba-bespoke' ? 'nba-bespoke-rank' : 'nba-glossary-rank',
    };
  }

  return {
    ...baseMapping,
    side,
  };
}

function buildComment(row: Row) {
  const authority =
    row.source_authority === 'NBA.com' ? 'NBA.com-canonical' : `BBR-canonical/${row.confidence}`;
  return `${row.canonical_stat} \u2014 ${row.definition} [${authority}]`;
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function applyComments(rows: Row[]) {
  const db = await DuckDBInstance.fromCache('./data/nba.duckdb');
  const conn = await db.connect();
  let applied = 0;

  for (const row of rows) {
    const comment = buildComment(row).replaceAll("'", "''");
    const relation = [row.schema, row.table, row.column].map(quoteIdentifier).join('.');
    await conn.run(`COMMENT ON COLUMN ${relation} IS '${comment}'`);
    applied += 1;
  }

  return applied;
}

const text = await Bun.file(CROSSWALK_PATH).text();
const rows = parseCsv(text);
const changedRows: Row[] = [];
const targetRows: Row[] = [];

for (const row of rows) {
  const mapping = getMapping(row.column);
  if (!mapping) {
    continue;
  }

  const differs = Object.entries(mapping).some(([key, value]) => row[key] !== value);

  if (differs) {
    Object.assign(row, mapping);
    changedRows.push(row);
  }

  targetRows.push(row);
}

writeFileSync(CROSSWALK_PATH, stringifyCsv(rows));
console.log(`Updated ${changedRows.length} crosswalk rows in ${CROSSWALK_PATH}.`);

if (args.has('--apply-comments')) {
  const applied = await applyComments(targetRows);
  console.log(`Applied ${applied} DuckDB column comments.`);
}
