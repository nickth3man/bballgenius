# packages/data/src/tabs/sqlSandbox/

## Responsibility

Provides the DuckDB-powered SQL Sandbox backend: ad-hoc query execution, schema introspection for a tree browser, and a token-level autocomplete engine. These are consumed by the `packages/web/src/routes/sql-sandbox.tsx` route (TanStack Start server function).

## Design

Three modules, each exported as a separate `package.json` entry under `data/tabs/sql-sandbox/`:

### queries.ts — Query execution + schema catalog

Thin re-export layer over `../../core/db.ts`:

- **`runSandboxQuery(sql)`** — passes raw SQL string to `db.query<T>()` (read-only DuckDB connection). Returns `DbRow[]`.
- **`loadSchemaCatalog()`** — calls `db.getTables()` then iterates `db.getColumns(table)` for each table, building a `Map<table, {name, type}[]>`. Both `getTables` and `getColumns` are re-exported directly.
- Exports: `getColumns`, `getTables`, `runSandboxQuery`, `loadSchemaCatalog`.

**Constraint:** `getTables()` introspects the schemas listed in `db.ts`'s `BROWSE_SCHEMAS` constant (`['unified_star', 'main']`), not the full DuckDB catalog.

### autocomplete.ts — SqlAutocomplete class

Pure client-side state machine for SQL autocomplete. **Not yet wired into the web UI** (available as a data-layer helper for future adoption).

- **Keyword set:** 20+ SQL reserved words (`SELECT`, `FROM`, `WHERE`, `JOIN`, aggregate functions, etc.).
- **Schema candidates:** After `loadSchema(tables, tableColumns)` is called, all table names and column names are merged into the candidate list.
- **Matching:** Splits the current query buffer by whitespace/punctuation, takes the last word, and returns candidates that `startsWith` (prioritized) or `includes` the lowercased last word. Exact matches are excluded.
- **State:** `AutocompleteState` exposes `suggestions[]`, `selectedIdx`, `hasSuggestions`, and `formatted` (ANSI-styled string for terminal rendering).
- **Navigation:** `moveUp()`/`moveDown()` wrap cyclically. `accept()` replaces the trailing word in the editor buffer with the selected suggestion, preserving any preceding delimiter.
- **Dependency:** Only imports `ansiDim` from `../../shared/theme.js` for formatting.

### schemaBrowser.ts — SchemaBrowser class

Pure tree model for browsing DuckDB schemas → tables → columns. **Also not yet wired into the web UI** (the route currently uses a hardcoded `buildSampleSchema()` instead).

- **`loadData(tables, tableColumns)`** — seeds the table/column metadata.
- **`rebuild()`** — applies the current `filterQuery` (set via `setFilter`). A table node is included if its name matches the filter; column children appear only if the table is expanded **or** at least one column name matches the filter (auto-expand on filter match).
- **Tree structure:** Flat `SchemaNode[]` where each entry is either `{type: 'table', name}` or `{type: 'column', name, tableName, columnType}`. Columns always follow their parent table node in the array.
- **Navigation:** `moveUp()/moveDown()` traverse the flat node list with bounds clamping. `toggleTable()` adds/removes from `expandedTables` set.
- **Filter auto-expand:** When `filterQuery` is non-empty and a table has matching columns, the table automatically appears expanded (without modifying `expandedTables`). This ensures filtered results always show the matched columns.

## Flow

```
Web route (sql-sandbox.tsx)
        |
        | POST / (createServerFn)
        | imports 'data' → db.query(sql)
        v
   queries.ts::runSandboxQuery(sql)
        |
        | calls core/db.ts::query(sql)
        v
   DuckDB (read-only connection)
        |
        | returns DbRow[]
        v
   Web route renders ResultsTable
```

**Schema catalog flow (provisioned, not yet wired):**

```
loadSchemaCatalog()
        |
        | getTables() → string[]
        | for each: getColumns(table) → {name, type}[]
        v
   { tables: string[], tableColumns: Map }

         ┌───────────────────┐
         │  SqlAutocomplete  │  ← loadSchema(tables, tableColumns)
         │                   │     then update(queryString) → AutocompleteState
         └───────────────────┘

         ┌───────────────────┐
         │  SchemaBrowser    │  ← loadData(tables, tableColumns)
         │                   │     setFilter(text) → rebuild() → SchemaNode[]
         └───────────────────┘
```

## Integration

| Entry point (package.json) | Source | Consumed by |
|---|---|---|
| `data/tabs/sql-sandbox/queries` | `queries.ts` | Web route (indirectly via `data` index or directly) |
| `data/tabs/sql-sandbox/autocomplete` | `autocomplete.ts` | Provisioned for web; not yet wired |
| `data/tabs/sql-sandbox/schema-browser` | `schemaBrowser.ts` | Provisioned for web; not yet wired |

**Current web route behavior** (`sql-sandbox.tsx`):
- Executes SQL via `createServerFn` → `import('data')` → `db.query(sql)` — bypasses `runSandboxQuery()`.
- Schema tree is a hardcoded sample (`buildSampleSchema()`) with `dim_game`, `dim_player`, `dim_team`, `fact_player_game_stats`, `fact_team_game` under schemas `main` and `nbadb`.
- No autocomplete component exists in the current UI.
- AbortController-based query cancellation is supported client-side.

**Dependencies:** `../../core/db` (getTables, getColumns, query), `../../core/types` (DbRow), `../../shared/theme` (ansiDim). No imports from sibling tab modules.
