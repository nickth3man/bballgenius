const fs = require('fs');
const path = require('path');
const https = require('https');
const {
  getDiscoveryHubUrls,
  getMirroredRelativePath,
  getUrlDepth,
  isUrlInScope,
  normalizeBbrUrl,
} = require('./bbrUrlUtils.cjs');
const { writeCrawlProgress } = require('./bbrObservability.cjs');

const SCREENSHOT_DIR = path.join(__dirname, '..', 'bbr-screenshots');
const FIRECRAWL_DIR = path.join(__dirname, '..', '.firecrawl');
const MAP_PATH = path.join(FIRECRAWL_DIR, 'bbr-map-full.txt');
const DEPTH_INDEX_PATH = path.join(FIRECRAWL_DIR, 'bbr-depth-index.json');
const DISCOVERED_APPEND_PATH = path.join(FIRECRAWL_DIR, 'bbr-map-discovered.txt');
const ARTIFACTS_PER_DIRECTORY = 2;
const STATUS_INTERVAL_MS = Number.parseInt(process.env.BBR_STATUS_INTERVAL_MS || '15000', 10);
const DISCOVERY_COOLDOWN_MS = Number.parseInt(process.env.BBR_DISCOVERY_COOLDOWN_MS || '1500', 10);
const SCRAPE_TIMEOUT_MS = Number.parseInt(process.env.BBR_SCRAPE_TIMEOUT_MS || '120000', 10);
const CRAWL_CONCURRENCY = Number.parseInt(process.env.BBR_CRAWL_CONCURRENCY || '2', 10);
const SCRAPE_RATE_LIMIT_MS = Number.parseInt(process.env.BBR_SCRAPE_RATE_LIMIT_MS || '1500', 10);
const VERBOSE_PATHS = process.env.BBR_VERBOSE_PATHS !== '0';
const BBR_URL_PATTERN = /https?:\/\/(?:www\.)?basketball-reference\.com[^\s)\]"'<>]*/gi;
const USE_LEGACY_SEEDS = process.env.BBR_USE_LEGACY_SEEDS === '1';

const DISCOVERY_HUB_URLS = getDiscoveryHubUrls();

const LEGACY_SCATTERED_SEEDS = [
  'https://www.basketball-reference.com/',
  'https://www.basketball-reference.com/players/t/tuckepj01.html',
  'https://www.basketball-reference.com/leagues/NBA_2024.html',
  'https://www.basketball-reference.com/teams/BOS/2024.html',
  'https://www.basketball-reference.com/boxscores/202406060BOS.html',
  'https://www.basketball-reference.com/draft/NBA_2024.html',
  'https://www.basketball-reference.com/contracts/CLE.html',
  'https://www.basketball-reference.com/leaders/pts_career.html',
  'https://www.basketball-reference.com/allstar/NBA_2016.html',
  'https://www.basketball-reference.com/playoffs/NBA_2024.html',
];

function formatDuration(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) {
    return `${h}h ${m}m ${r}s`;
  }
  if (m > 0) {
    return `${m}m ${r}s`;
  }
  return `${r}s`;
}

function formatTs() {
  return new Date().toISOString().slice(11, 23);
}

function logObs(level, workerId, message) {
  const workerLabel = workerId != null ? `W${workerId}` : 'SYS';
  console.log(`[${formatTs()}] [${level.padEnd(5)}] [${workerLabel}] ${message}`);
}

function setWorkerPhase(state, workerId, phase, detail) {
  state.workerStatus.set(workerId, {
    phase,
    detail: detail || '',
    since: Date.now(),
  });
}

function getDirectoryKey(url, rootDir = SCREENSHOT_DIR) {
  const jsonPath = getMirroredArtifactPath(url, rootDir, '.json');
  if (!jsonPath) {
    return null;
  }
  return path.dirname(jsonPath);
}

function countFilesWithExtension(dirPath, ext) {
  if (!fs.existsSync(dirPath)) {
    return 0;
  }
  return fs.readdirSync(dirPath).filter((name) => name.endsWith(ext)).length;
}

function directoryPngCount(state, dirKey) {
  if (state.directoryPngCounts.has(dirKey)) {
    return state.directoryPngCounts.get(dirKey);
  }
  const count = countFilesWithExtension(dirKey, '.png');
  state.directoryPngCounts.set(dirKey, count);
  return count;
}

function directoryJsonCount(state, dirKey) {
  if (state.directoryJsonCounts.has(dirKey)) {
    return state.directoryJsonCounts.get(dirKey);
  }
  const count = countFilesWithExtension(dirKey, '.json');
  state.directoryJsonCounts.set(dirKey, count);
  return count;
}

function directoryNeedsPng(state, dirKey) {
  return directoryPngCount(state, dirKey) < ARTIFACTS_PER_DIRECTORY;
}

function directoryNeedsJson(state, dirKey) {
  return directoryJsonCount(state, dirKey) < ARTIFACTS_PER_DIRECTORY;
}

function directoryNeedsWork(state, dirKey) {
  return directoryNeedsPng(state, dirKey) || directoryNeedsJson(state, dirKey);
}

function getIncompleteDirectories(state) {
  return [...state.discoveredDirectories].filter((dirKey) => directoryNeedsWork(state, dirKey));
}

function getDirectoryProgress(state) {
  const total = state.discoveredDirectories.size;
  const complete = total - getIncompleteDirectories(state).length;
  return { total, complete, pct: total > 0 ? Math.round((complete / total) * 100) : 0 };
}

