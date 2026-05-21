#!/usr/bin/env bash
# Waits for bbr-map-full.txt then runs bbr:crawl (do not run while map is active).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAP="${ROOT}/.firecrawl/bbr-map-full.txt"
PROGRESS="${ROOT}/.firecrawl/bbr-map-progress.json"
LOG="${ROOT}/.firecrawl/scratchpad/bbr-crawl-run.log"

cd "$ROOT"

map_still_running() {
  node -e "
const fs = require('fs');
const mapPath = process.argv[1];
const progressPath = process.argv[2];
if (fs.existsSync(mapPath)) process.exit(1);
if (!fs.existsSync(progressPath)) process.exit(1);
const j = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
if (j.pass === 'done') process.exit(1);
const t = new Date(j.heartbeatAt || j.updatedAt || 0).getTime();
if (!t || Date.now() - t > 180000) process.exit(1);
process.exit(0);
" "${MAP}" "${PROGRESS}"
}

echo "[bbr:chain] waiting for ${MAP}..."
while [[ ! -f "${MAP}" ]]; do
  if map_still_running; then
    sleep 20
    continue
  fi
  if [[ -f "${PROGRESS}" ]] && node -e "
    const j = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
    process.exit(j.pass === 'done' ? 0 : 1);
  " "${PROGRESS}"; then
    echo "[bbr:chain] merge finishing..."
    sleep 10
    [[ -f "${MAP}" ]] && break
  fi
  echo "[bbr:chain] ERROR: map stopped before creating bbr-map-full.txt — check .firecrawl/scratchpad/bbr-map-run.log" >&2
  exit 1
done

lines=$(wc -l < "${MAP}")
echo "[bbr:chain] map ready (${lines} URLs) — starting crawl..."

if [[ -z "${FIRECRAWL_API_KEY:-}" ]]; then
  cred="${APPDATA:-${HOME}/.config}/firecrawl-cli/credentials.json"
  if [[ -f "${cred}" ]]; then
    export FIRECRAWL_API_KEY="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).apiKey)" "${cred}")"
  fi
fi

if [[ -z "${FIRECRAWL_API_KEY:-}" ]]; then
  echo "[bbr:chain] ERROR: set FIRECRAWL_API_KEY or run: firecrawl login --browser" >&2
  exit 1
fi

export BBR_CRAWL_CONCURRENCY="${BBR_CRAWL_CONCURRENCY:-2}"
bash scripts/bbrPreflightCrawl.sh
exec node scripts/takeBbrScreenshots.cjs 2>&1 | tee "${LOG}"
