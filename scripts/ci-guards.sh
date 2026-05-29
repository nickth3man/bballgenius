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

if rg -n '\.(only|skip)\(' src/tabs/chatbot/__tests__ --glob '*.ts' >/dev/null 2>&1; then
  echo "::error::Focused or skipped tests (.only / .skip) are not allowed under src/tabs/chatbot/__tests__"
  rg -n '\.(only|skip)\(' src/tabs/chatbot/__tests__ --glob '*.ts' || true
  fail=1
fi

if [ "${UPDATE_SNAPSHOTS:-}" = "1" ]; then
  echo "::error::UPDATE_SNAPSHOTS must not be set in CI (golden snapshots would be rewritten)"
  fail=1
fi

# Belt-and-suspenders: fail on any Biome warning even if individual rules are "warn"
lint_out="$(bunx biome lint src scripts --max-diagnostics=500 2>&1)" || lint_ec=$?
printf '%s\n' "$lint_out"
if printf '%s\n' "$lint_out" | rg -q 'Found [1-9][0-9]* warning'; then
  echo "::error::Biome reported warnings (CI requires zero warnings)"
  fail=1
fi
if [ "${lint_ec:-0}" -ne 0 ]; then
  fail=1
fi

if rg -n "from '\\.\\./(gameCenter|timeMachine|sqlSandbox|chatbot)" src/tabs/ --glob '*.ts' >/dev/null 2>&1; then
  echo "::error::Tabs must not import sibling tab modules directly (use core/ or shared/ instead)"
  rg -n "from '\\.\\./(gameCenter|timeMachine|sqlSandbox|chatbot)" src/tabs/ --glob '*.ts' || true
  fail=1
fi

exit "$fail"