function getUrlPriorityDepth(state, url) {
  if (state.urlDepths.has(url)) {
    return state.urlDepths.get(url);
  }
  return getUrlDepth(url) ?? 99;
}

function publishCrawlProgress(state, extra) {
  const progress = getDirectoryProgress(state);
  const incomplete = getIncompleteDirectories(state);
  const budget = process.env.BBR_CRAWL_BUDGET
    ? Number.parseInt(process.env.BBR_CRAWL_BUDGET, 10)
    : null;

  writeCrawlProgress({
    phase: 'crawl',
    startedAt: new Date(state.stats.startedAt).toISOString(),
    crawledCount: state.stats.crawledCount,
    failedCount: state.stats.failedCount,
    budget: Number.isFinite(budget) ? budget : null,
    directoriesTotal: progress.total,
    directoriesComplete: progress.complete,
    directoriesIncomplete: incomplete.length,
    screenshotsSaved: state.stats.screenshotsSaved,
    screenshotsReused: state.stats.screenshotsReused,
    jsonSaved: state.stats.jsonSaved,
    markdownSaved: state.stats.markdownSaved,
    queueLength: state.urlQueue.length,
    poolSize: state.discoveredLinksPool.size,
    inFlight: state.inFlight.size,
    visited: state.visitedUrls.size,
    discoveryRuns: state.stats.discoveryRuns,
    lastError: state.stats.lastError || null,
    incompletePreview: incomplete.slice(0, 8).map((dirKey) => path.relative(SCREENSHOT_DIR, dirKey)),
    ...extra,
  });
}

function printStatusBoard(state) {
  const elapsedSec = (Date.now() - state.stats.startedAt) / 1000;
  const progress = getDirectoryProgress(state);
  const rate = elapsedSec > 0 ? (state.stats.crawledCount / elapsedSec).toFixed(2) : '0.00';
  const incomplete = getIncompleteDirectories(state);
  publishCrawlProgress(state);

  console.log('\n┌─── CRAWL STATUS ───────────────────────────────────────────────────────');
  console.log(
    `│ ⏱  ${formatDuration(elapsedSec)} elapsed | 🔄 ${state.stats.crawledCount} crawled (${rate}/s) | ✗ ${state.stats.failedCount} failed`,
  );
  console.log(
    `│ 📊 Directories ${progress.complete}/${progress.total} complete (${progress.pct}%) | ` +
      `⏳ ${incomplete.length} incomplete | 🧵 in-flight ${state.inFlight.size}`,
  );
  console.log(
    `│ 📥 Queue ${state.urlQueue.length} | 🌐 pool ${state.discoveredLinksPool.size} | ` +
      `👣 visited ${state.visitedUrls.size} | 🧹 purged ${state.stats.purgedFromQueue}`,
  );
  console.log(
    `│ 💾 PNG +${state.stats.screenshotsSaved} | JSON +${state.stats.jsonSaved} | MD +${state.stats.markdownSaved} | ` +
      `♻️  reused ${state.stats.screenshotsReused}`,
  );

  if (incomplete.length > 0) {
    const preview = incomplete
      .slice(0, 8)
      .map((dirKey) => {
        const rel = path.relative(SCREENSHOT_DIR, dirKey);
        const png = directoryPngCount(state, dirKey);
        const json = directoryJsonCount(state, dirKey);
        return `${rel}:${png}/${ARTIFACTS_PER_DIRECTORY}p ${json}/${ARTIFACTS_PER_DIRECTORY}j`;
      })
      .join(', ');
    const suffix = incomplete.length > 8 ? ` … +${incomplete.length - 8} more` : '';
    console.log(`│ 🎯 Incomplete: ${preview}${suffix}`);
  } else {
    console.log('│ 🎯 Incomplete: none — per-directory coverage target met');
  }

  console.log('│ 👷 Workers:');
  for (let i = 1; i <= state.concurrencyLimit; i++) {
    const ws = state.workerStatus.get(i);
    if (!ws) {
      console.log(`│    W${i}: unknown`);
      continue;
    }
    const phaseSec = ((Date.now() - ws.since) / 1000).toFixed(0);
    const detail = ws.detail ? ` — ${ws.detail}` : '';
    console.log(`│    W${i}: ${ws.phase} (${phaseSec}s)${detail}`);
  }
  console.log('└──────────────────────────────────────────────────────────────────────\n');
}

function maybePrintStatusBoard(state) {
  if (Date.now() - state.stats.lastStatusAt >= STATUS_INTERVAL_MS) {
    state.stats.lastStatusAt = Date.now();
    printStatusBoard(state);
  }
}

function logArtifactPath(workerId, kind, filePath) {
  if (VERBOSE_PATHS) {
    logObs('SAVE', workerId, `${kind} -> ${filePath}`);
    return;
  }
  const rel =
    filePath.includes('bbr-screenshots') ?
      path.relative(SCREENSHOT_DIR, filePath)
    : path.relative(FIRECRAWL_DIR, filePath);
  logObs('SAVE', workerId, `${kind} -> ${rel}`);
}

fs.mkdirSync(FIRECRAWL_DIR, { recursive: true });
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const apiKey = process.env.FIRECRAWL_API_KEY;
if (!apiKey) {
  console.error('[ERROR] FIRECRAWL_API_KEY environment variable is required.');
  process.exit(1);
}

