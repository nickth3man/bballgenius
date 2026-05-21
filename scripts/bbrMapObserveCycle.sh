#!/usr/bin/env bash
# Kaizen observe loop: cancel → background map → wait 15s → snapshot + analyse.
# Usage: bash scripts/bbrMapObserveCycle.sh [cycles]   (default 5)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CYCLES="${1:-5}"
WAIT_SEC="${BBR_OBSERVE_WAIT_SEC:-15}"
DELAY="${BBR_MAP_DELAY_SEC:-6}"
LOG_DIR="${ROOT}/.firecrawl/scratchpad"

cd "$ROOT"
mkdir -p .firecrawl/scratchpad

echo "[bbr:observe] ${CYCLES} cycle(s), ${WAIT_SEC}s probe each (map delay ${DELAY}s)"
echo "[bbr:observe] status: bun run bbr:status | watch: bun run bbr:watch"
echo ""

for (( c = 1; c <= CYCLES; c++ )); do
  echo "────────── observe cycle ${c}/${CYCLES} ──────────"
  node scripts/bbrObservability.cjs map-cancel || true
  sleep 1

  export BBR_OBSERVE_CYCLE="${c}"
  LOG="${LOG_DIR}/bbr-map-run-cycle-${c}.log"
  export BBR_MAP_RUN_LOG="${LOG}"
  BBR_MAP_DELAY_SEC="${DELAY}" bash scripts/buildBbrUrlMap.sh >> "${LOG}" 2>&1 &
  map_pid=$!
  echo "[bbr:observe] map pid=${map_pid} (cycle ${c})"

  sleep "${WAIT_SEC}"

  bun run bbr:status || node scripts/bbrObservability.cjs status
  node scripts/bbrObservability.cjs map-snapshot --cycle="${c}"

  node scripts/bbrObservability.cjs map-cancel || true
  kill "${map_pid}" 2>/dev/null || true
  sleep 1
  kill -9 "${map_pid}" 2>/dev/null || true
  wait "${map_pid}" 2>/dev/null || true
  echo ""
done

echo "[bbr:observe] done. See .firecrawl/bbr-map-observe-cycles.jsonl"
tail -n "${CYCLES}" .firecrawl/bbr-map-observe-cycles.jsonl 2>/dev/null || true
