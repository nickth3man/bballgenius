/**
 * Builds a compact catalog of EVERY schema and table in the database.
 *
 * Unlike systemPrompt.ts (which details only a curated set of "core" tables),
 * this lists every non-system schema and all of its tables/views so the
 * orchestrator's planner knows the full breadth of data it can dispatch
 * workers against. Column details are intentionally omitted to keep the
 * planner prompt small — workers discover columns on demand via tools.
 */

import { getTableRefs } from '../db.js';

let _catalogCache: string | null = null;

export function invalidateSchemaCatalogCache(): void {
  _catalogCache = null;
}

export async function buildSchemaCatalog(): Promise<string> {
  if (_catalogCache) return _catalogCache;

  const tables = await getTableRefs();
  const bySchema = tables.reduce<Record<string, string[]>>((acc, table) => {
    acc[table.schema] ??= [];
    acc[table.schema]!.push(`${table.name}${table.type === 'VIEW' ? ' (view)' : ''}`);
    return acc;
  }, {});

  const lines = Object.entries(bySchema)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([schema, names]) => `- ${schema}: ${names.join(', ')}`);

  _catalogCache = lines.join('\n');
  return _catalogCache;
}
