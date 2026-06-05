# scripts/bbr/

Firecrawl-backed offline mirror of Basketball-Reference.com. Produces `bbr-screenshots/` (PNG + JSON) and `.firecrawl/` (markdown cache + map manifests). Used for cross-verification in the chatbot eval suite and planned for Time-Machine BBR view augmentation.

---

## Responsibility

Provide a **two-phase mirror pipeline** (map → crawl) that:

1. **Map** — Discover all in-scope BBR URLs (`players`, `teams`, `leagues`, `leaders`, `awards`) via Firecrawl's `map` API, collate into `bbr-map-full.txt` + depth-index.
2. **Crawl + screenshot** — Scrape each discovered URL via Firecrawl's `scrape` API, store up to **2 PNG + 2 JSON artifacts per mirrored directory**. PNG (full-page screenshot), JSON (scrape record with markdown + links + metadata), and `.md` (body-only cache).

Environment variable `BBR_SCOPE` controls which sections are active (default: all five). Firecrawl free tier caps concurrent jobs at 2.

---

## Design

### Shared utility layer (`bbrUrlUtils.cjs`)

- `normalizeBbrUrl(url)` — Canonical form: strip hash, trailing slash, enforce `basketball-reference.com` host.
- `getMirroredRelativePath(url)` — Maps BBR URL path to filesystem path, appending `/index.html` for directory-like paths. Used by all save/verify tools to determine `bbr-screenshots/` and `.firecrawl/` layout.
- `getUrlDepth(url)` — Depth of a URL in the BBR site tree (0 = homepage, 1 = section hub, 2 = sub-section, 3 = entity, 4+ = subpages/boxscore children).
- `getUrlSection(url)` — First path segment (`players`, `teams`, etc.).
- `isUrlInScope(url)` — Filters by `BBR_SCOPE_SECTIONS`.
- `getDiscoveryHubUrls()` / `sectionRootUrl(section)` — Hub URLs for each section.
- `playerProfileUrl`/`gamelogUrl` matchers, `countPlayerProfiles`, `countPlayerGamelogs`, `sectionHistogram` — Composition helpers for verification.
- `assertFirecrawlConcurrency(label, val)` — Warn on values exceeding free-tier limit (2); exits with `BBR_ENFORCE_CONCURRENCY_CAP=1`.

### Observability (`bbrObservability.cjs`)

Exposes a **progress-JSON protocol** consumed by shell scripts and the `bbr:status` command. Writes to `.firecrawl/`:

| File | Content |
|---|---|
| `bbr-map-progress.json` | Map phase: runId, pass (B/C/D), step index, rate-limit waits, scratchpad URL count, timing/pacing metrics |
| `bbr-crawl-progress.json` | Crawl phase: crawled/failed counts, directories complete/incomplete, artifact totals, queue/in-flight size |
| `bbr-map-heartbeat.txt` | Single-line summary refreshed on every `patchMapProgress` call |
| `bbr-map-observe-cycles.jsonl` | Append-only snapshot log from `bbrMapObserveCycle.sh` |

CLI commands (`node bbrObservability.cjs <cmd>`): `status`, `watch` (live TUI refresh), `map-init`, `map-pass`, `map-event`, `map-activity`, `map-done`, `map-cancel`, `map-snapshot`.

### Map pipeline (`buildBbrUrlMap.sh` + `mergeBbrUrlMap.ts`)

**Three-pass map strategy:**

| Pass | Target | Parallelism | Firecrawl args |
|---|---|---|---|
| **B** | Section hub URLs (e.g. `.../players/`, `.../teams/`) | Up to 2 concurrent via `run_map_step_async` | `--limit 3000` |
| **C** | Gamelog searches (`gamelog`, `gamelog-advanced`, `gamelog-playoffs`) + section-index searches | Up to 2 concurrent | `--search <term> --limit 2000/500` |
| **D** | Deep seeds from interim merge: player letter hubs → individual player profiles from existing scratchpad URLs | Up to 2 concurrent | `--limit 500` |

Each pass writes scratchpad files as `<scratchpad>/map-<pass>-<label>.txt`. After all passes, `mergeBbrUrlMap.ts` concatenates scratchpad content, normalizes/filters URLs, and produces:

