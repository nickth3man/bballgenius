# `packages/data/src/tabs/sqlSandbox/`

## Responsibility
**SQL Sandbox Data Access** — Provides the ad-hoc query execution, table/column schema browsing, and SQL autocomplete support for the SQL Sandbox UI feature.

## Design

### Modules

| Module | Type | Purpose |
|--------|------|---------|
| `queries.ts` | Data Access | Ad-hoc SQL execution + schema catalog loading |
| `autocomplete.ts` | Service | SQL keyword, table, and column autocomplete engine |
| `schemaBrowser.ts` | Service | Interactive schema tree browser with expand/collapse + filtering |

### Queries (`queries.ts`)
- `runSandboxQuery(sql: string): Promise<DbRow[]>` — Executes an arbitrary read-only SQL statement via `query<T>()`
- `loadSchemaCatalog()` — Loads ALL table names and their column metadata from the browsable schemas (`unified_star`, `main`) into a `Map<string, { name, type }[]>` for the schema browser
- Re-exports `getColumns`, `getTables` from `../../core/db.js`

### Autocomplete (`autocomplete.ts`)

**`SqlAutocomplete` class** — Stateful autocomplete engine:
- Maintains current suggestions list, selected index, loaded schema (tables + table columns)
- `loadSchema(tables, tableColumns)` — seeds the engine with database schema
- `update(query)` — computes suggestions based on the last word in the input:
  1. Splits query by whitespace/punctuation
  2. Takes the last word as the prefix
  3. Filters SQL keywords (SELECT, FROM, WHERE, JOIN, etc. — 35 keywords)
  4. Filters all loaded table names and column names
  5. Sorts: starts-with matches first, contains matches second
- `moveUp()` / `moveDown()` — navigate suggestions cyclically
- `accept(currentValue)` — replaces the last word with the selected suggestion
- `reset()` — clears state
- Returns `AutocompleteState` with suggestions, selected index, and ANSI-formatted suggestion line

### Schema Browser (`schemaBrowser.ts`)

**`SchemaBrowser` class** — Interactive tree browser with state:
- Maintains flat node list (`SchemaNode[]`), expanded table set, selected index, filter query
- `loadData(tables, tableColumns)` — seeds the engine
- `rebuild()` — rebuilds the node list applying the current filter:
  - Without filter: shows all tables as collapsed nodes
  - With filter: shows matching tables expanded with matching columns visible
  - Tables matching filter string are shown; non-matching tables are hidden
- `moveUp()` / `moveDown()` — navigate nodes cyclically
- `toggleTable(table)` — expand/collapse a table node
- `setFilter(query)` — sets text filter
- Returns `SchemaNode[]` where each node is `{ type: 'table', name }` or `{ type: 'column', name, tableName, columnType }`

## Flow

```
Web UI SQL Sandbox Page
  → loadSchemaCatalog() → { tables, tableColumns }
    ├── SqlAutocomplete.loadSchema(tables, tableColumns)
    │   └── SqlAutocomplete.update(query) → AutocompleteState
    └── SchemaBrowser.loadData(tables, tableColumns)
        └── SchemaBrowser.rebuild() → SchemaNode[]
            └── render in UI
```

## Integration

### Consumes
- `../../core/db.js` — `query<T>()`, `getTables()`, `getColumns()` for schema data
- `../../core/types.js` — `DbRow` type for query results
- `../../shared/theme.js` — `ansiDim()` for suggestion formatting

### Exported via package.json subpath exports
- `data/tabs/sql-sandbox/queries` → `./src/tabs/sqlSandbox/queries.ts`
- `data/tabs/sql-sandbox/autocomplete` → `./src/tabs/sqlSandbox/autocomplete.ts`
- `data/tabs/sql-sandbox/schema-browser` → `./src/tabs/sqlSandbox/schemaBrowser.ts`

### Consumers
- **`packages/web`** — SQL Sandbox route imports from these subpath exports
