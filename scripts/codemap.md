# `scripts/` (root)

## Responsibility
Top-Level Automation Scripts — miscellaneous debug, smoke-test, and utility scripts that do not belong to any subdirectory (`ci/`, `db/`, `eval/`, `bbr/`, `validation/`). These are ad-hoc or transitional tools.

## Design

### Scripts Overview

| Script | Language | Purpose |
|--------|----------|---------|
| `debug-500.ts` | TypeScript (Bun) | Captures full SSR 500 error output from the TanStack Start dev server for debugging |
| `smoke-web.ts` | TypeScript (Bun) | Fast server smoke test: starts web dev, hits `localhost:3000/`, checks HTTP status and stderr for errors |
| `quick-test.ts` | TypeScript (Bun) | Quick 3-model, 5-question chatbot test (simple, multi, vague questions) for rapid iteration |
| `tmp-stream-probe.ts` | TypeScript (Bun) | Minimal streaming probe: pipes a question through `streamQuery()` and prints tool starts + reasoning token counts by stage |
| `takeBbrScreenshots.ts` | TypeScript (Bun + Playwright) | **Deprecated** Playwright-based BBR screenshot browser (superseded by `scripts/bbr/takeBbrScreenshots.cjs` Firecrawl version) |
| `_write_temp.py` | Python | Trivial placeholder script (`print("hello")`) |

### `validation/` Subdirectory
Python utilities for nba_api bulk data validation using Mullvad VPN rotation:

| File | Purpose |
|------|---------|
| `_shared.py` | MullvadRotator + NbaApiSession — IP rotation via VPN reconnect or SOCKS5 proxy cycling for stats.nba.com bulk fetching |
| `requirements.txt` | Python deps: `nba_api`, `fake-useragent`, `requests`, `PySocks` |

The `_shared.py` module provides two rotation modes:
- **VPN Reconnect**: Cycles through 20 US cities via `mullvad reconnect` (~5-10s per rotation).
- **SOCKS5 Multi-Exit**: Routes through different Mullvad SOCKS5 proxies (instant, no reconnect).
- **Hybrid** (default): Uses both VPN and SOCKS5.
- **`NbaApiSession`**: Extends `requests.Session` with rate limiting, retry with exponential backoff, User-Agent rotation, proactive/reactive rotation, and comprehensive stats tracking.

## Flow

```
Quick iteration:
  quick-test.ts          → 3 models × 5 questions → pass/fail per model
  tmp-stream-probe.ts    → 1 question → streaming tool_start + reasoning counts

Server debugging:
  debug-500.ts           → spawns web dev → fetches / → captures logs → writes temp/debug-500.log
  smoke-web.ts           → spawns web dev → fetches / → checks status + error count → exits 0/1

Validation:
  validation/_shared.py  → MullvadRotator + NbaApiSession → used by external validation scripts
```

## Integration
- **These scripts are not invoked by CI or production code** — they are developer tooling.
- `quick-test.ts` and `tmp-stream-probe.ts` import from `packages/data` chatbot internals (same as eval scripts).
- `debug-500.ts` and `smoke-web.ts` spawn the web dev server as a child process.
- The `validation/` Python scripts are standalone — require Mullvad VPN and nba_api Python package.
