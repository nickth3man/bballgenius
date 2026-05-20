# CI DuckDB fixture

`nba.ci.duckdb` is a **minimal subset** of the full NBA database used in GitHub Actions and local `bun run ci:integration`. It is committed to git (~3 MB) so every PR can run all **80 integration tests** without the 1.5 GB `data/nba.duckdb`.

## What is included

Built by [`scripts/build-ci-fixture.ts`](../../scripts/build-ci-fixture.ts) from your local full database:

| Content | Purpose |
|---------|---------|
| ~28 recent games + 3 pinned games | Game Center, regression, visual tests |
| `0022000619` | Mutation test: undeduped `dim_team` join duplicates rows |
| `0032300001` | Shot chart / visual tests (many field-goal events) |
| `0021900120` | Mutation test: `is_field_goal` filter vs broken variant |
| Players `2544`, `77` | LeBron awards/stats; Bob Cousy null advanced metrics |
| Related teams, box scores, PBP, awards, season stats | All queries under `src/queries/` |

**Tables copied:** `dim_game`, `dim_team`, `dim_player`, `fact_player_game_boxscore`, `fact_pbp_events`, `fact_player_awards`, `fact_player_season_stats`.

## How the app and tests find this file

`src/db.ts` → `resolveDbPath()`:

1. `NBA_DUCKDB_PATH` environment variable (highest priority)
2. `data/fixtures/nba.ci.duckdb` when `CI=true` or `GITHUB_ACTIONS=true`
3. `data/nba.duckdb` otherwise (local dev / `bun start`)

CI sets `NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb` explicitly in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

## Rebuild (requires full local database)

You need `data/nba.duckdb` on disk (not in git). From the repo root:

```bash
bun run fixture:build
```

Optional overrides:

```bash
SOURCE_DB=data/nba.duckdb OUT_DB=data/fixtures/nba.ci.duckdb bun run scripts/build-ci-fixture.ts
```

The script runs `CHECKPOINT` so no `.wal` file is left beside the fixture.

Verify:

```bash
bun run ci:integration
```

## After changing fixture scope

If you edit `scripts/build-ci-fixture.ts` (extra games, players, or tables):

1. Rebuild: `bun run fixture:build`
2. Run integration: `bun run ci:integration`
3. Refresh golden snapshot if layout/data changed:

```bash
NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb UPDATE_SNAPSHOTS=1 \
  bun test src/tests/golden_snapshot.test.ts --concurrency=1
```

4. Commit `nba.ci.duckdb` and any updated snapshot under `src/tests/snapshots/`.

## Git

| Path | In git? |
|------|---------|
| `data/nba.duckdb` | No (gitignored, ~1.5 GB) |
| `data/fixtures/nba.ci.duckdb` | **Yes** (CI dependency) |
| `data/**/*.wal` | No (gitignored) |

See also the root [README.md](../../README.md) testing and CI sections.