function ensureMapFresh() {
  if (!fs.existsSync(MAP_PATH)) {
    console.error(`[ERROR] Missing ${MAP_PATH}. Run: bun run bbr:map`);
    process.exit(1);
  }

  const scratchpad = path.join(FIRECRAWL_DIR, 'scratchpad');
  if (fs.existsSync(scratchpad)) {
    let newestScratch = 0;
    for (const name of fs.readdirSync(scratchpad)) {
      if (!name.startsWith('map-')) {
        continue;
      }
      const mtime = fs.statSync(path.join(scratchpad, name)).mtimeMs;
      if (mtime > newestScratch) {
        newestScratch = mtime;
      }
    }
    if (newestScratch > 0) {
      const mapMtime = fs.statSync(MAP_PATH).mtimeMs;
      const progressPath = path.join(FIRECRAWL_DIR, 'bbr-map-progress.json');
      let mapDone = false;
      if (fs.existsSync(progressPath)) {
        try {
          const progress = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
          mapDone = progress.pass === 'done';
        } catch {
          mapDone = false;
        }
      }
      if (mapMtime < newestScratch && !mapDone) {
        console.error(
          '[ERROR] bbr-map-full.txt is older than scratchpad map outputs. Re-run: bun run bbr:map',
        );
        process.exit(1);
      }
    }
  }
}

function loadDepthIndex(state) {
  if (!fs.existsSync(DEPTH_INDEX_PATH)) {
    logObs('WARN', null, `No depth index at ${DEPTH_INDEX_PATH}; using computed depths`);
    return;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DEPTH_INDEX_PATH, 'utf-8'));
    for (const entry of parsed.urls || []) {
      if (entry.url && typeof entry.depth === 'number') {
        state.urlDepths.set(normalizeBbrUrl(entry.url), entry.depth);
      }
    }
    logObs('INFO', null, `Loaded depth index for ${state.urlDepths.size} URLs`);
  } catch (err) {
    logObs('WARN', null, `Failed to load depth index: ${err instanceof Error ? err.message : err}`);
  }
}

function loadInitialSeeds() {
  ensureMapFresh();
  const seeds = new Set();
  const mapLines = fs.readFileSync(MAP_PATH, 'utf-8').split(/\r?\n/);
  for (const line of mapLines) {
    const normalized = normalizeBbrUrl(line.trim());
    if (normalized && isUrlInScope(normalized)) {
      seeds.add(normalized);
    }
  }

  if (USE_LEGACY_SEEDS) {
    for (const seed of LEGACY_SCATTERED_SEEDS) {
      const normalized = normalizeBbrUrl(seed);
      if (normalized) {
        seeds.add(normalized);
      }
    }
    logObs('WARN', null, 'BBR_USE_LEGACY_SEEDS=1 — appended legacy scattered seeds');
  }

  console.log(`[DEBUG] Loaded ${seeds.size} seed URLs from bbr-map-full.txt (${mapLines.length} lines).`);
  return [...seeds];
}

function urlFromMirroredScreenshotPath(relPath) {
  let p = relPath.replace(/\\/g, '/').replace(/\.png$/, '');
  if (p === 'index.html') {
    return normalizeBbrUrl('https://www.basketball-reference.com/');
  }
  if (p.endsWith('/index.html')) {
    p = p.slice(0, -'/index.html'.length);
  }
  return normalizeBbrUrl(`https://www.basketball-reference.com/${p}`);
}

function registerUrlInGraph(state, url) {
  const category = classifyUrl(url);
  const dirKey = getDirectoryKey(url);
  if (!dirKey) {
    return null;
  }

  state.discoveredDirectories.add(dirKey);
  if (category) {
    state.discoveredCategories.add(category);
    if (!state.urlsByCategory.has(category)) {
      state.urlsByCategory.set(category, new Set());
    }
    state.urlsByCategory.get(category).add(url);
  }

  if (!state.urlsByDirectory.has(dirKey)) {
    state.urlsByDirectory.set(dirKey, new Set());
  }
  state.urlsByDirectory.get(dirKey).add(url);
  return { category, dirKey };
}

function bootstrapFromExistingScreenshots(state) {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    return 0;
  }

  let filesFound = 0;

  function walkDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
        continue;
      }
      if (!entry.name.endsWith('.png')) {
        continue;
      }

      filesFound++;
      const relPath = path.relative(SCREENSHOT_DIR, fullPath);
      const url = urlFromMirroredScreenshotPath(relPath);
      if (!url) {
        continue;
      }

      registerUrlInGraph(state, url);
      const dirKey = getDirectoryKey(url);
      if (dirKey) {
        const current = directoryPngCount(state, dirKey);
        state.directoryPngCounts.set(dirKey, Math.min(current + 1, ARTIFACTS_PER_DIRECTORY));
      }
    }
  }

  walkDir(SCREENSHOT_DIR);
  return filesFound;
}

function bootstrapFromExistingJson(state) {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    return 0;
  }

  let filesFound = 0;

  function walkDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.name.endsWith('.json')) {
        filesFound++;
        const rel = path.relative(SCREENSHOT_DIR, fullPath).replace(/\.json$/, '');
        const url = urlFromMirroredScreenshotPath(`${rel}.png`);
        if (url) {
          registerUrlInGraph(state, url);
          const dirKey = getDirectoryKey(url);
          if (dirKey) {
            const current = directoryJsonCount(state, dirKey);
            state.directoryJsonCounts.set(dirKey, Math.min(current + 1, ARTIFACTS_PER_DIRECTORY));
          }
        }
      }
    }
  }

  walkDir(SCREENSHOT_DIR);
  return filesFound;
}

function bootstrapLinkGraphFromSeeds(state, seeds) {
  for (const seed of seeds) {
    registerUrlInGraph(state, seed);
  }
}

