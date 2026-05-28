#!/usr/bin/env node
/**
 * Scrapes one representative page per map depth for each scoped BBR section.
 * Saves full scrape JSON to bbr-screenshots/ and .firecrawl/ (mirrored paths).
 *
 * Usage: bun run bbr:scrape-depth-samples
 */
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { getMirroredRelativePath } = require('./bbrUrlUtils.cjs');

const ROOT = path.join(__dirname, '..');
const DEPTH_INDEX = path.join(ROOT, '.firecrawl', 'bbr-depth-index.json');
const MAP_PATH = path.join(ROOT, '.firecrawl', 'bbr-map-full.txt');
const SCREENSHOT_DIR = path.join(ROOT, 'bbr-screenshots');
const FIRECRAWL_DIR = path.join(ROOT, '.firecrawl');
const SECTIONS = ['awards', 'leaders', 'leagues', 'players', 'teams'];
const SCRAPE_TIMEOUT_MS = Number.parseInt(process.env.BBR_SCRAPE_TIMEOUT_MS || '120000', 10);
const SCRAPE_DELAY_MS = Number.parseInt(process.env.BBR_SCRAPE_DELAY_MS || '1500', 10);
const SCRAPE_RATE_LIMIT_MS = Number.parseInt(process.env.BBR_SCRAPE_RATE_LIMIT_MS || '60000', 10);

const DEPTH_OVERRIDES = {
  'awards|2': 'https://www.basketball-reference.com/awards/awards_1977.html',
};

function loadFirecrawlApiKey() {
  if (process.env.FIRECRAWL_API_KEY) {
    return process.env.FIRECRAWL_API_KEY;
  }
  const credPaths = [
    path.join(process.env.APPDATA || '', 'firecrawl-cli', 'credentials.json'),
    path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', 'firecrawl-cli', 'credentials.json'),
  ].filter(Boolean);
  for (const credPath of credPaths) {
    if (!credPath || !fs.existsSync(credPath)) {
      continue;
    }
    try {
      const cred = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
      if (cred?.apiKey) {
        return cred.apiKey;
      }
    } catch {
      // try next path
    }
  }
  return null;
}

const apiKey = loadFirecrawlApiKey();
if (!apiKey) {
  console.error('[ERROR] FIRECRAWL_API_KEY environment variable is required (or run: firecrawl login --browser).');
  process.exit(1);
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    if (u.pathname !== '/' && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.href.replace(/([^:]\/)\/+/g, '$1');
  } catch {
    return url;
  }
}

function inferCategory(url) {
  try {
    return new URL(url).pathname.split('/').filter(Boolean)[0] || 'general';
  } catch {
    return 'general';
  }
}

function getMirroredArtifactPath(urlStr, rootDir, suffix) {
  const relativePath = getMirroredRelativePath(urlStr);
  if (!relativePath) {
    return null;
  }
  return path.join(rootDir, `${relativePath}${suffix}`);
}

function pickUrls() {
  const depthIndex = JSON.parse(fs.readFileSync(DEPTH_INDEX, 'utf-8'));
  const picks = new Map();

  for (const entry of depthIndex.urls) {
    if (!SECTIONS.includes(entry.section)) {
      continue;
    }
    const key = `${entry.section}|${entry.depth}`;
    if (!picks.has(key)) {
      picks.set(key, normalizeUrl(entry.url));
    }
  }

  for (const [key, url] of Object.entries(DEPTH_OVERRIDES)) {
    picks.set(key, normalizeUrl(url));
  }

  const mapLines = fs.readFileSync(MAP_PATH, 'utf-8').split(/\r?\n/).filter(Boolean);
  for (const section of SECTIONS) {
    const hub = mapLines.find((line) => line === `https://www.basketball-reference.com/${section}`);
    if (hub) {
      picks.set(`${section}|1`, hub);
    }
  }

  return [...picks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, url]) => {
      const [section, depth] = key.split('|');
      return { section, depth: Number(depth), url };
    });
}

