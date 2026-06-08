# `scripts/bbr/`

## Responsibility
BBR Firecrawl Map/Crawl/Observe — automated offline mirroring of Basketball-Reference.com via the Firecrawl API. Produces PNG screenshots, JSON scrape artifacts, and markdown caches stored in `bbr-screenshots/` and `.firecrawl/` for use by the Time Machine BBR views.

## Design

### Pipeline: Map → Crawl → Verify

```
Map Phase (discovery)          → bbr-map-full.txt (all URLs)
  │
  ▼
Crawl Phase (screenshots)      → bbr-screenshots/ (PNG + JSON)
  │                              .firecrawl/ (JSON + markdown cache)
  ▼
Verify Phase                   → pass/fail report (profiles, depth, coverage)
```

### Map Phase (`buildBbrUrlMap.sh` + `mergeBbrUrlMap.ts`)
Multi-pass Firecrawl `map` command that discovers BBR URLs:

- **Pass B — Section hubs**: Maps each section root (`/players/`, `/teams/`, `/leagues/`, `/leaders/`, `/awards/`) with `--limit 3000`.
- **Pass C — Gamelogs + index searches**: Targeted `--search` queries for player gamelogs and section indexes.
- **Pass D — Deep player subtrees**: Uses `mergeBbrUrlMap.ts --interim` to find player letter-bucket pages and deep player profile URLs, then maps each with `--limit 500`.
- **Merge**: `mergeBbrUrlMap.ts` collects all scratchpad outputs, filters to scope, sorts by depth, writes `bbr-map-full.txt` + `bbr-depth-index.json`.
- **Quality gates**: At merge time, validates all section roots are present, depth 4-6 URLs exist, and certain depth thresholds for maps > 500 URLs.

### Crawl Phase (`takeBbrScreenshots.cjs`)
Concurrent Firecrawl `scrape` worker that crawls each URL from the map:
- **Per-directory quota**: Each mirrored directory gets up to **2 PNG** and **2 JSON** artifacts.
- **Concurrency**: 2 workers maximum (Firecrawl free tier limit), enforced via `assertFirecrawlConcurrency()`.
- **Discovery woven into crawl**: Workers harvest links from completed scrapes and enqueue new URLs for incomplete directories.
- **Rate-limit handling**: Exponential backoff with retry-after parsing (up to 6 attempts).
- **Status board**: Live terminal UI updated every 15s showing directory progress, queue depth, artifact counts, worker phases.
- **Progress persistence**: `bbr-crawl-progress.json` written every status tick.
- **Smart stop**: Workers stop when all directories have 2 PNG + 2 JSON and no more actionable links remain.

### Observe Cycle (`bbrMapObserveCycle.sh` + `bbrObservability.cjs`)
Kaizen loop for tuning the map pipeline:
- Runs N cycles (default 5): starts a map, waits 15s, snapshots progress, cancels.
- Captures observability data: heartbeat staleness, step progress, rate limits, ETA.
- Appends cycle snapshots to `bbr-map-observe-cycles.jsonl`.
- Gemba-style gap analysis: reports missing runId, stale heartbeats, missing ETA metrics.

### URL Utilities (`bbrUrlUtils.cjs`)
Shared URL normalization and classification:
- **`normalizeBbrUrl(url)`**: Canonicalizes BBR URLs (removes hash, trailing slash).
- **`getMirroredRelativePath(url)`**: Converts a URL to a filesystem path under `bbr-screenshots/` (e.g., `/players/j/jamesle01.html` → `players/j/jamesle01.html`).
- **`getUrlDepth(url)`**: Returns path depth (0 for root, 1 for section, 3 for player profile, etc.).
- **`isUrlInScope(url)`**: Checks against `BBR_SCOPE_SECTIONS` (env `BBR_SCOPE`).
- **`isPlayerProfileUrl()`, `isPlayerGamelogUrl()`**: Specific URL pattern matchers.
- **`sectionHistogram()`**, `countPlayerProfiles()`, `countPlayerGamelogs()`: Map quality metrics.
- **`getDiscoveryHubUrls()`**: Returns section root URLs for link harvesting.
- **`FIRECRAWL_MAX_CONCURRENCY`**: Enforced at 2 (free tier limit).

