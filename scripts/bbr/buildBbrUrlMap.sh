#!/usr/bin/env bash
# Builds bbr-map-full.txt from scratch via multi-pass Firecrawl map.
# Scope: players, teams, leagues (seasons), leaders, awards, player gamelogs.
# Pass C uses targeted gamelog/index searches — generic --search "players" alone
# under-discovers profile URLs (/players/x/id.html); see verify:map profile guard.
# Requires: firecrawl CLI, FIRECRAWL_API_KEY
# Progress: .firecrawl/bbr-map-progress.json — check with: bun run bbr:status
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRATCH="${ROOT}/.firecrawl/scratchpad"
BBR="https://www.basketball-reference.com"
# Firecrawl allows 2 concurrent jobs — default: use both, no extra delay between OK calls.
MAP_DELAY="${BBR_MAP_DELAY_SEC:-0}"
MAP_PARALLEL="${BBR_MAP_PARALLEL:-2}"
cd "$ROOT"
MAP_PARALLEL="${MAP_PARALLEL}" node -e "require('./scripts/bbr/bbrUrlUtils.cjs').assertFirecrawlConcurrency('bbr:map', process.env.MAP_PARALLEL)" || exit 1

readarray -t SECTIONS < <(node -e "for (const s of require('./scripts/bbr/bbrUrlUtils.cjs').BBR_SCOPE_SECTIONS) console.log(s)")
SCOPE_LABEL="${SECTIONS[*]// /,}"

