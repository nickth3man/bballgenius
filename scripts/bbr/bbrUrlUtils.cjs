const path = require('path');

const BBR_ORIGIN = 'https://www.basketball-reference.com';

const BBR_ALL_SECTIONS = ['players', 'teams', 'leagues', 'leaders', 'awards'];

/** Override with BBR_SCOPE=players or BBR_SCOPE=players,teams (comma/space separated). */
function parseScopeSections() {
  const raw = process.env.BBR_SCOPE?.trim();
  if (!raw) {
    return [...BBR_ALL_SECTIONS];
  }
  const picked = [
    ...new Set(
      raw
        .split(/[,\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => BBR_ALL_SECTIONS.includes(s)),
    ),
  ];
  if (picked.length === 0) {
    console.warn(`[bbr] BBR_SCOPE="${raw}" has no valid sections — using full scope`);
    return [...BBR_ALL_SECTIONS];
  }
  return picked;
}

/** Active map/crawl sections (env BBR_SCOPE). */
const BBR_SCOPE_SECTIONS = parseScopeSections();

/** Top-level sections used for L1 hub checks (same as scope). */
const BBR_SECTIONS = BBR_SCOPE_SECTIONS;

function normalizeBbrUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    if (!url.hostname.includes('basketball-reference.com')) {
      return null;
    }
    url.hash = '';
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.href;
  } catch (_e) {
    return null;
  }
}

function getMirroredRelativePath(urlStr) {
  try {
    const normalized = normalizeBbrUrl(urlStr);
    if (!normalized) {
      return null;
    }
    const url = new URL(normalized);
    let relativePath = url.pathname.replace(/^\//, '').replace(/\/$/, '');

    if (relativePath === '') {
      relativePath = 'index.html';
    }

    if (
      !relativePath.endsWith('.html') &&
      !relativePath.endsWith('.htm') &&
      !relativePath.includes('.')
    ) {
      relativePath = path.join(relativePath, 'index.html');
    }

    return relativePath.replace(/\\/g, '/');
  } catch (_e) {
    return null;
  }
}

function getUrlDepth(urlStr) {
  const rel = getMirroredRelativePath(urlStr);
  if (!rel) {
    return null;
  }
  const withoutIndex = rel.endsWith('/index.html') ? rel.slice(0, -'/index.html'.length) : rel;
  if (withoutIndex === 'index.html' || withoutIndex === '') {
    return 0;
  }
  return withoutIndex.split('/').length;
}

function getUrlSection(urlStr) {
  const normalized = normalizeBbrUrl(urlStr);
  if (!normalized) {
    return null;
  }
  const parts = new URL(normalized).pathname.split('/').filter(Boolean);
  return parts[0] || 'homepage';
}

function isUrlInScope(urlStr) {
  const normalized = normalizeBbrUrl(urlStr);
  if (!normalized) {
    return false;
  }
  const parts = new URL(normalized).pathname.split('/').filter(Boolean);
  if (parts.length === 0) {
    return false;
  }
  return BBR_SCOPE_SECTIONS.includes(parts[0]);
}

function getDiscoveryHubUrls() {
  return BBR_SCOPE_SECTIONS.map((s) => normalizeBbrUrl(`${BBR_ORIGIN}/${s}/`)).filter(Boolean);
}

function sectionRootUrl(section) {
  return normalizeBbrUrl(`${BBR_ORIGIN}/${section}/`);
}

/** Player profile: /players/{letter}/{id}.html (not gamelog subpaths). */
const PLAYER_PROFILE_RE = /\/players\/[a-z]\/[a-z0-9]+\.html$/;

function isPlayerProfileUrl(urlStr) {
  const normalized = normalizeBbrUrl(urlStr);
  if (!normalized) {
    return false;
  }
  return PLAYER_PROFILE_RE.test(new URL(normalized).pathname);
}

function isPlayerGamelogUrl(urlStr) {
  const normalized = normalizeBbrUrl(urlStr);
  if (!normalized) {
    return false;
  }
  return /\/players\/[a-z]\/[a-z0-9]+\/gamelog/.test(new URL(normalized).pathname);
}

function countPlayerProfiles(urlLines) {
  let count = 0;
  for (const line of urlLines) {
    if (isPlayerProfileUrl(line)) {
      count++;
    }
  }
  return count;
}

function countPlayerGamelogs(urlLines) {
  let count = 0;
  for (const line of urlLines) {
    if (isPlayerGamelogUrl(line)) {
      count++;
    }
  }
  return count;
}

function sectionHistogram(urlLines) {
  const bySection = {};
  for (const line of urlLines) {
    const sec = getUrlSection(line) || 'invalid';
    bySection[sec] = (bySection[sec] || 0) + 1;
  }
  return bySection;
}

/** Firecrawl free tier allows 2 concurrent browser jobs. */
const FIRECRAWL_MAX_CONCURRENCY = 2;

function assertFirecrawlConcurrency(label, value) {
  const n = Number.parseInt(String(value), 10);
  if (Number.isNaN(n) || n <= FIRECRAWL_MAX_CONCURRENCY) {
    return;
  }
  console.warn(
    `[${label}] concurrency=${n} exceeds Firecrawl free-tier limit (${FIRECRAWL_MAX_CONCURRENCY}); expect 429s`,
  );
  if (process.env.BBR_ENFORCE_CONCURRENCY_CAP === '1') {
    process.exit(1);
  }
}

module.exports = {
  BBR_ORIGIN,
  BBR_SECTIONS,
  BBR_SCOPE_SECTIONS,
  normalizeBbrUrl,
  getMirroredRelativePath,
  getUrlDepth,
  getUrlSection,
  isUrlInScope,
  getDiscoveryHubUrls,
  sectionRootUrl,
  isPlayerProfileUrl,
  isPlayerGamelogUrl,
  countPlayerProfiles,
  countPlayerGamelogs,
  sectionHistogram,
  FIRECRAWL_MAX_CONCURRENCY,
  assertFirecrawlConcurrency,
};
