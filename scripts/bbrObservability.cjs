/**
 * Shared progress + status for BBR map/crawl pipelines.
 * Writes JSON snapshots agents and humans can read without tailing huge logs.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizeBbrUrl } = require('./bbrUrlUtils.cjs');

const ROOT = path.join(__dirname, '..');
const FIRECRAWL_DIR = path.join(ROOT, '.firecrawl');
const SCRATCHPAD = path.join(FIRECRAWL_DIR, 'scratchpad');
const MAP_PROGRESS = path.join(FIRECRAWL_DIR, 'bbr-map-progress.json');
const CRAWL_PROGRESS = path.join(FIRECRAWL_DIR, 'bbr-crawl-progress.json');
const MAP_HEARTBEAT = path.join(FIRECRAWL_DIR, 'bbr-map-heartbeat.txt');
const OBSERVE_CYCLES_LOG = path.join(FIRECRAWL_DIR, 'bbr-map-observe-cycles.jsonl');
const MAP_RUN_LOG = process.env.BBR_MAP_RUN_LOG
  ? path.resolve(process.env.BBR_MAP_RUN_LOG)
  : path.join(SCRATCHPAD, 'bbr-map-run.log');
const BBR_URL_RE = /https?:\/\/(?:www\.)?basketball-reference\.com[^\s)\]"'<>]*/gi;

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

function extractUrlsFromText(text) {
  const urls = new Set();
  for (const match of text.match(BBR_URL_RE) || []) {
    const n = normalizeBbrUrl(match.replace(/[.,;]+$/, ''));
    if (n) {
      urls.add(n);
    }
  }
  return urls;
}

function extractUrlsFromJson(raw) {
  const urls = new Set();
  try {
    const parsed = JSON.parse(raw);
    const pool = [];
    if (Array.isArray(parsed)) {
      pool.push(...parsed);
    }
    if (Array.isArray(parsed?.links)) {
      pool.push(...parsed.links);
    }
    if (Array.isArray(parsed?.urls)) {
      pool.push(...parsed.urls);
    }
    const data = parsed?.data;
    if (data && typeof data === 'object') {
      if (Array.isArray(data.links)) {
        pool.push(...data.links);
      }
      if (Array.isArray(data.urls)) {
        pool.push(...data.urls);
      }
    }
    for (const item of pool) {
      if (typeof item === 'string') {
        const n = normalizeBbrUrl(item);
        if (n) {
          urls.add(n);
        }
      } else if (item?.url) {
        const n = normalizeBbrUrl(String(item.url));
        if (n) {
          urls.add(n);
        }
      }
    }
  } catch {
    for (const u of extractUrlsFromText(raw)) {
      urls.add(u);
    }
  }
  return urls;
}

function countScratchpadUrls() {
  if (!fs.existsSync(SCRATCHPAD)) {
    return { fileCount: 0, uniqueUrls: 0 };
  }
  const urls = new Set();
  let fileCount = 0;
  for (const name of fs.readdirSync(SCRATCHPAD)) {
    if (!name.startsWith('map-')) {
      continue;
    }
    fileCount++;
    const full = path.join(SCRATCHPAD, name);
    const raw = fs.readFileSync(full, 'utf-8');
    const extracted = name.endsWith('.json') ? extractUrlsFromJson(raw) : extractUrlsFromText(raw);
    for (const u of extracted) {
      urls.add(u);
    }
  }
  return { fileCount, uniqueUrls: urls.size };
}

