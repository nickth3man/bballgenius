# scripts/

Automation root. Houses all non-package shell/TypeScript/Python tooling for CI, DuckDB warehouse curation, chatbot evaluation, BBR screenshot crawling, and ad-hoc dev debugging. Executed via `bun run scripts/...` or direct invocation from `package.json` scripts block.

## Responsibility

- **CI & pre-commit guards** — `scripts/ci/` enforces no `.only`/`.skip`, Biome zero-warnings, and builds the CI DuckDB fixture.
- **DuckDB warehouse operations** — `scripts/db/` manages medallion-tier curation: canonical views, entity xref, cross-source accuracy reconciliation, DQ gating, and schema metadata.
- **Chatbot evaluation** — `scripts/eval/` runs LangGraph smoke tests (fact-checked NBA questions, 100-query broad suite, multi-model matrix) against real OpenRouter API endpoints.
- **BBR Firecrawl mirror** — `scripts/bbr/` maps, crawls, screenshots, and observes Basketball-Reference.com into the repo-local `bbr-screenshots/` and `.firecrawl/` cache.
- **Ad-hoc dev debugging** — Root-level `smoke-web.ts` (server health check), `debug-500.ts` (SSR error capture), `quick-test.ts` (multi-model chatbot sanity).
- **nba_api validation** — `scripts/validation/` provides Mullvad VPN + SOCKS5 proxy rotation for IP-rotated bulk fetches from `stats.nba.com`.

## Design

- **No shared framework** — Each subdirectory is self-contained with its own entry points and conventions. Root-level scripts are single-file standalone scripts.
- **Execution via `package.json`** — Every named operation (`dq:*`, `bbr:*`, `chatbot:smoke:*`, `ci`, `fixture:build`) is a script alias in root `package.json`.
- **DB scripts run DuckDB via `@duckdb/node-api`** — They follow a consistent pattern: `DuckDBInstance.fromCache(DB_PATH)`, `conn.run('CHECKPOINT')` after writes, and DB path from `process.env.NBA_DUCKDB_PATH` or default.
- **Eval scripts import chatbot internals** — They reach directly into `packages/data/src/tabs/chatbot/...` (not via workspace alias), which is a deliberate boundary exception for eval tooling.
- **BBR scripts mix shell and JS** — Shell orchestrates map/crawl lifecycle with `FIRECRAWL_API_KEY`; `.cjs` scripts handle screenshot capture, verification, and observability.
- **Stub directories** — `dev/` is empty; `_write_temp.py` is a placeholder.

## Flow

### Development iteration flow
```
quick-test.ts ──> initDb() ──> buildSystemPrompt() ──> for each model:
                      getChatbotGraph().invoke() ──> PASS/FAIL per question
                      ──> closeDb()

smoke-web.ts ──> kill-port 3000 ──> spawn `bun run web` ──> poll localhost:3000 ──> PASS/FAIL + error scan

debug-500.ts ──> kill-port 3000 ──> spawn `bun run web` ──> capture all stdout/stderr ──> write temp/debug-500.log
```

### Subdirectory flows

| Subdirectory | Flow | Entry points |
|---|---|---|
| **bbr/** | `buildBbrUrlMap.sh` → `bbrPreflightCrawl.sh` → `takeBbrScreenshots.cjs` → `verifyBbrScreenshots.cjs` | `bbr:map`, `bbr:crawl`, `bbr:verify`, `bbr:observe` |
| **ci/** | `ci-guards.sh` → `build-ci-fixture.ts` (subset DB → `CHECKPOINT` → CI fixture) | `ci`, `fixture:build` |
| **db/** | `verify-dq.ts` (DQ suite) → `build-canonical-*.ts` → `classify-accuracy-discrepancies.ts` → `oracle-resolve-discrepancies.ts` | `dq:*`, `accuracy:*` |
| **eval/** | `chatbot-smoke.ts` (single/multi-model) → `chatbot-eval-multi-model.ts` (matrix-driven) → `iterate_loop.ts` (multi-run loop) | `chatbot:smoke:*` |
| **validation/** | Python `MullvadRotator` + `NbaApiSession` for IP-rotated requests to `stats.nba.com` | Manual Python invocation |

## Integration

- **`scripts/` calls into `packages/data/`** — Root-level and eval scripts import chatbot graph, DB, system prompt, and eval queries from `packages/data/src/tabs/chatbot/...` via source-level relative paths.
- **`scripts/db/` writes to `data/nba.duckdb`** — Canonical view building, xref resolution, DQ checks all mutate the DuckDB warehouse; the CI fixture at `data/fixtures/nba.ci.duckdb` is a pruned subset built by `scripts/ci/build-ci-fixture.ts`.
- **`scripts/bbr/` produces `bbr-screenshots/` and `.firecrawl/`** — These artifacts are consumed by the Time Machine feature (`packages/data/src/tabs/timeMachine/utils/bbr/`).
- **`package.json` bridges** — Every script is wired through root `package.json` `"scripts"` block (42 entries). CI uses `ci`, `fixture:build`, `dq:fixture`. Chatbot eval uses `chatbot:smoke:*`. Warehouse ops use `dq:*` and `accuracy:*`.
- **Child codemaps** — Each subdirectory (`bbr/`, `ci/`, `db/`, `eval/`) contains its own `codemap.md` for deeper architectural detail.

### Child directory codemap references

| Directory | Codemap |
|---|---|
| `scripts/bbr/` | `scripts/bbr/codemap.md` |
| `scripts/ci/` | `scripts/ci/codemap.md` |
| `scripts/db/` | `scripts/db/codemap.md` |
| `scripts/eval/` | `scripts/eval/codemap.md` |
