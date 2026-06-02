import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FIRECRAWL_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  '.firecrawl',
);
const SCREENSHOTS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'bbr-screenshots',
);

export interface BbrMirroredPage {
  relativePath: string;
  section: string;
  url: string | null;
  label: string;
}

/**
 * Maps a BBR URL to a mirrored relative path (e.g. players/j/jamesle01.html).
 */
export function getMirroredRelativePath(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    let relativePath = parsed.pathname.replace(/^\//, '').replace(/\/$/, '');

    if (relativePath === '') {
      relativePath = 'index.html';
    }

    if (
      !relativePath.endsWith('.html') &&
      !relativePath.endsWith('.htm') &&
      !relativePath.endsWith('.cgi') &&
      !relativePath.endsWith('.fcgi') &&
      !relativePath.includes('.')
    ) {
      relativePath = join(relativePath, 'index.html');
    }

    return relativePath.replace(/\\/g, '/');
  } catch {
    return null;
  }
}

function readMarkdownFile(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, 'utf-8');
}

function readScreenshotJsonMarkdown(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const record = JSON.parse(readFileSync(path, 'utf-8')) as { markdown?: string };
    return record.markdown ?? null;
  } catch {
    return null;
  }
}

/**
 * Reads mirrored markdown for a relative BBR path from .firecrawl or bbr-screenshots.
 */
export function readMirroredMarkdown(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, '/');

  const firecrawlMd = readMarkdownFile(join(FIRECRAWL_DIR, `${normalized}.md`));
  if (firecrawlMd) {
    return firecrawlMd;
  }

  const screenshotJson = readScreenshotJsonMarkdown(join(SCREENSHOTS_DIR, `${normalized}.json`));
  if (screenshotJson) {
    return screenshotJson;
  }

  const firecrawlJson = readScreenshotJsonMarkdown(join(FIRECRAWL_DIR, `${normalized}.json`));
  if (firecrawlJson) {
    return firecrawlJson;
  }

  return null;
}

/**
 * Reads mirrored markdown for a full BBR URL.
 */
export function readMirroredMarkdownFromUrl(url: string): string | null {
  const relativePath = getMirroredRelativePath(url);
  if (!relativePath) {
    return null;
  }
  return readMirroredMarkdown(relativePath);
}

function pathToLabel(relativePath: string): string {
  const parts = relativePath.replace(/\\/g, '/').split('/');
  const file = parts[parts.length - 1] ?? relativePath;
  if (file === 'index.html') {
    return parts.slice(-2, -1)[0] ?? 'index';
  }
  return file.replace(/\.(html|cgi|fcgi)$/, '');
}

function walkJsonFiles(dir: string, baseDir: string, out: BbrMirroredPage[]): void {
  if (!existsSync(dir)) {
    return;
  }

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkJsonFiles(full, baseDir, out);
      continue;
    }
    if (!entry.endsWith('.json')) {
      continue;
    }

    const relativePath = full
      .slice(baseDir.length + 1)
      .replace(/\\/g, '/')
      .replace(/\.json$/, '');
    const section = relativePath.split('/')[0] ?? 'homepage';
    let url: string | null = null;

    try {
      const record = JSON.parse(readFileSync(full, 'utf-8')) as { url?: string };
      url = record.url ?? null;
    } catch {
      url = null;
    }

    out.push({
      relativePath,
      section,
      url,
      label: pathToLabel(relativePath),
    });
  }
}

let cachedPages: BbrMirroredPage[] | null = null;

/**
 * Lists all mirrored pages discovered in bbr-screenshots (preferred) and .firecrawl JSON caches.
 */
export function listMirroredPages(): BbrMirroredPage[] {
  if (cachedPages) {
    return cachedPages;
  }

  const pages: BbrMirroredPage[] = [];
  walkJsonFiles(SCREENSHOTS_DIR, SCREENSHOTS_DIR, pages);

  const seen = new Set(pages.map((p) => p.relativePath));
  const firecrawlPages: BbrMirroredPage[] = [];
  walkJsonFiles(FIRECRAWL_DIR, FIRECRAWL_DIR, firecrawlPages);
  for (const page of firecrawlPages) {
    if (!seen.has(page.relativePath)) {
      pages.push(page);
      seen.add(page.relativePath);
    }
  }

  cachedPages = pages;
  return cachedPages;
}

/** Clears the in-memory page index (for tests). */
export function clearMirroredPageCache(): void {
  cachedPages = null;
}
