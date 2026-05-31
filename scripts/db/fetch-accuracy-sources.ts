/**
 * Firecrawl CLI-backed BBR source fetcher for accuracy checks.
 *
 * Default behavior is safe: fetch/cache sources, generate + validate candidates,
 * and write `accuracy-candidates.generated.json`. Use `--append` to merge passing
 * candidates into `accuracy-checks.json`.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';

import {
  type AccuracyCheck,
  type BbrPlayerSeed,
  bbrPlayerUrl,
  buildCareerChecks,
  compareActual,
  loadAccuracyChecks,
  parseBbrCareerTotals,
} from './accuracy.js';

type Options = {
  playersPath: string;
  outPath: string;
  checksPath: string;
  cacheDir: string;
  limit: number;
  concurrency: number;
  delayMs: number;
  maxAgeMs: number;
  refresh: boolean;
  validate: boolean;
  append: boolean;
};

type ValidationResult = {
  check: AccuracyCheck;
  actual: number | null;
  passed: boolean;
  error: string | null;
};

const DB_PATH = process.env['NBA_DUCKDB_PATH'] ?? './data/nba.duckdb';
const options = parseOptions(process.argv.slice(2));
const players = (JSON.parse(await readFile(options.playersPath, 'utf8')) as BbrPlayerSeed[]).slice(
  0,
  options.limit,
);

await ensureParent(options.outPath);
await mkdir(options.cacheDir, { recursive: true });

const candidates: AccuracyCheck[] = [];
const rejected: ValidationResult[] = [];

for (let index = 0; index < players.length; index += options.concurrency) {
  const batch = players.slice(index, index + options.concurrency);
  const batchResults = await Promise.all(
    batch.map((player) => fetchAndBuildChecks(player, options)),
  );
  candidates.push(...batchResults.flat());

  if (index + options.concurrency < players.length && options.delayMs > 0) {
    await Bun.sleep(options.delayMs);
  }
}

const existing = await loadAccuracyChecks(options.checksPath);
const existingNames = new Set(existing.map((check) => check.name));
const uniqueCandidates = candidates
  .filter((check) => !existingNames.has(check.name))
  .slice(0, options.limit);
const validated = options.validate ? await validateChecks(uniqueCandidates) : [];
const passing = options.validate
  ? validated.filter((result) => result.passed).map((result) => result.check)
  : uniqueCandidates;

if (options.validate) {
  rejected.push(...validated.filter((result) => !result.passed));
}

await writeFile(options.outPath, `${JSON.stringify(passing, null, 2)}\n`);

if (options.append) {
  await writeFile(options.checksPath, `${JSON.stringify([...existing, ...passing], null, 2)}\n`);
}

console.log(
  `Generated ${candidates.length} candidates, ${passing.length} passing, ${rejected.length} rejected.`,
);
console.log(`Candidates: ${options.outPath}`);
if (options.append) {
  console.log(`Appended to: ${options.checksPath}`);
}

if (rejected.length > 0) {
  console.log('\nRejected candidates:');
  for (const result of rejected.slice(0, 20)) {
    const reason = result.error ?? `expected ${result.check.expected}, got ${result.actual}`;
    console.log(`  ${result.check.name}: ${reason}`);
  }
}

async function fetchAndBuildChecks(
  player: BbrPlayerSeed,
  options: Options,
): Promise<AccuracyCheck[]> {
  const url = player.url ?? bbrPlayerUrl(player.bbrId);
  const cachePath = cachePathFor(options.cacheDir, player.bbrId);

  await ensureParent(cachePath);

  if (options.refresh || !(await exists(cachePath))) {
    await scrapeWithFirecrawl(url, cachePath, options.maxAgeMs);
  }

  const payload = JSON.parse(await readFile(cachePath, 'utf8')) as Record<string, unknown>;
  const rawHtml = extractContent(payload, 'rawHtml');
  if (!rawHtml) {
    throw new Error(`No rawHtml found in ${cachePath}`);
  }

  return buildCareerChecks(player, parseBbrCareerTotals(rawHtml), cachePath);
}

async function scrapeWithFirecrawl(url: string, outputPath: string, maxAgeMs: number) {
  const proc = Bun.spawn([
    'firecrawl',
    'scrape',
    url,
    '--format',
    'rawHtml,markdown,links',
    '--json',
    '--pretty',
    '--max-age',
    String(maxAgeMs),
    '-o',
    outputPath,
  ]);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`firecrawl scrape failed for ${url}: ${stderr || stdout}`);
  }
}

async function validateChecks(checks: AccuracyCheck[]): Promise<ValidationResult[]> {
  const db = await DuckDBInstance.fromCache(DB_PATH);
  const conn = await db.connect();
  const results: ValidationResult[] = [];

  for (const check of checks) {
    try {
      const res = await conn.runAndReadAll(check.sql);
      const row = res.getRowObjectsJson()[0] ?? {};
      const actual = row['val'] != null ? Number(row['val']) : null;
      results.push({ check, actual, passed: compareActual(check, actual), error: null });
    } catch (error: unknown) {
      results.push({
        check,
        actual: null,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  conn.closeSync();
  return results;
}

function parseOptions(args: string[]): Options {
  return {
    playersPath: getArg(args, '--players') ?? 'scripts/db/bbr-accuracy-players.json',
    outPath: getArg(args, '--out') ?? 'scripts/db/accuracy-candidates.generated.json',
    checksPath: getArg(args, '--checks') ?? 'scripts/db/accuracy-checks.json',
    cacheDir: getArg(args, '--cache-dir') ?? '.firecrawl/accuracy-sources/players',
    limit: Number(getArg(args, '--limit') ?? 200),
    concurrency: Number(getArg(args, '--concurrency') ?? 2),
    delayMs: Number(getArg(args, '--delay-ms') ?? 1500),
    maxAgeMs: Number(getArg(args, '--max-age-ms') ?? 86400000),
    refresh: args.includes('--refresh'),
    validate: args.includes('--validate') || args.includes('--append'),
    append: args.includes('--append'),
  };
}

function getArg(args: string[], name: string): string | null {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

function extractContent(
  payload: Record<string, unknown>,
  key: 'rawHtml' | 'markdown',
): string | null {
  const direct = payload[key];
  if (typeof direct === 'string') {
    return direct;
  }

  const data = payload['data'];
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const nested = (data as Record<string, unknown>)[key];
    if (typeof nested === 'string') {
      return nested;
    }
  }

  return null;
}

function cachePathFor(cacheDir: string, bbrId: string): string {
  return `${cacheDir}/${bbrId[0]}/${bbrId}.json`;
}

async function ensureParent(path: string) {
  await mkdir(dirname(path), { recursive: true });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
