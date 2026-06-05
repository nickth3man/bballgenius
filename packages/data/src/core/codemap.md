# packages/data/src/core/

## Responsibility

Database connectivity, type aliases, and error utilities for the `data` workspace package. This folder owns the **runtime DuckDB connections** — it initialises, caches, and teardowns read-only connections to the NBA analytics database (and an optional secondary honors database). Every query in the hub ultimately passes through `query()` exported here. It does **not** execute business queries; those live in `src/tabs/*/queries.ts`.

## Files

| File | Role |
|------|------|
| `db.ts` | **Primary connection.** Singleton `DuckDBInstance` + `DuckDBConnection` opened read-only on first `initDb()` call. Exports `query()`, `getTables()`, `getColumns()`, `closeDb()`. Re-exports `resolveDbPath` from `src/shared/dbPath.ts`. |
| `dbHonors.ts` | **Optional secondary connection.** Same singleton pattern but gated on `NBA_HONORS_DUCKDB_PATH` env var. Used by Time Machine to pull richer accolade data from a separate DuckDB file. Exports `queryHonors()`, `isHonorsDbConfigured()`, `closeHonorsDb()`. |
| `types.ts` | Three type aliases — `DbRow` (`Record<string, unknown>`), `SqlParam` (`DuckDBValue` for parameterised SQL), `TableDataRow` (union for formatters). |
| `errors.ts` | Thin re-export: `getErrorMessage` from `src/shared/errors.js`. Present for ergonomic intra-package imports. |

## Design

- **Singleton-with-promise-dedup:** Both `db.ts` and `dbHonors.ts` cache the connection (module-level `let`) and also cache the in-flight promise (`connecting` / `honorsConnecting`). This prevents thundering-herd connection leaks when multiple callers race `initDb()` concurrently. A `.catch()` resets the cached promise so failures are retryable.
- **Read-only by default:** `DuckDBInstance.fromCache(path, { access_mode: 'READ_ONLY' })` is defense-in-depth — even if the chatbot's SQL-critic node were bypassed, the connection cannot mutate data.
- **Schema search path:** `SET search_path = 'unified_star,main'` resolves unqualified table names against the canonical star schema first (full production DB), falling back to `main` (CI fixture). The `SET` is wrapped in try/catch so CI works even without `unified_star`.
- **Browsable schemas:** `BROWSE_SCHEMAS = ['unified_star', 'main']` drives `getTables()` and `getColumns()` introspected by the SQL Sandbox browser. Deduplicated at the table level; column lookup iterates schemas in order and returns on first match.
- **Optional honors DB:** `dbHonors.ts` returns `[]` from `queryHonors()` when `NBA_HONORS_DUCKDB_PATH` is unset or the file doesn't exist, so callers don't need conditional branching. The primary `closeDb()` automatically calls `closeHonorsDb()`.

## Flow

```
          ┌─────────────────┐
          │  src/shared/    │
          │  dbPath.ts      │──── resolveDbPath() ──── env / CI / default
          └─────────────────┘
                   │
          ┌────────▼────────┐    first call            ┌──────────────────┐
          │    db.ts        │──── initDb() ────────────▶│ DuckDBInstance   │
          │    query()      │    caches promise+conn    │ (READ_ONLY)      │
          │    getTables()  │◀─────── conn ─────────────│ conn.connect()   │
          │    getColumns() │                           └──────────────────┘
          └────────┬────────┘
                   │ query(sql, params?) → DbRow[]
                   │
          ┌────────▼────────┐    if NBA_HONORS_DUCKDB_PATH set
          │  dbHonors.ts    │──── queryHonors() ───────▶ secondary DuckDB
          │  queryHonors()  │◀────────────────────────── (optional)
          └────────┬────────┘
                   │
          ┌────────▼────────┐
          │   src/tabs/     │  Business queries import `query` / `queryHonors`
          │  */queries.ts   │  and call with SQL strings + optional params.
          └─────────────────┘
```

## Integration

- **`src/tabs/*/queries.ts`** — Every tab (gameCenter, timeMachine, sqlSandbox, chatbot) imports `query` from `../core/db.js` (or `data/core/db` via workspace alias) to execute DuckDB SQL.
- **`src/shared/dbPath.ts`** — `resolveDbPath()` is the single source of truth for the DB path; `db.ts` re-exports it so consumers can import from one place.
- **`src/shared/errors.ts`** — `getErrorMessage` is re-exported via `errors.ts` for ergonomic access from tab code.
- **`packages/web/src/routes/api/copilotkit.ts`** — The chat endpoint calls `closeDb()` on shutdown via the agent lifecycle.
- **Time Machine** — `dbHonors.ts` provides the optional richer-honors connection; callers use `isHonorsDbConfigured()` to decide whether to render extra accolade columns.