function urlNeedsCrawl(state, url) {
  if (!isUrlInScope(url)) {
    return false;
  }
  const dirKey = getDirectoryKey(url);
  if (!dirKey) {
    return false;
  }
  const pngPath = getMirroredArtifactPath(url, SCREENSHOT_DIR, '.png');
  const jsonPath = getMirroredArtifactPath(url, SCREENSHOT_DIR, '.json');
  const needsPng = directoryNeedsPng(state, dirKey) && pngPath && !fs.existsSync(pngPath);
  const needsJson = directoryNeedsJson(state, dirKey) && jsonPath && !fs.existsSync(jsonPath);
  return needsPng || needsJson;
}

function isUrlActionable(state, url) {
  if (state.inFlight.has(url) || state.queuedUrls.has(url)) {
    return false;
  }
  if (state.visitedUrls.has(url) && !state.recrawlUrls.has(url)) {
    return false;
  }
  return urlNeedsCrawl(state, url);
}

/** URLs already in urlQueue are in queuedUrls; dequeue must not treat that as non-actionable. */
function isUrlDequeueable(state, url) {
  if (state.inFlight.has(url)) {
    return false;
  }
  if (state.visitedUrls.has(url) && !state.recrawlUrls.has(url)) {
    return false;
  }
  return urlNeedsCrawl(state, url);
}

function getActionablePoolCandidates(state) {
  return Array.from(state.discoveredLinksPool).filter((link) => isUrlActionable(state, link));
}

function extractBbrUrlsFromText(text) {
  const matches = text.match(BBR_URL_PATTERN) || [];
  const urls = [];
  for (let raw of matches) {
    raw = raw.replace(/[.,;]+$/, '');
    const normalized = normalizeBbrUrl(raw);
    if (normalized) {
      urls.push(normalized);
    }
  }
  return urls;
}

function appendDiscoveredUrl(url) {
  fs.appendFileSync(DISCOVERED_APPEND_PATH, `${url}\n`, 'utf-8');
}

function maybeEnqueueHarvestedLink(state, link, targetDirs) {
  const normalized = normalizeBbrUrl(link);
  if (!normalized) {
    return 0;
  }
  const dirKey = getDirectoryKey(normalized);
  if (!dirKey || !targetDirs.has(dirKey)) {
    return 0;
  }
  state.discoveredLinksPool.add(normalized);
  registerUrlInGraph(state, normalized);
  return enqueueUrl(state, normalized, true) ? 1 : 0;
}

function harvestLinksFromDisk(state, targetDirs) {
  const targets = new Set(targetDirs);
  let enqueued = 0;

  function processFile(filePath) {
    if (filePath.endsWith('.json')) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        for (const link of parsed.links || []) {
          enqueued += maybeEnqueueHarvestedLink(state, link, targets);
        }
      } catch (_err) {
        // skip malformed cache files
      }
      return;
    }
    if (filePath.endsWith('.md')) {
      const text = fs.readFileSync(filePath, 'utf-8');
      for (const link of extractBbrUrlsFromText(text)) {
        enqueued += maybeEnqueueHarvestedLink(state, link, targets);
      }
    }
  }

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) {
        processFile(fullPath);
      }
    }
  }

  for (const rootDir of [FIRECRAWL_DIR, SCREENSHOT_DIR]) {
    if (fs.existsSync(rootDir)) {
      walk(rootDir);
    }
  }

  if (enqueued > 0) {
    state.stats.harvestedLinks += enqueued;
  }
  return enqueued;
}

function enqueueRecrawlUrl(state, url, prioritize) {
  if (!urlNeedsCrawl(state, url)) {
    return false;
  }
  if (state.inFlight.has(url) || state.queuedUrls.has(url)) {
    return false;
  }

  state.recrawlUrls.add(url);
  registerUrlInGraph(state, url);
  if (prioritize) {
    state.urlQueue.unshift(url);
  } else {
    state.urlQueue.push(url);
  }
  state.queuedUrls.add(url);
  return true;
}

function enqueueDiscoveryHub(state, url) {
  const normalized = normalizeBbrUrl(url);
  if (!normalized || state.inFlight.has(normalized) || state.queuedUrls.has(normalized)) {
    return false;
  }
  if (state.visitedUrls.has(normalized)) {
    return false;
  }

  state.discoveryOnlyUrls.add(normalized);
  state.discoveredLinksPool.add(normalized);
  registerUrlInGraph(state, normalized);
  state.urlQueue.unshift(normalized);
  state.queuedUrls.add(normalized);
  return true;
}

function replenishRecrawlsForExhaustedDirectories(state) {
  let enqueued = 0;

  for (const dirKey of getIncompleteDirectories(state)) {
    const urls = state.urlsByDirectory.get(dirKey);
    if (!urls || urls.size === 0) {
      continue;
    }

    const hasFreshUrl = [...urls].some(
      (url) => !state.visitedUrls.has(url) && !state.queuedUrls.has(url) && !state.inFlight.has(url),
    );
    if (hasFreshUrl) {
      continue;
    }

    const pngNeeded = ARTIFACTS_PER_DIRECTORY - directoryPngCount(state, dirKey);
    const jsonNeeded = ARTIFACTS_PER_DIRECTORY - directoryJsonCount(state, dirKey);
    const needed = Math.max(pngNeeded, jsonNeeded);
    if (needed <= 0) {
      continue;
    }

    for (const url of urls) {
      if (enqueued >= needed) {
        break;
      }
      if (enqueueRecrawlUrl(state, url, true)) {
        enqueued++;
        logObs('DISCOVER', null, `Recrawl ${path.relative(SCREENSHOT_DIR, dirKey)}: ${url}`);
      }
    }
  }

  return enqueued;
}

