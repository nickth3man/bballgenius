# `packages/data/src/core/`

## Responsibility
**Data Access Layer** — Singleton-managed DuckDB connection pool and query execution for the main NBA warehouse (`data/nba.duckdb`), plus an optional secondary honors database (`NBA_HONORS_DUCKDB_PATH`). Provides the foundation all tab queries and the chatbot agent use to read the medallion-architecture warehouse.

## Design

### Singleton Connection Pattern (`db.ts`)
- **Lazy singleton** via module-scoped `instance`, `connection`, and `connecting` variables.
- `initDb()` is guarded by a cached promise (`connecting`) so concurrent callers share one initialization — the first caller creates the `DuckDBInstance` from cache (`DuckDBInstance.fromCache`) in read-only mode (`access_mode: 'READ_ONLY'`), all subsequent callers return the same connection.
- Failed init resets the singleton state (`connecting = null`, `instance = null`) so a retry can succeed.
- `closeDb()` disconnects synchronously (`disconnectSync()`) and resets all state, then calls `closeHonorsDb()`.

### Schema Search Path
- `SEARCH_PATH = 'unified_star,main'` — unqualified table names resolve against `unified_star` first, then `main`. This is set via `SET search_path = '...'` on connection.
- `BROWSE_SCHEMAS = ['unified_star', 'main']` — used by the SQL Sandbox browser for table/column introspection.

### Honors Database (`dbHonors.ts`)
- Optional secondary DuckDB instance for richer honors data (e.g., basketball-data nba.duckdb with `v_player_honors_full`).
- Uses the same lazy-singleton pattern as `db.ts` but returns `null` when `NBA_HONORS_DUCKDB_PATH` is unset or the file does not exist.
- `isHonorsDbConfigured()` returns `true` when the configured env var points at an existing file.

### Key Types (`types.ts`)
- `DbRow` — `Record<string, unknown>`, the JSON-safe row type returned by DuckDB `getRowObjectsJson()`.
- `SqlParam` — `DuckDBValue`, the parameter type for parameterized queries (`$1`, `$2`, etc.).
- `TableDataRow` — `DbRow | unknown[]`, accepted by `formatTable` (array or object rows).

### Error Re-export (`errors.ts`)
- Simply re-exports `getErrorMessage` from `../shared/errors.js` — a one-liner `error instanceof Error ? error.message : String(error)`.

## Flow

```
Web route / agent tool  ──►  query<T>(sql, params?)  ──►  initDb()  ──► DuckDBInstance.fromCache
                                        │                                    │
                                        ▼                                    ▼
                               conn.runAndReadAll()                  resolveDbPath() → data/nba.duckdb
                                        │                             or data/fixtures/nba.ci.duckdb
                                        ▼
                               reader.getRowObjectsJson()
                                        │
                                        ▼
                               T[] (typed row objects)
```

1. `resolveDbPath()` checks env var → CI fixture → default path.
2. `initDb()` creates a read-only DuckDB connection (singleton).
3. `query()` runs the SQL, optionally with bound parameters, and returns typed JSON row objects.
4. `getTables()` / `getColumns()` introspect `information_schema` for the SQL Sandbox.
5. `closeDb()` tears down both the main and honors DB connections.

For the honors DB: `queryHonors()` mirrors `query()` but returns `[]` when the secondary DB is not configured.

## Integration

### Consumes
- `@duckdb/node-api` — `DuckDBInstance`, `DuckDBConnection`, `DuckDBValue`
- `../shared/dbPath.js` — `resolveDbPath()` for CI-safe path resolution

### Exports (public surface)
- `initDb()`, `closeDb()`, `query()`, `getTables()`, `getColumns()` — primary DB access
- `resolveDbPath` — re-exported from shared
- `getErrorMessage` — re-exported from shared/errors
- `DbRow`, `SqlParam`, `TableDataRow` — types

### Consumers
- **All tab query modules** (`tabs/gameCenter/queries.ts`, `tabs/timeMachine/queries.ts`, `tabs/sqlSandbox/queries.ts`) import `query` from `../../core/db.js`
- **`packages/data/src/index.ts`** re-exports core functions as the package's public surface
- **`packages/web`** imports the subpath export `data/db` which maps to `./src/core/db.ts`
