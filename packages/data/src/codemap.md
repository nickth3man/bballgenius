# `packages/data/src/`

## Responsibility
**Data Package Source Root** — The public entry point for the `@bballgenius/data` package. Re-exports the most commonly used Data Access Layer functions and types from `core/` and `shared/` as a convenience barrel. Finer-grained imports are available via subpath exports defined in `package.json`.

## Design

### Entry Point (`index.ts`)

The root `index.ts` provides a curated public surface that covers the most frequently used imports:

```typescript
// Database connection
export { closeDb, getColumns, getTables, initDb, query } from './core/db.js';

// Types
export type { DbRow, SqlParam, TableDataRow } from './core/types.js';

// Shared utilities
export { resolveDbPath } from './shared/dbPath.js';
export { formatTable, stripAnsi } from './shared/formatters.js';
export { validateReadOnlySql } from './shared/sqlValidation.js';
export { isNoColor, Theme } from './shared/theme.js';
```

### Structure
```
src/
├── index.ts          # Public barrel (main entry)
├── core/             # DuckDB connection, types, errors
│   ├── db.ts         # Singleton DuckDB connection + query
│   ├── dbHonors.ts   # Optional honors database
│   ├── errors.ts     # Re-exports shared/errors
│   └── types.ts      # DbRow, SqlParam, TableDataRow
├── shared/           # Framework-agnostic utilities
│   ├── dbPath.ts     # Multi-strategy DB path resolver
│   ├── errors.ts     # Safe error-to-string
│   ├── formatters.ts # Table + half-court formatting
│   ├── sqlValidation.ts  # Read-only SQL gate
│   └── theme.ts      # TokyoNight ANSI color system
└── tabs/             # Feature-area data access modules
    ├── chatbot/      # LangGraph agent + tools + eval
    ├── gameCenter/   # Recent games, box scores, shots
    ├── sqlSandbox/   # Ad-hoc SQL, schema browser, autocomplete
    └── timeMachine/  # Player dossier + team queries
```

## Integration

### Consumed as the default export
- When consumers import `data` (without subpath), they get the barrel from `./src/index.ts`
- This is configured by `"main": "./src/index.ts"` in `package.json`

### Subpath exports
For granular imports, consumers use subpath exports (e.g., `import { query } from 'data/db'`) which bypass this barrel and go directly to the source modules as defined in `package.json`'s `"exports"` field.

### Consumers
- **`packages/web`** — imports from `data` and its subpath exports for all UI features
- **Eval scripts** (`scripts/eval/`) — import chatbot internals directly from `packages/data/src/tabs/chatbot/...`