- `.firecrawl/bbr-map-full.txt` — Sorted unique in-scope URLs (depth-ascending, then lexicographic).
- `.firecrawl/bbr-depth-index.json` — Full index with `depth`, `section`, `mirroredDir` per URL + depth histogram.

Merge also enforces **quality gates**: verifies all L1 section roots present, at least one URL at depth 4–6, and for maps ≥500 URLs, requires non-zero depth 4/5 coverage.

The interim mode (`--interim`) feeds Pass D: it picks player-letter hubs and player profile URLs from scratchpad and writes them as `map-pass-d-seeds.txt`.

### Crawl pipeline (`takeBbrScreenshots.cjs`)

**Per-directory coverage model**: Each mirrored directory (e.g. `bbr-screenshots/players/j/jamesle01/`) needs exactly **2 PNG + 2 JSON** artifacts. The crawler:

1. Loads seeds from `bbr-map-full.txt`.
2. Bootstraps existing artifacts from `bbr-screenshots/` (resume support).
3. Spawns up to 2 concurrent workers (`BBR_CRAWL_CONCURRENCY`). Each worker:
   - Dequeues actionable URLs (depth-priority, shallow first).
   - Calls Firecrawl `POST /v2/scrape` with `screenshot + markdown + links`.
   - Saves PNG → `bbr-screenshots/<mirror-path>.png`, JSON → both `bbr-screenshots/` and `.firecrawl/`, markdown → `.firecrawl/`.
   - Discovers new URLs from response links; enqueues if their directory still needs artifacts.
   - Rate-limit retry (up to 6 attempts).
4. Discovery subsystem: harvests links from cached `.md`/`.json`, replenishes recrawls for exhausted directories, falls back to section hubs.
5. Status board printed every 15s; progress persisted to `bbr-crawl-progress.json`.

### Preflight & chain (`bbrPreflightCrawl.sh`, `bbrWaitMapThenCrawl.sh`)

- `bbrPreflightCrawl.sh` — Wipes `bbr-screenshots/`, verifies map file exists and Firecrawl CLI + API key are configured.
- `bbrWaitMapThenCrawl.sh` — Polls for map completion (via `bbr-map-progress.json.pass === 'done'` or heartbeat timeout), then delegates to preflight + `takeBbrScreenshots.cjs`.

### Observe loop (`bbrMapObserveCycle.sh` + `bbrObservability.cjs appendObserveCycle`)

Kaizen-style: cancel running map → start map in background → wait 15s → snapshot status → cancel → analyse observability gaps. Writes cycle snapshots to `bbr-map-observe-cycles.jsonl`. Each snapshot captures pass, step, activity, rate-limit state, scratchpad size, pacing metrics, and log tail.

### Verification (`verifyBbrScreenshots.cjs`)

Two modes:

- `--map-only` — Checks map file not empty, section histogram present, player profile count >= `BBR_MIN_PLAYER_PROFILES` (default 10), L1 roots present, depth index non-empty with depth 4–6 coverage, per-depth checks for large maps.
- Full check — Also walks `bbr-screenshots/` verifying every directory meets 2 PNG + 2 JSON quota and all JSON records contain required keys (`url`, `markdown`, `links`, `scrapedAt`).

### Auxiliary tools

| Tool | Purpose |
|---|---|
| `scrapeDepthSamples.cjs` | One representative scrape per (section, depth) pair; saves to both `bbr-screenshots/` and `.firecrawl/` with manifest at `bbr-depth-samples.json`. |
| `compareMapToTui.cjs` | Compares `bbr-map-full.txt` coverage vs BBR's known keyboard-shortcut sections and player subpage types (gamelog, splits, shooting, etc.). Reports per-section counts, player subpage distribution, and offline mirror overlap. |

---

## Flow