function scrapeViaFirecrawl(url) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      url,
      formats: ['markdown', 'links'],
      onlyMainContent: false,
    });

    const options = {
      hostname: 'api.firecrawl.dev',
      port: 443,
      path: '/v2/scrape',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Firecrawl API ${res.statusCode}: ${body}`));
          return;
        }
        try {
          const parsed = JSON.parse(body);
          if (parsed?.success && parsed.data) {
            resolve(parsed.data);
          } else {
            reject(new Error(`Invalid Firecrawl response: ${body.slice(0, 300)}`));
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(SCRAPE_TIMEOUT_MS, () => {
      req.destroy(new Error(`Firecrawl scrape timeout after ${SCRAPE_TIMEOUT_MS}ms`));
    });
    req.write(data);
    req.end();
  });
}

function scrapeRetryAfterMs(message) {
  const match = message.match(/retry after (\d+)s/i);
  if (match) {
    return (Number.parseInt(match[1], 10) + 1) * 1000;
  }
  if (/rate limit|429|too many requests/i.test(message)) {
    return SCRAPE_RATE_LIMIT_MS;
  }
  return 0;
}

async function scrapeWithRetry(url) {
  const maxAttempts = 6;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await scrapeViaFirecrawl(url);
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      const waitMs = scrapeRetryAfterMs(message);
      if (!waitMs || attempt === maxAttempts) {
        break;
      }
      console.log(`[scrape-depth] rate limited — waiting ${Math.round(waitMs / 1000)}s (${attempt}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastErr;
}

function buildRecord(url, crawlData) {
  return {
    url,
    category: inferCategory(url),
    scrapedAt: new Date().toISOString(),
    markdown: crawlData.markdown ?? null,
    links: crawlData.links || [],
    metadata: crawlData.metadata || null,
    screenshot: crawlData.screenshot ?? null,
  };
}

function saveJson(url, record, rootDir) {
  const jsonPath = getMirroredArtifactPath(url, rootDir, '.json');
  if (!jsonPath) {
    throw new Error(`Cannot mirror path for ${url}`);
  }
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
  return jsonPath;
}

function saveMarkdown(url, markdown) {
  if (!markdown) {
    return null;
  }
  const mdPath = getMirroredArtifactPath(url, FIRECRAWL_DIR, '.md');
  if (!mdPath) {
    return null;
  }
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, markdown, 'utf-8');
  return mdPath;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const picks = pickUrls();
  console.log(`[scrape-depth] ${picks.length} URLs to scrape`);

  const manifest = [];
  for (const pick of picks) {
    console.log(`[scrape-depth] d${pick.depth} ${pick.section}: ${pick.url}`);
    try {
      const crawlData = await scrapeWithRetry(pick.url);
      const record = buildRecord(pick.url, crawlData);
      const shotPath = saveJson(pick.url, record, SCREENSHOT_DIR);
      const cachePath = saveJson(pick.url, record, FIRECRAWL_DIR);
      const mdPath = saveMarkdown(pick.url, crawlData.markdown);
      manifest.push({
        section: pick.section,
        depth: pick.depth,
        url: pick.url,
        json: shotPath,
        cacheJson: cachePath,
        markdown: mdPath,
      });
      await sleep(SCRAPE_DELAY_MS);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[scrape-depth] FAILED d${pick.depth} ${pick.section}: ${message}`);
      manifest.push({
        section: pick.section,
        depth: pick.depth,
        url: pick.url,
        error: message,
      });
    }
  }

  const manifestPath = path.join(FIRECRAWL_DIR, 'bbr-depth-samples.json');
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({ scrapedAt: new Date().toISOString(), picks: manifest }, null, 2)}\n`,
  );
  const ok = manifest.filter((m) => !m.error).length;
  console.log(`[scrape-depth] done: ${ok}/${manifest.length} saved → ${manifestPath}`);
  if (ok < manifest.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