function discoverLinksForIncompleteDirectories(state) {
  const incomplete = getIncompleteDirectories(state);
  if (incomplete.length === 0) {
    return 0;
  }

  let found = harvestLinksFromDisk(state, new Set(incomplete));
  found += replenishRecrawlsForExhaustedDirectories(state);

  if (getActionablePoolCandidates(state).length === 0 && state.urlQueue.length === 0) {
    for (const hubUrl of DISCOVERY_HUB_URLS) {
      if (enqueueDiscoveryHub(state, hubUrl)) {
        found++;
        logObs('DISCOVER', null, `Hub queued: ${hubUrl}`);
        break;
      }
    }
  }

  if (found > 0) {
    state.stats.discoveryRuns++;
    state.discoveryExhausted = false;
    logObs('DISCOVER', null, `+${found} URLs for ${incomplete.length} incomplete directories`);
  } else if (state.urlQueue.length === 0 && getActionablePoolCandidates(state).length === 0) {
    state.discoveryExhausted = true;
    logObs(
      'WARN',
      null,
      `Discovery exhausted — ${incomplete.length} directories still incomplete`,
    );
  }

  return found;
}

function shouldWorkersContinue(state) {
  if (state.inFlight.size > 0) {
    return true;
  }
  if (!isSmartStopComplete(state)) {
    return true;
  }
  if (getIncompleteDirectories(state).length === 0) {
    return false;
  }
  return !state.discoveryExhausted;
}

function maybeRunDiscovery(state, workerId) {
  if (workerId !== 1) {
    return;
  }
  if (getIncompleteDirectories(state).length === 0) {
    return;
  }
  if (Date.now() - state.lastDiscoveryAt < DISCOVERY_COOLDOWN_MS) {
    return;
  }
  state.lastDiscoveryAt = Date.now();
  discoverLinksForIncompleteDirectories(state);
}

function isSmartStopComplete(state) {
  if (state.inFlight.size > 0) {
    return false;
  }

  for (const url of state.urlQueue) {
    if (isUrlActionable(state, url)) {
      return false;
    }
    if (state.recrawlUrls.has(url) || state.discoveryOnlyUrls.has(url)) {
      return false;
    }
  }

  for (const link of state.discoveredLinksPool) {
    if (isUrlActionable(state, link)) {
      return false;
    }
  }

  return true;
}

function purgeCompletedFromQueue(state) {
  if (state.urlQueue.length === 0) {
    return 0;
  }

  const kept = [];
  let purged = 0;

  for (const url of state.urlQueue) {
    if (!urlNeedsCrawl(state, url) && !state.recrawlUrls.has(url) && !state.discoveryOnlyUrls.has(url)) {
      state.queuedUrls.delete(url);
      purged++;
      continue;
    }
    kept.push(url);
  }

  state.urlQueue.length = 0;
  state.urlQueue.push(...kept);
  return purged;
}

function enqueueUrl(state, url, prioritize) {
  if (!isUrlInScope(url)) {
    return false;
  }
  if (!urlNeedsCrawl(state, url)) {
    return false;
  }

  if (state.visitedUrls.has(url) || state.inFlight.has(url) || state.queuedUrls.has(url)) {
    return false;
  }

  registerUrlInGraph(state, url);

  if (prioritize) {
    state.urlQueue.unshift(url);
  } else {
    state.urlQueue.push(url);
  }
  state.queuedUrls.add(url);
  return true;
}

