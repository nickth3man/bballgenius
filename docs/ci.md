# CI/CD

## Pipeline

```text
PR opened / push to main
  │
  ├── guards           Static checks: no .only/.skip, no sibling-tab imports,
  │                    no snapshot update env, Biome zero-warning belt-and-suspenders
  ├── lint             Biome ci (no fix)
  ├── format           Biome check --write + git diff --exit-code
  ├── typecheck        tsc --noEmit (src/)
  ├── typecheck-scripts tsc --noEmit (scripts/)
  ├── unit             Formatter/parser tests (no database)
  ├── regression       Hub regression + snapshots (CI fixture)
  ├── integration      Full hub suite (CI fixture)
  ├── chatbot          Strict typecheck + chatbot test suite (CI fixture)
  ├── test-scripts     Script test suite (CI fixture)
  ├── dq-fixture       DQ gate smoke (CI fixture)
  ├── docs             Markdown lint
  ├── audit            bun audit --audit-level=moderate
        │
        ▼
    ci-success         Aggregate: all jobs must pass
        │
        ▼
    integration-full   Manual only: full database (workflow_dispatch)
```

## CI Jobs

All jobs run on `ubuntu-latest`. The CI fixture (`data/fixtures/nba.ci.duckdb`, ~2.8 MB) is checked into the repo and used by database-dependent jobs.

Key conventions:

- **Permissions**: `contents: read` (read-only, no PR mutations).
- **Concurrency**: `cancel-in-progress: true` on PR branches.
- **Job timeouts**: 5–45 minutes depending on scope.
- **Bun version**: Resolved from `package.json` `packageManager` field via `oven-sh/setup-bun@v2` with `bun-version-file: package.json`.
- **Frozen lockfile**: All `bun install` steps use `--frozen-lockfile`.
- **Dependency cache**: Bun package cache cached via `actions/cache@v4` (keyed on `bun.lock` hash).

## CI Fixture

Database-dependent jobs (regression, integration, chatbot, test-scripts, dq-fixture) set `NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb` and verify the file exists before running.

See `docs/data.md` for fixture details and regeneration.

## Full Database Integration

The `integration-full` job runs only on `workflow_dispatch` with `run_full_database: true`. It requires the full `data/nba.duckdb` to be present on the runner. This is typically only meaningful on self-hosted runners.

## Snapshot Updates

- Golden snapshots under `src/tests/snapshots/` are generated against the CI fixture.
- CI **blocks** `UPDATE_SNAPSHOTS=1` to prevent accidental rewriting.
- To regenerate locally:

```bash
bun run snapshots:update
```

## Concurrency

All test suite jobs use `--concurrency=1` with `bun test`. This avoids DuckDB singleton conflicts and ensures deterministic snapshot ordering.

## Biome

- **CI**: `biome ci` (read-only, no writes, emits GitHub annotations).
- **Local**: `biome check --write` (auto-fixes).
- **Pre-commit (Lefthook)**: `biome check --write` on staged TS/JSON files.
- **Policy**: Zero warnings (`--error-on-warnings`).

## Dependency Audit

`bun audit --audit-level=moderate` runs in CI and fails on moderate+ advisories. Dependabot is configured for weekly Bun and GitHub Actions updates.

## Adding a CI Job

1. Follow the existing pattern: checkout → setup-bun → cache → install → run.
2. Add the job to `ci-success` needs list and env/loop.
3. Set appropriate timeout.
4. Use CI fixture path for DB-dependent tests.