function tailLogLines(maxLines = 8) {
  if (!fs.existsSync(MAP_RUN_LOG)) {
    return [];
  }
  return fs
    .readFileSync(MAP_RUN_LOG, 'utf-8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(-maxLines);
}

function computeMapMetrics(prev) {
  const startedMs = new Date(prev.startedAt).getTime();
  const elapsedSec = Math.max(1, (Date.now() - startedMs) / 1000);
  const stepIndex = prev.stepIndex || 0;
  const totalSteps = prev.totalSteps || 0;
  const stepsPerMinute = stepIndex > 0 ? (stepIndex / elapsedSec) * 60 : 0;
  const remaining = Math.max(0, totalSteps - stepIndex);
  const etaSeconds =
    stepsPerMinute > 0 && remaining > 0 ? Math.round((remaining / stepsPerMinute) * 60) : null;
  return { elapsedSec, stepsPerMinute, etaSeconds, remaining };
}

function writeHeartbeat(map) {
  const metrics = computeMapMetrics(map);
  const activity = map.activity || 'idle';
  const line = [
    map.runId?.slice(0, 8) || '—',
    `cycle=${map.observeCycle ?? '—'}`,
    `pass=${map.pass ?? '—'}`,
    `step=${map.stepIndex ?? 0}/${map.totalSteps ?? 0}`,
    `activity=${activity}`,
    `urls≈${map.scratchpad?.uniqueUrls ?? 0}`,
    map.rateLimitUntil ? `wait→${map.rateLimitUntil}` : null,
    metrics.etaSeconds != null ? `eta≈${formatDuration(metrics.etaSeconds)}` : null,
    map.updatedAt,
  ]
    .filter(Boolean)
    .join(' | ');
  fs.writeFileSync(MAP_HEARTBEAT, `${line}\n`, 'utf-8');
}

function initMapProgress() {
  const now = new Date().toISOString();
  const observeCycle = Number.parseInt(process.env.BBR_OBSERVE_CYCLE || '0', 10) || null;
  return {
    phase: 'map',
    runId: crypto.randomUUID(),
    observeCycle,
    startedAt: now,
    updatedAt: now,
    heartbeatAt: now,
    pass: null,
    step: null,
    stepIndex: 0,
    totalSteps: 0,
    okSteps: 0,
    failedSteps: 0,
    rateLimitWaits: 0,
    activity: 'starting',
    rateLimitUntil: null,
    scratchpad: { fileCount: 0, uniqueUrls: 0 },
    passTimings: {},
    lastLogLines: [],
    lastEvent: null,
    events: [],
  };
}

function patchMapProgress(patch) {
  const prev = readJson(MAP_PROGRESS) || initMapProgress();
  const scratchpad = countScratchpadUrls();
  const event = patch.event || null;
  const events = prev.events || [];
  if (event) {
    events.push({ ...event, at: new Date().toISOString() });
    if (events.length > 40) {
      events.splice(0, events.length - 40);
    }
  }
  const now = new Date().toISOString();
  const next = {
    ...prev,
    ...patch,
    updatedAt: now,
    heartbeatAt: now,
    scratchpad,
    events,
    lastEvent: event || prev.lastEvent,
    lastLogLines: tailLogLines(8),
  };
  delete next.event;
  const metrics = computeMapMetrics(next);
  next.metrics = {
    elapsedSec: Math.round(metrics.elapsedSec),
    stepsPerMinute: Math.round(metrics.stepsPerMinute * 10) / 10,
    etaSeconds: metrics.etaSeconds,
    remainingSteps: metrics.remaining,
  };
  writeJson(MAP_PROGRESS, next);
  writeHeartbeat(next);
  return next;
}

function writeCrawlProgress(snapshot) {
  const prev = readJson(CRAWL_PROGRESS) || { phase: 'crawl', startedAt: new Date().toISOString() };
  writeJson(CRAWL_PROGRESS, {
    ...prev,
    ...snapshot,
    updatedAt: new Date().toISOString(),
  });
}

function formatDuration(seconds) {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) {
    return `${h}h ${m % 60}m ${s % 60}s`;
  }
  if (m > 0) {
    return `${m}m ${s % 60}s`;
  }
  return `${s}s`;
}

