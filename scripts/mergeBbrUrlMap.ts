/**
 * Merges Firecrawl map scratchpad outputs into bbr-map-full.txt + bbr-depth-index.json.
 * Usage:
 *   bun run scripts/mergeBbrUrlMap.ts --interim   # Pass D seeds only
 *   bun run scripts/mergeBbrUrlMap.ts             # full merge + quality gate
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';

const require = createRequire(import.meta.url);
const {
  BBR_SECTIONS,
  getMirroredRelativePath,
  getUrlDepth,
  getUrlSection,
  isUrlInScope,
  normalizeBbrUrl,
  sectionRootUrl,
} = require('./bbrUrlUtils.cjs') as typeof import('./bbrUrlUtils.cjs');

const ROOT = join(import.meta.dirname, '..');
const FIRECRAWL_DIR = join(ROOT, '.firecrawl');
const SCRATCHPAD = join(FIRECRAWL_DIR, 'scratchpad');
const MAP_OUT = join(FIRECRAWL_DIR, 'bbr-map-full.txt');
const DEPTH_OUT = join(FIRECRAWL_DIR, 'bbr-depth-index.json');
const PASS_D_SEEDS = join(SCRATCHPAD, 'map-pass-d-seeds.txt');

const isInterim = process.argv.includes('--interim');

function listScratchpadFiles(): string[] {
  if (!existsSync(SCRATCHPAD)) {
    return [];
  }
  return readdirSync(SCRATCHPAD)
    .filter((name) => name.startsWith('map-'))
    .map((name) => join(SCRATCHPAD, name));
}

function extractUrlsFromText(text: string): string[] {
  const urls: string[] = [];
  const re = /https?:\/\/(?:www\.)?basketball-reference\.com[^\s)\]"'<>]*/gi;
  for (const match of text.match(re) || []) {
    const cleaned = match.replace(/[.,;]+$/, '');
    const n = normalizeBbrUrl(cleaned);
    if (n) {
      urls.push(n);
    }
  }
  return urls;
}

function extractUrlsFromJson(raw: string): string[] {
  const urls: string[] = [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const candidates: unknown[] = [];
    if (Array.isArray(parsed)) {
      candidates.push(...parsed);
    }
    if (Array.isArray(parsed.links)) {
      candidates.push(...parsed.links);
    }
    if (Array.isArray(parsed.urls)) {
      candidates.push(...parsed.urls);
    }
    const data = parsed.data;
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      if (Array.isArray(d.links)) {
        candidates.push(...d.links);
      }
      if (Array.isArray(d.urls)) {
        candidates.push(...d.urls);
      }
    }
    for (const item of candidates) {
      if (typeof item === 'string') {
        const n = normalizeBbrUrl(item);
        if (n) {
          urls.push(n);
        }
      } else if (item && typeof item === 'object' && 'url' in item) {
        const n = normalizeBbrUrl(String((item as { url: string }).url));
        if (n) {
          urls.push(n);
        }
      }
    }
  } catch {
    return extractUrlsFromText(raw);
  }
  return urls;
}

function collectUrlsFromScratchpad(): Set<string> {
  const urls = new Set<string>();
  for (const filePath of listScratchpadFiles()) {
    const raw = readFileSync(filePath, 'utf-8');
    const extracted = filePath.endsWith('.json')
      ? extractUrlsFromJson(raw)
      : extractUrlsFromText(raw);
    for (const u of extracted) {
      urls.add(u);
    }
  }
  return urls;
}

function pickPassDSeeds(urls: Set<string>): string[] {
  const seeds = new Set<string>();
  const letterBuckets = new Set<string>();

  for (const url of urls) {
    const normalized = normalizeBbrUrl(url);
    if (!normalized) {
      continue;
    }
    const pathname = new URL(normalized).pathname;
    const playerLetter = pathname.match(/^\/players\/([a-z])\/?$/i);
    if (playerLetter) {
      letterBuckets.add(playerLetter[1].toLowerCase());
    }
    if (pathname.match(/^\/players\/[a-z]\/[a-z0-9]+\.html$/i)) {
      seeds.add(normalized);
    }
  }

  if (letterBuckets.size > 0) {
    for (const letter of letterBuckets) {
      const hub = normalizeBbrUrl(`https://www.basketball-reference.com/players/${letter}/`);
      if (hub) {
        seeds.add(hub);
      }
    }
  } else {
    for (let code = 97; code <= 122; code++) {
      const letter = String.fromCharCode(code);
      const hub = normalizeBbrUrl(`https://www.basketball-reference.com/players/${letter}/`);
      if (hub) {
        seeds.add(hub);
      }
    }
  }

  const maxSeeds = Number.parseInt(process.env.BBR_PASS_D_MAX_SEEDS || '40', 10);
  return [...seeds].slice(0, Math.max(1, maxSeeds));
}

