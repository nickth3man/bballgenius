#!/usr/bin/env bash
# CI guardrails: fail on patterns that weaken the test suite in automation.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail=0

if rg -n '\.(only|skip)\(' src/tests --glob '*.ts' >/dev/null 2>&1; then
  echo "::error::Focused or skipped tests (.only / .skip) are not allowed under src/tests"
  rg -n '\.(only|skip)\(' src/tests --glob '*.ts' || true
  fail=1
fi

if [ "${UPDATE_SNAPSHOTS:-}" = "1" ]; then
  echo "::error::UPDATE_SNAPSHOTS must not be set in CI (golden snapshots would be rewritten)"
  fail=1
fi

exit "$fail"