function printStatus() {
  const map = readJson(MAP_PROGRESS);
  const crawl = readJson(CRAWL_PROGRESS);
  const mapFull = path.join(FIRECRAWL_DIR, 'bbr-map-full.txt');
  const depth = path.join(FIRECRAWL_DIR, 'bbr-depth-index.json');

  console.log('\n=== BBR pipeline status ===\n');

  if (fs.existsSync(MAP_HEARTBEAT)) {
    console.log(`[heartbeat] ${fs.readFileSync(MAP_HEARTBEAT, 'utf-8').trim()}`);
  }

  if (map) {
    const elapsed = (Date.now() - new Date(map.startedAt).getTime()) / 1000;
    console.log('[map]');
    console.log(
      `  run:         ${map.runId ?? '—'}${map.observeCycle ? ` (observe cycle ${map.observeCycle})` : ''}${map.mapPid ? ` pid=${map.mapPid}` : ''}`,
    );
    console.log(`  pass:        ${map.pass ?? '—'} (step ${map.stepIndex}/${map.totalSteps})`);
    console.log(`  step:        ${map.step ?? '—'}`);
    console.log(`  activity:    ${map.activity ?? '—'}`);
    if (map.rateLimitUntil) {
      const waitLeft = Math.max(0, (new Date(map.rateLimitUntil).getTime() - Date.now()) / 1000);
      console.log(`  rate limit:  until ${map.rateLimitUntil} (${formatDuration(waitLeft)} left)`);
    }
    console.log(`  ok / fail:   ${map.okSteps ?? 0} / ${map.failedSteps ?? 0}`);
    console.log(`  rate waits:  ${map.rateLimitWaits ?? 0}`);
    console.log(`  scratchpad:  ${map.scratchpad?.fileCount ?? 0} files, ~${map.scratchpad?.uniqueUrls ?? 0} unique URLs`);
    console.log(`  elapsed:     ${formatDuration(elapsed)}`);
    if (map.metrics?.stepsPerMinute) {
      console.log(
        `  pace / eta:  ${map.metrics.stepsPerMinute} steps/min → ~${map.metrics.etaSeconds != null ? formatDuration(map.metrics.etaSeconds) : '—'}`,
      );
    }
    if (map.passTimings && Object.keys(map.passTimings).length) {
      console.log(`  pass times:  ${JSON.stringify(map.passTimings)}`);
    }
    if (map.lastEvent) {
      console.log(`  last event:  ${map.lastEvent.status} — ${map.lastEvent.label}`);
    }
    if (map.lastLogLines?.length) {
      console.log('  log tail:');
      for (const line of map.lastLogLines.slice(-4)) {
        console.log(`    | ${line}`);
      }
    }
  } else {
    console.log('[map] no progress file (not started)');
  }

  if (fs.existsSync(mapFull)) {
    const lines = fs.readFileSync(mapFull, 'utf-8').split(/\r?\n/).filter(Boolean).length;
    console.log(`[map] bbr-map-full.txt: ${lines} URLs`);
  }
  if (fs.existsSync(depth)) {
    const idx = readJson(depth);
    if (idx?.byDepth) {
      console.log(`[map] depth index: ${JSON.stringify(idx.byDepth)}`);
    }
  }

  if (crawl) {
    const elapsed = (Date.now() - new Date(crawl.startedAt).getTime()) / 1000;
    console.log('\n[crawl]');
    console.log(`  crawled:     ${crawl.crawledCount ?? 0}${crawl.budget ? ` / ${crawl.budget}` : ''}`);
    console.log(`  failed:      ${crawl.failedCount ?? 0}`);
    console.log(`  directories: ${crawl.directoriesComplete ?? 0}/${crawl.directoriesTotal ?? 0} complete`);
    console.log(`  artifacts:   png +${crawl.screenshotsSaved ?? 0} | json +${crawl.jsonSaved ?? 0}`);
    console.log(`  queue:       ${crawl.queueLength ?? 0} | in-flight ${crawl.inFlight ?? 0}`);
    console.log(`  elapsed:     ${formatDuration(elapsed)}`);
    if (crawl.lastError) {
      console.log(`  last error:  ${crawl.lastError}`);
    }
    if (crawl.incompletePreview?.length) {
      console.log(`  incomplete:  ${crawl.incompletePreview.join(', ')}`);
    }
  } else {
    console.log('\n[crawl] no progress file');
  }

  if (fs.existsSync(OBSERVE_CYCLES_LOG)) {
    const lines = fs.readFileSync(OBSERVE_CYCLES_LOG, 'utf-8').trim().split(/\r?\n/).filter(Boolean);
    console.log(`\n[observe] ${lines.length} cycle snapshot(s) in bbr-map-observe-cycles.jsonl`);
    if (lines.length) {
      try {
        const last = JSON.parse(lines[lines.length - 1]);
        console.log(`  last: cycle ${last.cycle} @ ${last.at} — step ${last.stepIndex}/${last.totalSteps} activity=${last.activity}`);
      } catch {
        /* ignore */
      }
    }
  }

  const logPath = MAP_RUN_LOG;
  if (fs.existsSync(logPath)) {
    const stat = fs.statSync(logPath);
    console.log(`\n[log] ${path.relative(ROOT, logPath)} (${stat.size} bytes, mtime ${stat.mtime.toISOString()})`);
  }

  console.log('');
}