function runInterim(): void {
  const urls = collectUrlsFromScratchpad();
  const seeds = pickPassDSeeds(urls);
  writeFileSync(PASS_D_SEEDS, `${seeds.join('\n')}\n`, 'utf-8');
  console.log(`[merge] interim: wrote ${seeds.length} Pass D seeds -> ${PASS_D_SEEDS}`);
}

function runFullMerge(): void {
  const files = listScratchpadFiles();
  if (files.length === 0) {
    console.error('[merge] ERROR: no scratchpad map-* files; run bbr:map first');
    process.exit(1);
  }

  const rawUrls = collectUrlsFromScratchpad();
  const urls = new Set([...rawUrls].filter((u) => isUrlInScope(u)));
  if (urls.size === 0) {
    console.error('[merge] ERROR: scratchpad contained no in-scope BBR URLs');
    process.exit(1);
  }
  if (urls.size < rawUrls.size) {
    console.log(`[merge] scoped filter: ${rawUrls.size} → ${urls.size} URLs`);
  }

  const sorted = [...urls].sort((a, b) => {
    const da = getUrlDepth(a) ?? 99;
    const db = getUrlDepth(b) ?? 99;
    if (da !== db) {
      return da - db;
    }
    return a.localeCompare(b);
  });

  const byDepth: Record<string, number> = {};
  const entries = sorted.map((url) => {
    const depth = getUrlDepth(url) ?? 0;
    const key = String(depth);
    byDepth[key] = (byDepth[key] || 0) + 1;
    const mirroredDir = getMirroredRelativePath(url)?.replace(/\/[^/]+$/, '') || '';
    return {
      url,
      depth,
      section: getUrlSection(url),
      mirroredDir,
    };
  });

  writeFileSync(MAP_OUT, `${sorted.join('\n')}\n`, 'utf-8');
  writeFileSync(
    DEPTH_OUT,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalUrls: sorted.length,
        byDepth,
        urls: entries,
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );

  console.log(`[merge] wrote ${sorted.length} URLs -> ${MAP_OUT}`);
  console.log(`[merge] depth histogram: ${JSON.stringify(byDepth)}`);

  const { patchMapProgress } = require('./bbrObservability.cjs') as {
    patchMapProgress: (patch: Record<string, unknown>) => unknown;
  };
  patchMapProgress({
    pass: 'done',
    step: 'merged',
    mergedUrlCount: sorted.length,
    byDepth,
  });

  const missingSections: string[] = [];
  for (const section of BBR_SECTIONS) {
    const root = sectionRootUrl(section);
    if (root && !urls.has(root)) {
      missingSections.push(section);
    }
  }
  if (missingSections.length > 0) {
    console.error(`[merge] ERROR: missing L1 section roots: ${missingSections.join(', ')}`);
    process.exit(1);
  }

  const deepCount = [4, 5, 6].reduce((sum, depth) => sum + (byDepth[String(depth)] || 0), 0);
  if (deepCount === 0) {
    console.error('[merge] ERROR: no URLs at depth 4–6 (player subpages / boxscore children)');
    process.exit(1);
  }
  if (sorted.length >= 500) {
    for (const depth of [4, 5]) {
      if ((byDepth[String(depth)] || 0) === 0) {
        console.error(`[merge] ERROR: large map (${sorted.length} URLs) missing depth ${depth}`);
        process.exit(1);
      }
    }
  } else {
    console.warn(`[merge] WARN: only ${sorted.length} URLs — skipping strict per-depth 4/5 checks`);
  }

  const shallowSections = BBR_SECTIONS.filter((section) => {
    const count = entries.filter((e) => e.section === section && e.depth >= 4).length;
    return count === 0;
  });
  if (shallowSections.length > 0) {
    console.warn(`[merge] WARN: sections with no depth>=4 URLs: ${shallowSections.join(', ')}`);
  }
}

if (isInterim) {
  runInterim();
} else {
  const scratchMtime = existsSync(SCRATCHPAD)
    ? Math.max(...listScratchpadFiles().map((f) => statSync(f).mtimeMs), 0)
    : 0;
  runFullMerge();
  if (existsSync(MAP_OUT) && scratchMtime > 0 && statSync(MAP_OUT).mtimeMs < scratchMtime) {
    console.warn('[merge] WARN: map output mtime older than scratchpad (unexpected)');
  }
  console.log(`[merge] done (${basename(MAP_OUT)}, ${basename(DEPTH_OUT)})`);
}
