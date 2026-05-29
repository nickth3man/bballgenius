import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BbrMirroredPage, getMirroredRelativePath } from './bbrMirroredStore.js';

const DEPTH_SAMPLES_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  '.firecrawl',
  'bbr-depth-samples.json',
);

export const BBR_MAP_SECTIONS = ['awards', 'leaders', 'leagues', 'players', 'teams'] as const;
export type BbrMapSection = (typeof BBR_MAP_SECTIONS)[number];

export interface BbrDepthPick {
  section: string;
  depth: number;
  url: string;
  relativePath: string;
}

interface DepthSampleManifest {
  picks: Array<{
    section: string;
    depth: number;
    url: string;
    error?: string;
  }>;
}

let cachedSamples: BbrDepthPick[] | null = null;

/** Loads depth-sample picks from `.firecrawl/bbr-depth-samples.json`. */
export function loadDepthSamples(): BbrDepthPick[] {
  if (cachedSamples) {
    return cachedSamples;
  }

  if (!existsSync(DEPTH_SAMPLES_PATH)) {
    cachedSamples = [];
    return cachedSamples;
  }

  const manifest = JSON.parse(readFileSync(DEPTH_SAMPLES_PATH, 'utf-8')) as DepthSampleManifest;
  cachedSamples = manifest.picks
    .filter((pick) => !pick.error)
    .map((pick) => ({
      section: pick.section,
      depth: pick.depth,
      url: pick.url,
      relativePath: getMirroredRelativePath(pick.url) ?? '',
    }))
    .filter((pick) => pick.relativePath.length > 0);

  return cachedSamples;
}

/** Clears cached depth samples (for tests). */
export function clearDepthSampleCache(): void {
  cachedSamples = null;
}

/** Returns depth-ordered sample chain for a map section (d1 → dN). */
export function getDepthChain(section: string): BbrDepthPick[] {
  return loadDepthSamples()
    .filter((pick) => pick.section === section)
    .sort((a, b) => a.depth - b.depth);
}

/** Puts depth-sample pages first, then remaining mirrored pages alphabetically. */
export function orderSectionPages(sectionId: string, pages: BbrMirroredPage[]): BbrMirroredPage[] {
  const chain = getDepthChain(sectionId);
  const depthPaths = new Set(chain.map((pick) => pick.relativePath));

  const depthOrdered = chain
    .map((pick) => pages.find((page) => page.relativePath === pick.relativePath))
    .filter((page): page is BbrMirroredPage => page !== undefined);

  const rest = pages
    .filter((page) => !depthPaths.has(page.relativePath))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return [...depthOrdered, ...rest];
}

/** Human label for a depth step in the site browser. */
export function depthStepLabel(pick: BbrDepthPick): string {
  const parts = pick.relativePath.split('/');
  const file = parts[parts.length - 1] ?? pick.relativePath;
  if (file === 'index.html' && parts.length >= 2) {
    return `d${pick.depth}: ${parts.slice(-2, -1)[0]}`;
  }
  return `d${pick.depth}: ${file.replace(/\.html$/, '')}`;
}
