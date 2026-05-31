# Data & Database

## Database Artifacts

| File | Size | In Git? | Purpose |
|------|------|---------|---------|
| `data/nba.duckdb` | ~21.7 GB | No (gitignored) | Full local NBA warehouse (509 tables, 12 schemas) |
| `data/fixtures/nba.ci.duckdb` | ~2.8 MB | Yes (committed) | Pruned CI fixture with representative games, players, shots, awards |
| `data/nba.duckdb.bak*` | varies | No (gitignored) | Backup copies |
| `data/**/*.wal` | varies | No (gitignored) | DuckDB write-ahead logs |
| `data/**/*.wal.bad*` / `*.wal.tmp*` | small | No (gitignored) | Corrupted/temp WAL spill-over |

## Full Database

The full database is a medallion-architecture DuckDB warehouse spanning 509 tables/views across 12 schemas, ~414M rows, ~21.7 GB. It is **not committed to Git** (see `.gitignore`).

### Source

- `nbadb` star tier: public contract at [nbadb.w4w.dev](https://nbadb.w4w.dev/docs/schema), built from [wyattowalsh/nbadb](https://github.com/wyattowalsh/nbadb) (NBA API data).
- `raw_bref` / `stg_bref`: Basketball-Reference data (BBallGenius extension).
- `unified_star`, `api`, `xref`: Cross-source merge + convenience views.
- `meta`: Semantic catalog (`stat_crosswalk`).
- `audit`: Data-quality + reconciliation results.

### Data Quality

Run internal-consistency checks with:

```bash
bun run dq           # All checks, persist to audit.dq_results, gate on CRITICAL
bun run dq:gate      # Also fail on HIGH violations
bun run dq:accuracy  # Cross-source accuracy reconciliation pipeline
bun run dq:full      # Accuracy reconciliation + HIGH gate (used in CI full-DB job)
```

The DQ suite covers uniqueness, referential integrity, consistency, validity, and completeness over the `nbadb` star tier.

## CI Fixture

A small, deterministic DuckDB database (~2.8 MB) is committed at `data/fixtures/nba.ci.duckdb` for CI integration tests. It contains:

- Representative games, players (LeBron James, Bob Cousy), shots, and awards
- A subset of the full warehouse schema

### Regenerating the Fixture

When the full DB schema changes substantially, rebuild the fixture:

```bash
bun run fixture:build
```

This subsets the local `data/nba.duckdb` and runs `CHECKPOINT` to avoid WAL commits.

### CI Path Resolution

Both the hub and chatbot resolve the DB path via `src/shared/dbPath.ts`:

1. `process.env.NBA_DUCKDB_PATH` (highest priority)
2. If `CI=true` or `GITHUB_ACTIONS=true` and `data/fixtures/nba.ci.duckdb` exists → CI fixture
3. Else `data/nba.duckdb`

CI jobs set `NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb` explicitly. Snapshot regeneration must also use the CI fixture path.

## DuckDB Conventions

- **WAL flushing**: Scripts that write to DuckDB must call `await conn.run('CHECKPOINT')` after writes to flush the write-ahead log and avoid cross-process replay bugs.
- **Read-only runtime**: The hub and chatbot open DuckDB **read-only** at runtime (see `src/core/db.ts` and `src/tabs/chatbot/db.ts`). This allows multiple processes to read concurrently.
- **Column verification**: Always verify column names and types against `information_schema` before writing warehouse SQL. Column-shape assumptions (e.g., OT columns only present in `fact_game_result`, not `fact_team_game`) cause false positives.

## Ignored Artifacts

These are always gitignored and must never be committed:

- `data/nba.duckdb` and its backups/WALs
- `bbr-screenshots/` (Firecrawl PNG + JSON mirrors)
- `.firecrawl/` (Firecrawl markdown cache, map artifacts)
- `data/chatbot-metrics.ndjson` (LLM metrics)
- Locally generated schema references (`NBA_DB_SCHEMA_REFERENCE.md`, crosswalk CSVs)
