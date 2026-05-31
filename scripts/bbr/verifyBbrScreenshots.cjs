const fs = require('fs');
const path = require('path');
const {
  BBR_SECTIONS,
  BBR_SCOPE_SECTIONS,
  countPlayerGamelogs,
  countPlayerProfiles,
  normalizeBbrUrl,
  sectionHistogram,
  sectionRootUrl,
} = require('./bbrUrlUtils.cjs');

const ROOT = path.join(__dirname, '..');
const SCREENSHOT_DIR = path.join(ROOT, 'bbr-screenshots');
const FIRECRAWL_DIR = path.join(ROOT, '.firecrawl');
const MAP_PATH = path.join(FIRECRAWL_DIR, 'bbr-map-full.txt');
const DEPTH_PATH = path.join(FIRECRAWL_DIR, 'bbr-depth-index.json');
const REQUIRED_JSON_KEYS = ['url', 'markdown', 'links', 'scrapedAt'];
const ARTIFACTS_PER_DIR = 2;

const mapOnly = process.argv.includes('--map-only');

function verifyMap() {
  let failed = false;

  if (!fs.existsSync(MAP_PATH)) {
    console.error(`[verify:map] missing ${MAP_PATH}`);
    return false;
  }

  const lines = fs.readFileSync(MAP_PATH, 'utf-8').split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    console.error('[verify:map] bbr-map-full.txt is empty');
    failed = true;
  } else {
    console.log(`[verify:map] ${lines.length} URLs in map`);
    const histogram = sectionHistogram(lines);
    console.log(`[verify:map] section histogram: ${JSON.stringify(histogram)}`);

    if (BBR_SCOPE_SECTIONS.includes('players')) {
      const profiles = countPlayerProfiles(lines);
      const gamelogs = countPlayerGamelogs(lines);
      const minProfiles = Number.parseInt(process.env.BBR_MIN_PLAYER_PROFILES || '10', 10);
      console.log(
        `[verify:map] player profiles=${profiles} gamelogs=${gamelogs} (min profiles=${minProfiles})`,
      );
      if (profiles < minProfiles) {
        console.error(
          `[verify:map] only ${profiles} player profile URLs (need >= ${minProfiles}); ` +
            'generic map --search "players" under-discovers profiles — rerun bbr:map with Pass C gamelog/index searches',
        );
        failed = true;
      }
    }
  }

  const urlSet = new Set(lines.map((l) => normalizeBbrUrl(l)).filter(Boolean));
  for (const section of BBR_SECTIONS) {
    const root = sectionRootUrl(section);
    if (root && !urlSet.has(root)) {
      console.error(`[verify:map] missing L1 root: ${section} (${root})`);
      failed = true;
    }
  }

  if (!fs.existsSync(DEPTH_PATH)) {
    console.error(`[verify:map] missing ${DEPTH_PATH}`);
    return false;
  }

  const depthIndex = JSON.parse(fs.readFileSync(DEPTH_PATH, 'utf-8'));
  const byDepth = depthIndex.byDepth || {};
  const totalUrls = depthIndex.totalUrls || lines.length;
  const deepCount = [4, 5, 6].reduce((sum, depth) => sum + (byDepth[String(depth)] || 0), 0);
  if (deepCount === 0) {
    console.error('[verify:map] no URLs at depth 4–6');
    failed = true;
  }
  if (totalUrls >= 500) {
    for (const depth of [4, 5]) {
      if ((byDepth[String(depth)] || 0) === 0) {
        console.error(`[verify:map] large map missing depth ${depth}`);
        failed = true;
      }
    }
  }

  if (!failed) {
    console.log(`[verify:map] depth histogram: ${JSON.stringify(byDepth)}`);
  }
  return !failed;
}

function verifyScreenshots() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    console.error(`[verify] missing ${SCREENSHOT_DIR}`);
    return false;
  }

  let failed = false;
  const incomplete = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
    }
    const pngCount = fs.readdirSync(dir).filter((n) => n.endsWith('.png')).length;
    const jsonCount = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).length;
    if (pngCount > 0 || jsonCount > 0) {
      if (pngCount < ARTIFACTS_PER_DIR || jsonCount < ARTIFACTS_PER_DIR) {
        incomplete.push({
          dir: path.relative(SCREENSHOT_DIR, dir),
          pngCount,
          jsonCount,
        });
      }
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.json')) {
          continue;
        }
        try {
          const record = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'));
          for (const key of REQUIRED_JSON_KEYS) {
            if (!(key in record)) {
              console.error(`[verify] ${path.join(dir, name)} missing key: ${key}`);
              failed = true;
            }
          }
        } catch (err) {
          console.error(`[verify] invalid JSON: ${path.join(dir, name)}`, err);
          failed = true;
        }
      }
    }
  }

  walk(SCREENSHOT_DIR);

  if (incomplete.length > 0) {
    failed = true;
    console.error(`[verify] ${incomplete.length} directories below ${ARTIFACTS_PER_DIR}/${ARTIFACTS_PER_DIR}:`);
    for (const row of incomplete.slice(0, 30)) {
      console.error(`  ${row.dir}: png=${row.pngCount} json=${row.jsonCount}`);
    }
    if (incomplete.length > 30) {
      console.error(`  … +${incomplete.length - 30} more`);
    }
  } else {
    console.log('[verify] all artifact directories meet 2 PNG + 2 JSON');
  }

  return !failed;
}

const mapOk = verifyMap();
if (mapOnly) {
  process.exit(mapOk ? 0 : 1);
}

const shotsOk = verifyScreenshots();
process.exit(mapOk && shotsOk ? 0 : 1);