function analyseMapSnapshot(map, cycle) {
  const gaps = [];
  if (!map) {
    gaps.push('no progress JSON — map-init not called or wrong cwd');
    return gaps;
  }
  const staleSec = (Date.now() - new Date(map.heartbeatAt || map.updatedAt).getTime()) / 1000;
  if (staleSec > 20) {
    gaps.push(`heartbeat stale ${Math.round(staleSec)}s — process may be dead or not patching progress`);
  }
  if (map.activity === 'rate_limit_wait' && !map.rateLimitUntil) {
    gaps.push('rate limit without rateLimitUntil — cannot show wait countdown');
  }
  if ((map.stepIndex || 0) === 0 && staleSec > 10) {
    gaps.push('no steps completed after 10s+ — check firecrawl auth or preflight');
  }
  if (!map.runId) {
    gaps.push('missing runId — cannot correlate cancel/rerun');
  }
  if (!map.metrics?.stepsPerMinute && (map.stepIndex || 0) > 0) {
    gaps.push('missing pace/ETA metrics');
  }
  if (!map.lastLogLines?.length) {
    gaps.push('no log tail in progress — hard to debug without reading full log');
  }
  console.log(`\n=== Observe cycle ${cycle} analysis (Gemba) ===\n`);
  if (gaps.length === 0) {
    console.log('  No obvious observability gaps in this 15s window.');
  } else {
    for (const g of gaps) {
      console.log(`  • ${g}`);
    }
  }
  console.log('');
  return gaps;
}

function patchMapPid(pid) {
  if (!pid) {
    return;
  }
  patchMapProgress({ mapPid: pid });
}

function appendObserveCycle(cycle) {
  const map = readJson(MAP_PROGRESS);
  const row = {
    cycle,
    at: new Date().toISOString(),
    runId: map?.runId ?? null,
    mapPid: map?.mapPid ?? null,
    pass: map?.pass ?? null,
    step: map?.step ?? null,
    stepIndex: map?.stepIndex ?? 0,
    totalSteps: map?.totalSteps ?? 0,
    activity: map?.activity ?? null,
    rateLimitUntil: map?.rateLimitUntil ?? null,
    scratchpadUrls: map?.scratchpad?.uniqueUrls ?? 0,
    metrics: map?.metrics ?? null,
    heartbeat: fs.existsSync(MAP_HEARTBEAT) ? fs.readFileSync(MAP_HEARTBEAT, 'utf-8').trim() : null,
    logTail: tailLogLines(3),
  };
  fs.mkdirSync(FIRECRAWL_DIR, { recursive: true });
  fs.appendFileSync(OBSERVE_CYCLES_LOG, `${JSON.stringify(row)}\n`, 'utf-8');
  analyseMapSnapshot(map, cycle);
  return row;
}