```
bbr:map (buildBbrUrlMap.sh)
  │
  ├─[Pass B] firecrawl map → section hubs  (parallel, up to 2)
  │             ↓ scratchpad/map-section-*.txt
  ├─[Pass C] firecrawl map → gamelog/index searches  (parallel)
  │             ↓ scratchpad/map-q-*.txt
  ├─[Pass D] merge --interim → seeds → firecrawl map → deep player subtrees
  │             ↓ scratchpad/map-deep-*.txt
  └─ bun mergeBbrUrlMap.ts (quality gate)
          ↓
  .firecrawl/bbr-map-full.txt
  .firecrawl/bbr-depth-index.json
  .firecrawl/bbr-map-progress.json (pass: done)

bbr:crawl (bbrPreflightCrawl.sh → takeBbrScreenshots.cjs)
  │
  ├─ wipe bbr-screenshots/
  ├─ loadSeeds from bbr-map-full.txt
  ├─ pre-fill graph from existing artifacts (resume)
  ├─ workers[2]: scrape (Firecrawl v2) → save PNG+JSON+MD
  │     ├─ per-directory quota: 2 PNG + 2 JSON
  │     ├─ discovery: harvest links → enqueue incomplete dirs
  │     └─ rate-limit: retry up to 6×
  └─ progress → .firecrawl/bbr-crawl-progress.json

bbr:verify (verifyBbrScreenshots.cjs)
  ├─ map checks: sections, depths, profile count
  └─ screenshot checks: 2 PNG + 2 JSON per dir, JSON schema

bbr:observe (bbrMapObserveCycle.sh)
  └─ cycle: cancel → map N seconds → snapshot → analyse → repeat
```

---

## CLI Scripts (package.json)

All entry points are wired as `bbr:*` scripts at the monorepo root:

| Script | Runnable | Underlying file(s) |
|---|---|---|
| `bbr:map` | `bun run bbr:map` | `buildBbrUrlMap.sh` → `mergeBbrUrlMap.ts` + `bbrObservability.cjs` |
| `bbr:map:players` | `bun run bbr:map:players` | Same, but `BBR_SCOPE=players` |
| `bbr:map:merge` | `bun run bbr:map:merge` | `mergeBbrUrlMap.ts` |
| `bbr:crawl` | `bun run bbr:crawl` | `bbrPreflightCrawl.sh` → `takeBbrScreenshots.cjs` |
| `bbr:crawl:players` | `bun run bbr:crawl:players` | Same, but `BBR_SCOPE=players` |
| `bbr:map-then-crawl` | `bun run bbr:map-then-crawl` | `bbrWaitMapThenCrawl.sh` |
| `bbr:verify` | `bun run bbr:verify` | `verifyBbrScreenshots.cjs` |
| `bbr:verify:map` | `bun run bbr:verify:map` | `verifyBbrScreenshots.cjs --map-only` |
| `bbr:status` | `bun run bbr:status` | `bbrObservability.cjs status` |
| `bbr:watch` | `bun run bbr:watch` | `bbrObservability.cjs watch` |
| `bbr:map:cancel` | `bun run bbr:map:cancel` | `bbrObservability.cjs map-cancel` |
| `bbr:observe` | `bun run bbr:observe` | `bbrMapObserveCycle.sh` → `bbrObservability.cjs` |
| `bbr:scrape-depth-samples` | `bun run bbr:scrape-depth-samples` | `scrapeDepthSamples.cjs` |

---

## Integration

- **Output directories (repo root)**:
  - `bbr-screenshots/` — Mirrored PNG + JSON artifacts in BBR path structure.
  - `.firecrawl/` — Map manifests, depth index, markdown cache, progress JSON, scrape logs.
- **packages/data chatbot eval** — `packages/data/src/tabs/chatbot/eval/bbrTruth.ts` resolves values from `bbr-truth.json` (manually curated). The eval matrix harness (`matrixHarness.ts`) uses `resolveBbrValue()` to cross-validate agent answers against both DuckDB and BBR truth values. No programmatic dependency on `bbr-screenshots/` outputs currently exists; the offline mirror is designed as a future source of truth for automated fact-checking.
- **packages/data Time Machine** — Planned `utils/bbr/` integration (no directory exists yet). The Firecrawl offline cache at `.firecrawl/` and `bbr-screenshots/` is designed to serve BBR views for the Career Time-Machine feature.
- **Env vars** — `BBR_SCOPE` (section filter), `FIRECRAWL_API_KEY` (required), `BBR_CRAWL_CONCURRENCY` (default 2), `BBR_MAP_DELAY_SEC` (default 0), `BBR_MAP_PARALLEL` (default 2), `BBR_CRAWL_BUDGET`, `BBR_MIN_PLAYER_PROFILES` (default 10), `BBR_USE_LEGACY_SEEDS`, `BBR_SCRAPE_TIMEOUT_MS` (default 120000), `BBR_SCRAPE_RATE_LIMIT_MS` (default 1500), `BBR_ENFORCE_CONCURRENCY_CAP`.