### Verification (`verifyBbrScreenshots.cjs`)
- **Map verification**: Checks map exists, has URLs, section histogram, player profile count >= minimum, depth histogram with depth 4-6 coverage.
- **Screenshot verification**: Walks `bbr-screenshots/`, checks every directory with artifacts meets 2 PNG + 2 JSON quota, validates all JSON have required keys (`url`, `markdown`, `links`, `scrapedAt`).
- **`--map-only`**: Skip screenshot check.

### Preflight (`bbrPreflightCrawl.sh`)
Wipes `bbr-screenshots/`, verifies map exists, checks Firecrawl CLI readiness, ensures `FIRECRAWL_API_KEY` is set.

### Chain (`bbrWaitMapThenCrawl.sh`)
Waits for `bbr-map-full.txt` to appear (polls every 20s, detects map completion via progress heartbeat), then runs the crawl automatically.

### Depth Samples (`scrapeDepthSamples.cjs`)
Scrapes one representative page per depth level per section via the Firecrawl HTTP API directly (not CLI). Saves JSON to both `bbr-screenshots/` and `.firecrawl/` mirror paths.

### Compare (`compareMapToTui.cjs`)
Compares the discovered map against the known BBR TUI (text user interface) structure — reports coverage of player subpage types, site shortcut sections, team subpage modes, and offline mirror overlap.

### Legacy (`takeBbrScreenshots.ts`)
Deprecated Playwright-based screenshot script (pre-Firecrawl). Uses Chromium to navigate and screenshot pages. Still available but superseded by the Firecrawl pipeline.

## Flow

```
buildBbrUrlMap.sh
  ├── Pass B: firecrawl map section roots (parallel, up to 2 concurrent)
  ├── Pass C: firecrawl search "players gamelog" + section indexes
  ├── Pass D: mergeBbrUrlMap.ts --interim → seed URLs
  │           → firecrawl map each seed (parallel)
  └── mergeBbrUrlMap.ts → bbr-map-full.txt + bbr-depth-index.json

takeBbrScreenshots.cjs
  ├── Load seeds from bbr-map-full.txt
  ├── For each URL (2 concurrent workers):
  │   → firecrawl scrape (with retry)
  │   → Save PNG to bbr-screenshots/
  │   → Save JSON to bbr-screenshots/ + .firecrawl/
  │   → Save markdown to .firecrawl/
  │   → Extract links, enqueue new URLs
  ├── Smart stop when all directories meet 2/2 quota
  └── Status: terminal board + bbr-crawl-progress.json

verifyBbrScreenshots.cjs
  ├── verifyMap(): section roots, depth histogram, player profiles
  ├── verifyScreenshots(): per-directory 2 PNG + 2 JSON, JSON schema
  └── Exit code 0/1
```

## Integration
- **Consumes**: Firecrawl CLI (`firecrawl map`, `firecrawl scrape`), `FIRECRAWL_API_KEY`.
- **Produces**: `bbr-screenshots/` (PNG + JSON), `.firecrawl/` (JSON + markdown caches), `bbr-map-full.txt` (URL list), `bbr-depth-index.json`.
- **Used by**: Time Machine routes in `packages/data/src/tabs/timeMachine/utils/bbr/` read the cached markdown and JSON for BBR page rendering.
- **Scoped via**: `BBR_SCOPE` env var (default: `players,teams,leagues,leaders,awards`).
- **Entry points**: `bun run bbr:map`, `bun run bbr:crawl`, `bun run bbr:verify`, `bun run bbr:status`, `bun run bbr:watch`, `bun run bbr:observe`, `bun run bbr:map:cancel`.
