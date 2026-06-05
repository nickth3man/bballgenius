#!/usr/bin/env bash
# CI guardrails: fail on patterns that weaken the test suite in automation.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

fail=0

if rg -n '\.(only|skip)\(' packages --glob '*.{ts,tsx}' >/dev/null 2>&1; then
  echo "::error::Focused or skipped tests (.only / .skip) are not allowed under packages/"
  rg -n '\.(only|skip)\(' packages --glob '*.{ts,tsx}' || true
  fail=1
fi

if [ "${UPDATE_SNAPSHOTS:-}" = "1" ]; then
  echo "::error::UPDATE_SNAPSHOTS must not be set in CI (golden snapshots would be rewritten)"
  fail=1
fi

# Belt-and-suspenders: fail on any Biome warning even if individual rules are "warn"
lint_out="$(bunx biome lint packages scripts --max-diagnostics=500 2>&1)" || lint_ec=$?
printf '%s\n' "$lint_out"
if printf '%s\n' "$lint_out" | rg -q 'Found [1-9][0-9]* warning'; then
  echo "::error::Biome reported warnings (CI requires zero warnings)"
  fail=1
fi
if [ "${lint_ec:-0}" -ne 0 ]; then
  fail=1
fi

exit "$fail"