function dequeueActionableUrl(state, workerId) {
  let bestIdx = -1;
  let bestDepth = Number.POSITIVE_INFINITY;

  for (let i = 0; i < state.urlQueue.length; i++) {
    const url = state.urlQueue[i];
    if (!isUrlDequeueable(state, url)) {
      continue;
    }
    const depth = getUrlPriorityDepth(state, url);
    if (depth < bestDepth) {
      bestDepth = depth;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0) {
    const [url] = state.urlQueue.splice(bestIdx, 1);
    state.queuedUrls.delete(url);
    const dirKey = getDirectoryKey(url);
    const rel = dirKey ? path.relative(SCREENSHOT_DIR, dirKey) : '?';
    logObs('QUEUE', workerId, `Dequeue depth=${bestDepth} | left ${state.urlQueue.length} | ${rel}`);
    return url;
  }

  return null;
}

function classifyUrl(urlStr) {
  try {
    const normalized = normalizeBbrUrl(urlStr);
    if (!normalized) {
      return null;
    }
    const url = new URL(normalized);
    const pathStr = url.pathname;
    if (pathStr === '/' || pathStr === '') {
      return 'homepage';
    }

    if (pathStr.startsWith('/players/')) {
      const parts = pathStr.split('/').filter(Boolean);
      if (parts.length === 1) return 'players_index';
      if (parts.length === 3 && parts[2].endsWith('.html')) return 'player_profile';
      if (parts.length >= 4) {
        return `player_${parts[3]}`;
      }
    }

    if (pathStr.startsWith('/leagues/')) {
      const file = pathStr.split('/').pop() || '';
      if (file === '') return 'leagues_index';
      if (file.includes('leaders')) return 'leaders_season';
      if (file.includes('ratings')) return 'leagues_ratings';
      return 'season_summary';
    }

    if (pathStr.startsWith('/boxscores/')) {
      if (pathStr.includes('/shot-chart/')) return 'game_shot_chart';
      if (pathStr.includes('/pbp/')) return 'game_pbp';
      const file = pathStr.split('/').pop() || '';
      if (file === '' || file.includes('?')) return 'boxscores_index';
      return 'game_boxscore';
    }

    const firstSegment = pathStr.split('/').filter(Boolean)[0];
    if (firstSegment) {
      return firstSegment.replace(/\.html?$/, '').replace(/\.fcgi?$/, '');
    }

    return 'general';
  } catch (_e) {
    return null;
  }
}

function getMirroredArtifactPath(urlStr, rootDir, suffix) {
  const relativePath = getMirroredRelativePath(urlStr);
  if (!relativePath) {
    return null;
  }
  return path.join(rootDir, `${relativePath}${suffix}`);
}

function buildScrapeJsonRecord(url, category, crawlData) {
  return {
    url,
    category,
    scrapedAt: new Date().toISOString(),
    markdown: crawlData.markdown ?? null,
    links: crawlData.links || [],
    metadata: crawlData.metadata || null,
    screenshot: crawlData.screenshot ?? null,
  };
}

function saveJsonArtifact(url, category, crawlData, rootDir) {
  const jsonPath = getMirroredArtifactPath(url, rootDir, '.json');
  if (!jsonPath) {
    return null;
  }

  const dirPath = path.dirname(jsonPath);
  if (!fs.existsSync(jsonPath) && countFilesWithExtension(dirPath, '.json') >= ARTIFACTS_PER_DIRECTORY) {
    return null;
  }

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  fs.writeFileSync(
    jsonPath,
    `${JSON.stringify(buildScrapeJsonRecord(url, category, crawlData), null, 2)}\n`,
    'utf-8',
  );
  return jsonPath;
}

function saveJsonArtifacts(url, category, crawlData) {
  const saved = [];
  for (const rootDir of [SCREENSHOT_DIR, FIRECRAWL_DIR]) {
    const jsonPath = saveJsonArtifact(url, category, crawlData, rootDir);
    if (jsonPath) {
      saved.push(jsonPath);
    }
  }
  return saved;
}

function saveMarkdownCache(url, markdown) {
  if (!markdown || typeof markdown !== 'string') {
    return null;
  }

  const markdownPath = getMirroredArtifactPath(url, FIRECRAWL_DIR, '.md');
  if (!markdownPath) {
    return null;
  }

  const fileDir = path.dirname(markdownPath);
  if (!fs.existsSync(fileDir)) {
    fs.mkdirSync(fileDir, { recursive: true });
  }
  fs.writeFileSync(markdownPath, markdown, 'utf-8');
  return markdownPath;
}

function getMirroredPath(urlStr) {
  return getMirroredArtifactPath(urlStr, SCREENSHOT_DIR, '.png');
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: Status code ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      })
      .on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
}

async function scrapeViaFirecrawl(url) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      url: url,
      formats: ['markdown', 'links', { type: 'screenshot', fullPage: true }],
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
        'Content-Length': data.length,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Firecrawl API Error: status code ${res.statusCode} with message ${body}`));
          return;
        }
        try {
          const parsed = JSON.parse(body);
          if (parsed?.success && parsed.data) {
            resolve(parsed.data);
          } else {
            reject(new Error(`Invalid Firecrawl response payload: ${body}`));
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });
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

async function scrapeViaFirecrawlWithRetry(url, workerId) {
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
      logObs('WARN', workerId, `rate limited — waiting ${Math.round(waitMs / 1000)}s (${attempt}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastErr;
}

function bumpDirectoryCount(state, dirKey, kind) {
  const map = kind === 'png' ? state.directoryPngCounts : state.directoryJsonCounts;
  const onDisk =
    kind === 'png' ? countFilesWithExtension(dirKey, '.png') : countFilesWithExtension(dirKey, '.json');
  map.set(dirKey, Math.min(onDisk, ARTIFACTS_PER_DIRECTORY));
}

