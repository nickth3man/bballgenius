# `scripts/ci/`

## Responsibility
CI Automation — GitHub Actions guardrails, fixture preparation, and branch protection for the BBallGenius monorepo.

## Design

### Script Convention
- **Shell scripts** (`.sh`): Bash/POSIX-compatible, use `set -euo pipefail`, resolve repo root via `"$(cd "$(dirname "$0")/../.." && pwd)"`.
- **TypeScript**: Bun-executed DuckDB scripts that use `@duckdb/node-api` for database operations.

### Key Pattern: CI Guards (`ci-guards.sh`)
Rejects PRs that weaken the test suite:
1. **Focused/skipped test detection**: `rg -n '\.(only|skip)\(' packages --glob '*.{ts,tsx}'` — fails CI if any `.only(` or `.skip(` is found under `packages/`.
2. **Snapshot guard**: Fails if `UPDATE_SNAPSHOTS=1` is set (would rewrite golden snapshots in CI).
3. **Zero-warning Biome lint**: Runs `bunx biome lint packages scripts --max-diagnostics=500`, then grep-stdout for `Found [1-9][0-9]* warning`. CI requires zero Biome warnings.

### Key Pattern: CI Fixture Build (`build-ci-fixture.ts`)
Builds a minimal, committed DuckDB fixture (`data/fixtures/nba.ci.duckdb`, ~2.8 MB) from the full local database:
- Sources from `unified_star` schema (the canonical, fully-populated star tier).
- Selects a curated game set: a dedup regression game (`0022000619`), a shots test game (`0032300001`), a non-FG xy event game (`0021900120`), plus the 25 most recent games.
- Pulls 7 fact/dimension tables: `dim_game`, `dim_team`, `dim_player`, `fact_player_game_boxscore`, `fact_pbp_events`, `fact_player_awards`, `fact_player_season_stats`.
- Seeds with 2 hallmark players: LeBron James (`2544`) and Bob Cousy (`77` — tests null advanced metrics).
- ATTACHes the source DB read-only, copies subset data, DETACHes, runs CHECKPOINT.

### Branch Protection (`apply-branch-protection.sh`)
Uses `gh api` to PUT branch protection on `main`: requires the aggregate "CI" status check, strict mode, no force pushes, no deletions.

## Flow

```
Pre-commit hooks (Lefthook → biome check --write)
  │
  ▼
GitHub Actions (ci.yml)
  ├── ci-guards.sh           (focused tests? snapshot update? biome warnings?)
  ├── build-ci-fixture.ts    (done at fixture-build time, not per-PR)
  └── bun run ci             (lint, format:check, typecheck, unit tests, audit)
```

## Integration
- **Consumed by**: `.github/workflows/ci.yml` — calls `ci-guards.sh` as a pre-test step.
- **Invoked by**: `bun run ci` → runs full CI suite (lint + format:check + typecheck + test + audit).
- **Fixture usage**: `resolveDbPath()` in `packages/data/src/shared/dbPath.ts` auto-selects the CI fixture when `CI=true` or `GITHUB_ACTIONS=true`.
- **Fixture build**: `bun run fixture:build` runs `bun run scripts/ci/build-ci-fixture.ts`.
- **No external API dependencies**: All scripts operate locally or via Biome/gh CLIs.
