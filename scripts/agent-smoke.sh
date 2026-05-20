#!/usr/bin/env bash
# Fast agent-friendly smoke: unit formatters + TUI integration + golden snapshots (CI fixture).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

export NBA_DUCKDB_PATH="${NBA_DUCKDB_PATH:-data/fixtures/nba.ci.duckdb}"

echo "==> agent-smoke (NBA_DUCKDB_PATH=$NBA_DUCKDB_PATH)"

echo "--- formatters (unit)"
bun test src/tests/formatters.test.ts --concurrency=1

echo "--- tui integration"
bun test src/tests/tui_integration.test.ts --concurrency=1

echo "--- golden snapshots"
bun test src/tests/golden_snapshot.test.ts --concurrency=1

echo "==> agent-smoke: all passed"