PASS_B_STEPS=${#SECTIONS[@]}
PASS_C_STEPS=0
for section in "${SECTIONS[@]}"; do
  if [[ "${section}" == "players" ]]; then
    PASS_C_STEPS=$((PASS_C_STEPS + 4))
  else
    PASS_C_STEPS=$((PASS_C_STEPS + 1))
  fi
done
MAP_BASE_STEPS=$((PASS_B_STEPS + PASS_C_STEPS))

obs_map_event() {
  node scripts/bbr/bbrObservability.cjs map-event "$@"
}

obs_map_pass() {
  node scripts/bbr/bbrObservability.cjs map-pass "$@"
}

run_map() {
  local attempt=0
  local max_attempts=8
  while (( attempt < max_attempts )); do
    local out
    local code
    set +e
    out=$(firecrawl map "$@" 2>&1)
    code=$?
    set -e
    if (( code == 0 )); then
      [[ -n "${out}" ]] && echo "${out}"
      if (( MAP_DELAY > 0 )); then
        sleep "${MAP_DELAY}"
      fi
      return 0
    fi
    if echo "${out}" | grep -qi "rate limit"; then
      local wait_sec=30
      if echo "${out}" | grep -qE "retry after [0-9]+s"; then
        wait_sec=$(echo "${out}" | grep -oE "retry after [0-9]+s" | head -1 | grep -oE "[0-9]+")
        wait_sec=$((wait_sec + 1))
      fi
      echo "[bbr:map] rate limited — waiting ${wait_sec}s (attempt $((attempt + 1))/${max_attempts})" >&2
      node scripts/bbr/bbrObservability.cjs map-activity --activity=rate_limit_wait --until-sec="${wait_sec}" || true
      obs_map_event --pass="${MAP_CURRENT_PASS:-map}" --label="rate-limit-wait" --rate-limit --total="${MAP_TOTAL_STEPS}" || true
      sleep "${wait_sec}"
      node scripts/bbr/bbrObservability.cjs map-activity --activity=firecrawl_map || true
      attempt=$((attempt + 1))
      continue
    fi
    echo "${out}" >&2
    return "${code}"
  done
  echo "[bbr:map] ERROR: map failed after ${max_attempts} retries: $*" >&2
  return 1
}

run_map_step() {
  local pass="$1"
  local label="$2"
  shift 2
  local start=$SECONDS
  node scripts/bbr/bbrObservability.cjs map-activity --activity=firecrawl_map || true
  if run_map "$@"; then
    local ms=$(( (SECONDS - start) * 1000 ))
    obs_map_event --pass="${pass}" --label="${label}" --ok --ms="${ms}" --total="${MAP_TOTAL_STEPS}"
    return 0
  fi
  local ms=$(( (SECONDS - start) * 1000 ))
  obs_map_event --pass="${pass}" --label="${label}" --fail --ms="${ms}" --total="${MAP_TOTAL_STEPS}"
  return 1
}

wait_for_map_slot() {
  while true; do
    local running=0
    local pid
    for pid in $(jobs -p 2>/dev/null); do
      running=$((running + 1))
    done
    if (( running < MAP_PARALLEL )); then
      return 0
    fi
    wait -n 2>/dev/null || wait 2>/dev/null || sleep 1
  done
}

run_map_step_async() {
  wait_for_map_slot
  ( run_map_step "$@" ) &
}

wait_all_map_jobs() {
  wait 2>/dev/null || true
}

echo "[bbr:map] preflight (BBR_SCOPE: ${SCOPE_LABEL})..."
echo "[bbr:map] throughput: parallel=${MAP_PARALLEL} delay=${MAP_DELAY}s (Firecrawl max concurrent jobs: 2)"
rm -f .firecrawl/bbr-map-full.txt .firecrawl/bbr-map.txt .firecrawl/bbr-depth-index.json
rm -rf "${SCRATCH}"/map-*
mkdir -p "${SCRATCH}"

if ! firecrawl --status >/dev/null 2>&1; then
  echo "[bbr:map] ERROR: firecrawl CLI not ready (run: firecrawl login --browser)" >&2
  exit 1
fi

MAP_TOTAL_STEPS=${MAP_BASE_STEPS}
node scripts/bbr/bbrObservability.cjs map-init
node -e "require('./scripts/bbr/bbrObservability.cjs').patchMapProgress({ mapPid: ${BBR_MAP_SHELL_PID:-$$} })" || true
echo "[bbr:map] progress → .firecrawl/bbr-map-progress.json (bun run bbr:status)"

MAP_CURRENT_PASS="B"
obs_map_pass --pass=B --total="${MAP_TOTAL_STEPS}"
echo "[bbr:map] Pass B — section hubs (${SCOPE_LABEL})..."
for section in "${SECTIONS[@]}"; do
  run_map_step_async B "section:${section}" "${BBR}/${section}/" --limit 3000 -o "${SCRATCH}/map-section-${section}.txt" || true
done
wait_all_map_jobs

MAP_CURRENT_PASS="C"
obs_map_pass --pass=C --total="${MAP_TOTAL_STEPS}"
echo "[bbr:map] Pass C — gamelogs + section indexes (${SCOPE_LABEL})..."
players_in_scope=false
for section in "${SECTIONS[@]}"; do
  [[ "${section}" == "players" ]] && players_in_scope=true
done
if [[ "${players_in_scope}" == "true" ]]; then
  for q in gamelog gamelog-advanced gamelog-playoffs; do
    run_map_step_async C "players:${q}" "${BBR}" --search "players ${q}" --limit 2000 -o "${SCRATCH}/map-q-players-${q}.txt" || true
  done
  run_map_step_async C "search:players-index" "${BBR}" --search "players index" --limit 500 -o "${SCRATCH}/map-q-players-index.txt" || true
fi
for section in "${SECTIONS[@]}"; do
  [[ "${section}" == "players" ]] && continue
  run_map_step_async C "search:${section}-index" "${BBR}" --search "${section} index" --limit 500 -o "${SCRATCH}/map-q-${section}-index.txt" || true
done
wait_all_map_jobs

MAP_CURRENT_PASS="D"
echo "[bbr:map] Pass D — interim seeds + deep player subtrees..."
bun run scripts/bbr/mergeBbrUrlMap.ts --interim
PASS_D_COUNT=1
if [[ -f "${SCRATCH}/map-pass-d-seeds.txt" ]]; then
  PASS_D_COUNT=$(grep -c . "${SCRATCH}/map-pass-d-seeds.txt" || echo 1)
fi
MAP_TOTAL_STEPS=$((MAP_BASE_STEPS + PASS_D_COUNT))
obs_map_pass --pass=D --total="${MAP_TOTAL_STEPS}"
if [[ -f "${SCRATCH}/map-pass-d-seeds.txt" ]]; then
  while IFS= read -r seed_url; do
    [[ -z "${seed_url}" ]] && continue
    hash=$(printf '%s' "${seed_url}" | md5sum 2>/dev/null | cut -c1-8 || printf '%s' "${seed_url}" | md5 -r 2>/dev/null | cut -c1-8)
    run_map_step_async D "deep:${hash}" "${seed_url}" --limit 500 -o "${SCRATCH}/map-deep-${hash}.txt" || true
  done < "${SCRATCH}/map-pass-d-seeds.txt"
  wait_all_map_jobs
fi

echo "[bbr:map] merging scratchpad..."
bun run scripts/bbr/mergeBbrUrlMap.ts
node scripts/bbr/bbrObservability.cjs map-done

echo "[bbr:map] complete. Run: bun run bbr:status"
