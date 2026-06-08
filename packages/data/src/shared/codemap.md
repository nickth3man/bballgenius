# `packages/data/src/shared/`

## Responsibility
**Shared Utilities Layer** — Framework-agnostic helpers used across the data package and web package. Contains the database path resolver, error formatting, terminal/UI theme, SQL validation, and table/formatting utilities. None of these modules have DuckDB imports, so they are safe to bundle into browser code without pulling in native addons.

## Design

### Database Path Resolution (`dbPath.ts`)

**Strategy Pattern** — `resolveDbPath()` uses a priority-chain strategy:

1. `NBA_DUCKDB_PATH` env var (highest priority, for testing/override)
2. CI fixture at `data/fixtures/nba.ci.duckdb` when `CI=true` or `GITHUB_ACTIONS=true` (CI compatibility)
3. Default path `data/nba.duckdb` (production)

The monorepo root is discovered by walking up the directory tree from `process.cwd()` looking for a `package.json` with a `"workspaces"` key, making the resolver independent of which package the caller was launched from.

**Key outputs:**
- `resolveDbPath(): string` — returns the active database path
- `REPO_ROOT`, `DEFAULT_DB_PATH`, `CI_FIXTURE_PATH` — internal constants

### Theme (`theme.ts`)
**TokyoNight Color System** — Defines the visual identity for terminal output:
- `Theme` object with 18 color properties (primary, secondary, accent, success, error, foreground/background variants)
- `ThemeFgRole` type (union of 9 role strings)
- `themeFg(role, text)` — 24-bit RGB foreground via ANSI escape codes
- Named ANSI wrappers: `ansiBold`, `ansiDim`, `ansiItalic`, `ansiUnderline`, `ansiGreen`, `ansiRed`, `ansiYellow`, `ansiCyan`, `ansiMagenta`, `ansiBrightGreen`, `ansiBrightRed`
- `isNoColor()` — runtime check for `NO_COLOR` env var (https://no-color.org/)
- `noColor` — static boolean (prefer `isNoColor()` for dynamic checks)

### Formatters (`formatters.ts`)
**Presentation Layer** — Terminal-friendly grid and shot-chart rendering:

- `formatTable(headers, rows, options?)` — Unicode box-drawing table with automatic numeric alignment detection (if >50% of column values are numeric, right-align). Supports both object arrays (`DbRow[]`) and array-of-arrays. Returns `string[]` (one line per row). Uses `┌─┬─┐` / `│ │` / `└─┴─┘` borders.
- `drawHalfCourt(shots, activePlayerId?)` — 18×40 ASCII half-court basketball diagram with overlaid shot locations. Makes shown as `o` (green), misses as `x` (red), highlighted player shots use bright variants. Court includes baseline, sidelines, half-court line, paint (key), backboard/hoop, three-point line/arc, and corner-three lines. Database coordinates (0-100) are normalized to grid positions.
- `stripAnsi(text)` — removes ANSI escape sequences

### SQL Validation (`sqlValidation.ts`)
**Security Gate** — Read-only SQL enforcement for LLM-generated queries:
- `validateReadOnlySql(sql)` — returns `null` on pass or an error string on failure. Checks:
  1. Strips SQL comments (`--` and `/* */`)
  2. Rejects empty SQL or multi-statement SQL (contains `;`)
  3. Rejects non-SELECT/WITH/DESCRIBE statements
  4. Rejects blocked patterns: `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `CREATE`, `DROP`, `ALTER`, `TRUNCATE`, `ATTACH`, `DETACH`, `COPY`, `LOAD`, `INSTALL`, `SET`, `CALL`, `PRAGMA`, `VACUUM`, `CHECKPOINT`, `EXPORT`, `IMPORT`, `read_csv`, `read_json`, `read_parquet`, `read_text`, `glob`, `httpfs`
- `BLOCKED_SQL_PATTERNS` — exported for external use
- `stripSqlComments(sql)` — comment-stripping utility

### Error Formatting (`errors.ts`)
- `getErrorMessage(error: unknown): string` — safe error-to-string conversion (`instanceof Error` check, falls back to `String()`)

## Flow

```
resolveDbPath()
  │
  ├── NBA_DUCKDB_PATH set? → return that
  ├── CI/GitHub Actions + fixture exists? → return CI_FIXTURE_PATH
  └── default → REPO_ROOT + 'data/nba.duckdb'

validateReadOnlySql(sql)
  │
  ├── strip comments → check empty/multi-stmt → check SELECT/WITH/DESCRIBE → check blocked patterns
  └── null = pass | string = error message

formatTable(headers, rows)
  │
  └── measure column widths → detect numeric columns → build Unicode border grid → return string[]
```

## Integration

### Consumed by
- **`core/db.ts`** — imports `resolveDbPath()` for connection initialization
- **`tabs/chatbot/db.ts`** — imports `resolveDbPath()` for chatbot's own DuckDB instance
- **`tabs/chatbot/utils/sql.ts`** — imports `validateReadOnlySql()` for the chatbot's SQL safety gate
- **`tabs/chatbot/utils/theme.ts`** — re-exports `isNoColor`, `Theme` from this module
- **`tabs/sqlSandbox/autocomplete.ts`** — imports `ansiDim` from theme
- **`packages/data/src/index.ts`** — re-exports `resolveDbPath`, `formatTable`, `stripAnsi`, `validateReadOnlySql`, `isNoColor`, `Theme`

### Exported via package.json subpath exports
- `data/dbPath` → `./src/shared/dbPath.ts`
- `data/errors` → `./src/shared/errors.ts`
- `data/sqlValidation` → `./src/shared/sqlValidation.ts`
- `data/formatters` → `./src/shared/formatters.ts`
- `data/theme` → `./src/shared/theme.ts`
