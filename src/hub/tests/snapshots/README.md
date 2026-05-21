# Golden frame snapshots

These text files store normalized `captureCharFrame()` output from OpenTUI test renders. They guard against unintended UI regressions in layout, copy, and ANSI handling.

## Files

| File | Captures |
|------|----------|
| `game_center_init.txt` | Game Center tab after `createAppShell()` + `initTabs()` at 80×24 |
| `time_machine_team_compare.txt` | Time Machine team mode, LAL 2025 vs PHI 2025 at 120×32 (footer normalized in test) |
| `sql_sandbox_schema_filter.txt` | SQL Sandbox with schema filter `dim_player` at 80×24 |

Test: `src/hub/tests/golden_snapshot.test.ts`.

## Database dependency

Golden tests call `initDb()` and load real game list data. **CI and committed snapshots use the CI fixture**, not the full 1.5 GB database:

```bash
NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb
```

If you regenerate against `data/nba.duckdb` locally, the snapshot will drift from what GitHub Actions expects. Always use the fixture unless you intentionally rebaseline everything (including rebuilding the fixture).

See [`data/fixtures/README.md`](../../../data/fixtures/README.md).

## Updating snapshots

When you intentionally change layout, colors, or copy and `golden_snapshot.test.ts` fails:

```bash
NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb UPDATE_SNAPSHOTS=1 \
  bun test src/hub/tests/golden_snapshot.test.ts --concurrency=1
```

`UPDATE_SNAPSHOTS=1` is blocked in CI by `scripts/ci-guards.sh`.

**Before committing:**

1. Review the full git diff on the `.txt` file (matchups, box score columns, footer text).
2. Confirm you used the CI fixture path above.
3. Run `bun run ci:integration` to ensure the new snapshot passes.

## Normalization

`normalizeFrameForSnapshot()` in `src/hub/tests/helpers/ansi.ts`:

- Normalizes line endings to `\n`
- Trims trailing spaces per line
- Collapses runs of 3+ blank lines to 2
- Trims trailing newline at end of file

Raw ANSI escape sequences should not appear in snapshots; production paths use `ansiToStyledText()` before render.

## Related commands

```bash
# Golden test only (read-only)
NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb \
  bun test src/hub/tests/golden_snapshot.test.ts --concurrency=1

# Broader regression bundle (shell, mutation, visual, golden)
bun run test:regression

# Full PR-equivalent integration
bun run ci:integration
```