function cancelMapProcesses() {
  const { execSync } = require('child_process');
  const patterns = ['buildBbrUrlMap.sh', 'firecrawl map'];
  let killed = 0;
  for (const pat of patterns) {
    try {
      if (process.platform === 'win32') {
        const out = execSync(`tasklist 2>nul`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
        if (!out) {
          continue;
        }
      }
      execSync(`pkill -f "${pat}" 2>/dev/null || true`, { stdio: 'ignore', shell: true });
      killed++;
    } catch {
      /* ignore */
    }
  }
  patchMapProgress({ activity: 'cancelled', step: 'cancelled by operator' });
  console.log(`[bbr:map] cancel sent (${patterns.join(', ')})`);
  return killed;
}

function main() {
  const cmd = process.argv[2];
  if (cmd === 'status') {
    printStatus();
    return;
  }
  if (cmd === 'map-init') {
    writeJson(MAP_PROGRESS, initMapProgress());
    return;
  }
  if (cmd === 'map-event') {
    const pass = process.argv.find((a) => a.startsWith('--pass='))?.slice(7) || null;
    const label = process.argv.find((a) => a.startsWith('--label='))?.slice(8) || 'step';
    const ok = process.argv.includes('--ok');
    const failed = process.argv.includes('--fail');
    const rateLimit = process.argv.includes('--rate-limit');
    const durationMs = Number.parseInt(
      process.argv.find((a) => a.startsWith('--ms='))?.slice(5) || '0',
      10,
    );
    const prev = readJson(MAP_PROGRESS) || initMapProgress();
    const stepIndex = (prev.stepIndex || 0) + 1;
    const totalSteps = Number.parseInt(
      process.argv.find((a) => a.startsWith('--total='))?.slice(8) || String(prev.totalSteps || 0),
      10,
    );
    patchMapProgress({
      pass,
      step: label,
      stepIndex,
      totalSteps: totalSteps || prev.totalSteps,
      okSteps: (prev.okSteps || 0) + (ok ? 1 : 0),
      failedSteps: (prev.failedSteps || 0) + (failed ? 1 : 0),
      rateLimitWaits: (prev.rateLimitWaits || 0) + (rateLimit ? 1 : 0),
      activity: rateLimit ? 'rate_limit_wait' : failed ? 'failed' : 'firecrawl_map',
      rateLimitUntil: rateLimit ? prev.rateLimitUntil : null,
      event: { pass, label, status: failed ? 'fail' : ok ? 'ok' : 'skip', durationMs },
    });
    const pct = totalSteps > 0 ? Math.round((stepIndex / totalSteps) * 100) : 0;
    const scratch = countScratchpadUrls();
    console.log(
      `[bbr:map] [${stepIndex}/${totalSteps} ${pct}%] ${pass} — ${label} → ${failed ? 'FAIL' : 'ok'} (~${scratch.uniqueUrls} URLs in scratchpad)`,
    );
    return;
  }
  if (cmd === 'map-pass') {
    const pass = process.argv.find((a) => a.startsWith('--pass='))?.slice(7) || null;
    const total = process.argv.find((a) => a.startsWith('--total='))?.slice(8);
    const prev = readJson(MAP_PROGRESS) || initMapProgress();
    const passTimings = { ...(prev.passTimings || {}) };
    if (prev.pass && passTimings[prev.pass]?.startedAt && !passTimings[prev.pass].endedAt) {
      passTimings[prev.pass] = {
        ...passTimings[prev.pass],
        endedAt: new Date().toISOString(),
        steps: prev.stepIndex,
      };
    }
    if (pass) {
      passTimings[pass] = { startedAt: new Date().toISOString(), steps: 0 };
    }
    patchMapProgress({
      pass,
      step: null,
      activity: pass ? `pass_${pass}` : 'map',
      rateLimitUntil: null,
      totalSteps: total ? Number.parseInt(total, 10) : undefined,
      passTimings,
    });
    console.log(`[bbr:map] === ${pass} ===`);
    return;
  }
  if (cmd === 'map-activity') {
    const activity = process.argv.find((a) => a.startsWith('--activity='))?.slice(11) || 'idle';
    const untilSec = Number.parseInt(
      process.argv.find((a) => a.startsWith('--until-sec='))?.slice(12) || '0',
      10,
    );
    const rateLimitUntil =
      untilSec > 0 ? new Date(Date.now() + untilSec * 1000).toISOString() : null;
    patchMapProgress({ activity, rateLimitUntil, step: activity });
    return;
  }
  if (cmd === 'map-done') {
    patchMapProgress({ pass: 'done', step: 'merge complete', activity: 'done', rateLimitUntil: null });
    return;
  }
  if (cmd === 'map-cancel') {
    cancelMapProcesses();
    return;
  }
  if (cmd === 'map-snapshot') {
    const cycle = Number.parseInt(
      process.argv.find((a) => a.startsWith('--cycle='))?.slice(8) || '0',
      10,
    );
    appendObserveCycle(cycle || 1);
    return;
  }
  if (cmd === 'watch') {
    const intervalMs = Number.parseInt(
      process.argv.find((a) => a.startsWith('--ms='))?.slice(5) || '3000',
      10,
    );
    const stop = () => process.exit(0);
    process.on('SIGINT', stop);
    const tick = () => {
      console.clear();
      printStatus();
    };
    tick();
    setInterval(tick, intervalMs);
    return;
  }
  console.error(
    'Usage: node scripts/bbrObservability.cjs status|watch|map-init|map-pass|map-event|map-activity|map-done|map-cancel|map-snapshot',
  );
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  MAP_PROGRESS,
  CRAWL_PROGRESS,
  MAP_HEARTBEAT,
  countScratchpadUrls,
  patchMapProgress,
  writeCrawlProgress,
  printStatus,
  cancelMapProcesses,
  appendObserveCycle,
  patchMapPid,
};
