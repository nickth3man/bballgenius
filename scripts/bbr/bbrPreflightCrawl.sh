#!/usr/bin/env bash
# Wipes bbr-screenshots and verifies Firecrawl auth before crawl.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SHOTS="${ROOT}/bbr-screenshots"

cd "$ROOT"

echo "[bbr:crawl] wiping ${SHOTS}..."
rm -rf "${SHOTS}"
mkdir -p "${SHOTS}"

MAP="${ROOT}/.firecrawl/bbr-map-full.txt"
if [[ ! -f "${MAP}" ]]; then
  echo "[bbr:crawl] ERROR: missing ${MAP} — run: bun run bbr:map" >&2
  exit 1
fi

if ! firecrawl --status >/dev/null 2>&1; then
  echo "[bbr:crawl] ERROR: firecrawl CLI not ready" >&2
  exit 1
fi

if [[ -z "${FIRECRAWL_API_KEY:-}" ]]; then
  echo "[bbr:crawl] ERROR: FIRECRAWL_API_KEY is required" >&2
  exit 1
fi

echo "[bbr:crawl] preflight OK ($(wc -l < "${MAP}") map URLs)"
