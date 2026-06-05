# scripts/ci/

## Responsibility

Three independent automation scripts that collectively gate and configure CI for the monorepo:

1. **`build-ci-fixture.ts`** — Constructs a minimal, committed DuckDB database (`data/fixtures/nba.ci.duckdb`, ~2.8 MB) pruned from the full local warehouse. Replaces the 21.7 GB `data/nba.duckdb` in CI so tests run against a portable, deterministic subset.
2. **`ci-guards.sh`** — Pre-merge guardrail that fails CI on focused/skipped tests, snapshot rewrites, or Biome warnings.
3. **`apply-branch-protection.sh`** — One-shot GitHub API script to enforce the aggregate "CI" status check on `main`.

## Design

**Fixture construction (`build-ci-fixture.ts`):** Sources from the `unified_star` schema (not `main`) because the runtime hub resolves unqualified names against `unified_star` first. The script selects:
- ~25 most recent games + three fixed test-game IDs (dedup edge-case `0022000619`, shot-chart visuals `0032300001`, non-FG xy events `0021900120`).
- Two fixed player IDs (`2544` LeBron, `77` Bob Cousy — the latter exercises null advanced-metric paths).
- All teams and players reachable from those games/awards/season-stats via set union.

Seven tables are copied (`CREATE TABLE ... AS SELECT * FROM src.unified_star.<t> WHERE ...`):
`dim_game`, `dim_team`, `dim_player`, `fact_player_game_boxscore`, `fact_pbp_events`, `fact_player_awards`, `fact_player_season_stats`.

**CHECKPOINT** is called after `DETACH src` to flush the WAL into the single-file DuckDB, avoiding phantom WAL commits that would bloat the fixture or break CI reproducibility.

**CI guards (`ci-guards.sh`):** Three independent failure modes — ripgrep for `.only`/`.skip(` under `packages/`, environment variable check for `UPDATE_SNAPSHOTS=1`, and Biome lint with `--max-diagnostics=500` failing on any warning.

**Branch protection (`apply-branch-protection.sh`):** Uses `gh api` to PUT branch protection on `main`, requiring the aggregate "CI" status check (from the `ci-success` workflow job) with strict (up-to-date) mode.

## Flow

1. (Human or automation) runs `bun run fixture:build` → `build-ci-fixture.ts` → attaches local `data/nba.duckdb` as read-only `src` → computes game/team/player subsets via SQL queries → creates 7 pruned tables in the new output DB → `DETACH src` → `CHECKPOINT` → writes `data/fixtures/nba.ci.duckdb`.
2. On every push/PR, GitHub Actions runs `ci-guards.sh` first (guards job). If it exits non-zero, the `ci-success` aggregation gate fails and blocks merge.
3. The `data-tests` job sets `NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb` and `CI=true`. The runtime path resolver (`packages/data/src/shared/dbPath.ts`) picks up the fixture via either the env var or the `CI=true` + `existsSync` fallback. Tests execute against the fixture with `concurrency=1` (DuckDB singleton).
4. The `dq-fixture` job runs `bun run dq:fixture` (data-quality smoke) against the same fixture.
5. `apply-branch-protection.sh` is run ad-hoc (not in CI workflow) to configure the GitHub branch protection rule.

## Integration

| Script | Called by | Produces / Consumes |
|--------|-----------|---------------------|
| `build-ci-fixture.ts` | `bun run fixture:build` (package.json script, human or ad-hoc) | **Produces** `data/fixtures/nba.ci.duckdb` committed to repo |
| `ci-guards.sh` | `.github/workflows/ci.yml` → `guards` job step | **Consumes** source files under `packages/`; **exits 1** on violations |
| `apply-branch-protection.sh` | Developer shell (ad-hoc) | **Consumes** `gh` CLI and admin token; **Writes** GitHub branch protection API |

**Fixture consumption chain:** `build-ci-fixture.ts` → `data/fixtures/nba.ci.duckdb` (committed artifact) → `resolveDbPath()` in `packages/data/src/shared/dbPath.ts` auto-selects it when `CI=true` or `GITHUB_ACTIONS=true` → consumed by `bun --filter data test` (data-tests job) and `bun run dq:fixture` (dq-fixture job).

The `ci-success` aggregation job in the workflow depends on all prior jobs (guards, lint, format, typecheck, data-tests, dq-fixture, audit, docs). The branch protection rule enforces that "CI" (this aggregate) must pass before merge.