async function run() {
  const initialSeeds = loadInitialSeeds();

  const state = {
    visitedUrls: new Set(),
    queuedUrls: new Set(),
    inFlight: new Set(),
    discoveredLinksPool: new Set(initialSeeds),
    discoveredCategories: new Set(),
    discoveredDirectories: new Set(),
    urlsByCategory: new Map(),
    urlsByDirectory: new Map(),
    directoryPngCounts: new Map(),
    directoryJsonCounts: new Map(),
    urlDepths: new Map(),
    urlQueue: [],
    recrawlUrls: new Set(),
    discoveryOnlyUrls: new Set(),
    discoveryExhausted: false,
    lastDiscoveryAt: 0,
    workerStatus: new Map(),
    concurrencyLimit: Math.max(1, Math.min(CRAWL_CONCURRENCY, 2)),
    stats: {
      startedAt: Date.now(),
      lastStatusAt: Date.now(),
      crawledCount: 0,
      failedCount: 0,
      screenshotsSaved: 0,
      screenshotsReused: 0,
      jsonSaved: 0,
      markdownSaved: 0,
      purgedFromQueue: 0,
      skippedComplete: 0,
      newDirectoriesDiscovered: 0,
      poolRefills: 0,
      discoveryRuns: 0,
      harvestedLinks: 0,
      lastError: null,
    },
  };

  loadDepthIndex(state);
  bootstrapLinkGraphFromSeeds(state, initialSeeds);
  const existingPngs = bootstrapFromExistingScreenshots(state);
  const existingJson = bootstrapFromExistingJson(state);
  const completeAtStart = getIncompleteDirectories(state).length;

  console.log('[DEBUG] Starting per-directory Firecrawl crawler...');
  console.log('[DEBUG] Progress → .firecrawl/bbr-crawl-progress.json (bun run bbr:status)');
  publishCrawlProgress(state, { status: 'starting' });
  logObs('INFO', null, `Seeds: ${initialSeeds.length} URLs | ${state.discoveredDirectories.size} directories`);
  logObs(
    'INFO',
    null,
    `Resumed: ${existingPngs} PNGs, ${existingJson} JSON files | ${completeAtStart} directories still incomplete`,
  );

  const seedsSorted = [...initialSeeds].sort(
    (a, b) => getUrlPriorityDepth(state, a) - getUrlPriorityDepth(state, b),
  );

  let seedsQueued = 0;
  for (const seed of seedsSorted) {
    state.discoveredLinksPool.add(seed);
    if (enqueueUrl(state, seed, true)) {
      seedsQueued++;
    }
  }
  logObs('INFO', null, `Queued ${seedsQueued}/${initialSeeds.length} seeds (depth-ordered)`);

  const harvestedAtStart = discoverLinksForIncompleteDirectories(state);
  if (harvestedAtStart > 0) {
    logObs('INFO', null, `Pre-crawl discovery queued ${harvestedAtStart} URLs from cache`);
  }

  const MAX_CRAWL_BUDGET = process.env.BBR_CRAWL_BUDGET
    ? Number.parseInt(process.env.BBR_CRAWL_BUDGET, 10)
    : Number.POSITIVE_INFINITY;
  const CONCURRENCY_LIMIT = state.concurrencyLimit;

  const statusTimer = setInterval(() => {
    printStatusBoard(state);
  }, STATUS_INTERVAL_MS);

  const crawlWorker = async (workerId) => {
    setWorkerPhase(state, workerId, 'READY', 'initialized');
    logObs('INFO', workerId, 'Worker online');

    while (shouldWorkersContinue(state)) {
      maybeRunDiscovery(state, workerId);
      maybePrintStatusBoard(state);

      if (Number.isFinite(MAX_CRAWL_BUDGET) && state.stats.crawledCount >= MAX_CRAWL_BUDGET) {
        logObs('INFO', workerId, `Crawl budget reached (${MAX_CRAWL_BUDGET})`);
        break;
      }

      setWorkerPhase(state, workerId, 'IDLE', 'waiting for URL');
      const url = dequeueActionableUrl(state, workerId);

      if (!url) {
        maybeRunDiscovery(state, workerId);

        const candidates = getActionablePoolCandidates(state);
        if (candidates.length > 0) {
          candidates.sort((a, b) => getUrlPriorityDepth(state, a) - getUrlPriorityDepth(state, b));
          const jumpUrl = candidates[0];
          state.stats.poolRefills++;
          enqueueUrl(state, jumpUrl, true);
          continue;
        }

        setWorkerPhase(state, workerId, 'WAIT', 'no actionable URLs');
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }

      const normalizedUrl = normalizeBbrUrl(url);
      const isRecrawl = state.recrawlUrls.has(normalizedUrl);
      const isDiscoveryOnly = state.discoveryOnlyUrls.has(normalizedUrl);
      if (
        !normalizedUrl ||
        state.inFlight.has(normalizedUrl) ||
        (state.visitedUrls.has(normalizedUrl) && !isRecrawl)
      ) {
        continue;
      }

      const graph = registerUrlInGraph(state, normalizedUrl);
      if (!graph) {
        continue;
      }

      const { category, dirKey } = graph;
      const pngPath = getMirroredPath(normalizedUrl);
      const jsonPath = getMirroredArtifactPath(normalizedUrl, SCREENSHOT_DIR, '.json');
      const pngExists = pngPath && fs.existsSync(pngPath);
      const jsonExists = jsonPath && fs.existsSync(jsonPath);

      const needsPng = !isDiscoveryOnly && directoryNeedsPng(state, dirKey) && !pngExists;
      const needsJson = directoryNeedsJson(state, dirKey) && !jsonExists;
      const shouldScrape = isDiscoveryOnly || needsPng || needsJson;

      if (!shouldScrape) {
        state.recrawlUrls.delete(normalizedUrl);
        state.discoveryOnlyUrls.delete(normalizedUrl);
        continue;
      }

      state.inFlight.add(normalizedUrl);

      try {
        const progress = getDirectoryProgress(state);
        const crawlNum = state.stats.crawledCount + 1;
        const budgetLabel = Number.isFinite(MAX_CRAWL_BUDGET) ? `${crawlNum}/${MAX_CRAWL_BUDGET}` : `${crawlNum}`;
        const relDir = path.relative(SCREENSHOT_DIR, dirKey);
        const pngN = directoryPngCount(state, dirKey);
        const jsonN = directoryJsonCount(state, dirKey);

        setWorkerPhase(state, workerId, 'SCRAPE', `${relDir} | ${normalizedUrl}`);
        logObs('CRAWL', workerId, `#${budgetLabel} ${normalizedUrl}`);
        logObs(
          'META',
          workerId,
          `dir=${relDir} png=${pngN}/${ARTIFACTS_PER_DIRECTORY} json=${jsonN}/${ARTIFACTS_PER_DIRECTORY} | ` +
            `dirs ${progress.complete}/${progress.total} (${progress.pct}%) | q=${state.urlQueue.length}`,
        );

        const startTime = Date.now();
        const crawlData = await scrapeViaFirecrawlWithRetry(normalizedUrl, workerId);
        const elapsed = Date.now() - startTime;
        state.stats.crawledCount++;
        state.visitedUrls.add(normalizedUrl);

        logObs(
          'DONE',
          workerId,
          `Firecrawl ${elapsed}ms | links=${(crawlData.links || []).length} | md=${crawlData.markdown ? crawlData.markdown.length : 0} chars`,
        );

        if (crawlData.markdown) {
          const markdownPath = saveMarkdownCache(normalizedUrl, crawlData.markdown);
          if (markdownPath) {
            state.stats.markdownSaved++;
            logArtifactPath(workerId, 'MD', markdownPath);
          }
        }

        if (needsJson) {
          setWorkerPhase(state, workerId, 'SAVE', 'writing JSON');
          const jsonPaths = saveJsonArtifacts(normalizedUrl, category, crawlData);
          state.stats.jsonSaved += jsonPaths.length;
          for (const jsonPath of jsonPaths) {
            logArtifactPath(workerId, 'JSON', jsonPath);
          }
          bumpDirectoryCount(state, dirKey, 'json');
        }

        if (needsPng) {
          const screenshotUrl = crawlData.screenshot;
          if (pngPath && screenshotUrl) {
            setWorkerPhase(state, workerId, 'SAVE', 'downloading PNG');
            const fileDir = path.dirname(pngPath);
            if (!fs.existsSync(fileDir)) {
              fs.mkdirSync(fileDir, { recursive: true });
            }
            await downloadFile(screenshotUrl, pngPath);
            state.stats.screenshotsSaved++;
            logArtifactPath(workerId, 'PNG', pngPath);
            bumpDirectoryCount(state, dirKey, 'png');
            logObs(
              'OK',
              workerId,
              `PNG ${directoryPngCount(state, dirKey)}/${ARTIFACTS_PER_DIRECTORY} in ${relDir}`,
            );
          } else if (!screenshotUrl) {
            logObs('WARN', workerId, `No screenshot URL for ${relDir}`);
          }
        } else if (pngExists && directoryNeedsPng(state, dirKey)) {
          bumpDirectoryCount(state, dirKey, 'png');
          state.stats.screenshotsReused++;
        }

        if (!directoryNeedsWork(state, dirKey)) {
          const purged = purgeCompletedFromQueue(state);
          state.stats.purgedFromQueue += purged;
        }

        for (const link of crawlData.links || []) {
          const normalizedLink = normalizeBbrUrl(link);
          if (!normalizedLink) {
            continue;
          }

          const beforeDirs = state.discoveredDirectories.size;
          state.discoveredLinksPool.add(normalizedLink);
          registerUrlInGraph(state, normalizedLink);
          if (state.discoveredDirectories.size > beforeDirs) {
            state.stats.newDirectoriesDiscovered++;
          }

          if (!fs.existsSync(DISCOVERED_APPEND_PATH)) {
            fs.writeFileSync(DISCOVERED_APPEND_PATH, '', 'utf-8');
          }
          appendDiscoveredUrl(normalizedLink);

          const linkDir = getDirectoryKey(normalizedLink);
          enqueueUrl(state, normalizedLink, linkDir ? directoryNeedsWork(state, linkDir) : false);
        }

        maybePrintStatusBoard(state);
      } catch (err) {
        state.stats.failedCount++;
        state.stats.lastError = err instanceof Error ? err.message : String(err);
        logObs('ERROR', workerId, state.stats.lastError);
      } finally {
        state.inFlight.delete(normalizedUrl);
        state.recrawlUrls.delete(normalizedUrl);
        state.discoveryOnlyUrls.delete(normalizedUrl);
        setWorkerPhase(state, workerId, 'IDLE', 'crawl finished');
      }
    }

    setWorkerPhase(state, workerId, 'STOP', 'worker exiting');
    logObs('INFO', workerId, 'Worker done');
  };

  logObs('INFO', null, `Spawning ${CONCURRENCY_LIMIT} workers | status every ${STATUS_INTERVAL_MS / 1000}s`);
  printStatusBoard(state);
  const activeWorkers = [];
  for (let i = 1; i <= CONCURRENCY_LIMIT; i++) {
    activeWorkers.push(crawlWorker(i));
  }

  await Promise.all(activeWorkers);
  clearInterval(statusTimer);

  printStatusBoard(state);

  console.log('\n============================================================');
  console.log('Per-directory crawl completed');
  const budgetLabel = Number.isFinite(MAX_CRAWL_BUDGET)
    ? `${state.stats.crawledCount}/${MAX_CRAWL_BUDGET}`
    : `${state.stats.crawledCount}`;
  const elapsedSec = (Date.now() - state.stats.startedAt) / 1000;
  console.log(`Runtime: ${formatDuration(elapsedSec)} | URLs crawled: ${budgetLabel}`);
  console.log(
    `Artifacts: PNG +${state.stats.screenshotsSaved} (reused ${state.stats.screenshotsReused}) | JSON +${state.stats.jsonSaved} | MD +${state.stats.markdownSaved}`,
  );

  const incomplete = getIncompleteDirectories(state);
  if (incomplete.length > 0) {
    console.log(`Incomplete directories (${incomplete.length}):`);
    for (const dirKey of incomplete.slice(0, 40)) {
      const rel = path.relative(SCREENSHOT_DIR, dirKey);
      console.log(
        ` - ${rel}: png ${directoryPngCount(state, dirKey)}/${ARTIFACTS_PER_DIRECTORY}, json ${directoryJsonCount(state, dirKey)}/${ARTIFACTS_PER_DIRECTORY}`,
      );
    }
  }
  console.log('============================================================\n');

  publishCrawlProgress(state, { status: 'finished' });

  if (state.stats.crawledCount === 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('[ERROR] Crawler failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
