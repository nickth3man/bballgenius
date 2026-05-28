# AGENTS.md — hub

## Package Purpose

Terminal NBA analytics hub with keyboard-driven TUI (OpenTUI), DuckDB backend, and three tabs: Game Center, Career Time-Machine, SQL Sandbox.

## Architecture

```
src/hub/index.ts → appShell → tabRegistry → activeTab → queries.ts → db.ts → DuckDB
```

### Core Module

| Module | Purpose |
|--------|---------|
| `index.ts` | TUI bootstrap: `initDb()`, `createCliRenderer()` @ 30 FPS, `createAppShell()` |
| `core/appShell.ts` | Keyboard routing, tab header bar, help overlay (`?`), footer status, tab visibility |
| `core/db.ts` | DuckDB singleton: `query<T>(sql, params?)`, `getTables()`, `getColumns()`, `closeDb()` |
| `core/dbHonors.ts` | Separate DuckDB for `v_player_honors_full` (optional, via `NBA_HONORS_DUCKDB_PATH`) |
| `core/errors.ts` | Error types for the hub |
| `core/types.ts` | Shared types |

### Tabs (`src/hub/tabs/`)

| Tab | ID | Shortcut | Purpose |
|-----|----|----------|---------|
| Game Center | `game-center` | F1 / 1 | Three-panel: game list / box score / shot chart |
| Career Time-Machine | `time-machine` | F2 / 2 | Player/team search, BBR mirror, dossier, honors |
| SQL Sandbox | `sql-sandbox` | F3 / 3 | Schema browser, SQL editor, autocomplete, Ctrl+R/Ctrl+E |

### Tab Contract (`src/hub/tabs/types.ts`)

Every tab implements `AppShellTab`:
```typescript
interface AppShellTab {
  id: string; name: string; container: BoxRenderable;
  focus(): void; init(): Promise<void>;
  cycleFocus(): void; cycleFocusBackward?(): void;
  getStatusLine?(): string;
  isInputFocused(): boolean; blurInput(): void;
  handleKeyPress(event: KeyEvent): boolean;
}
```

### Tab Registry (`src/hub/tabs/registry.ts`)

```typescript
TAB_REGISTRY = [
  { id: 'game-center', name: 'Game Center', shortcutIndex: 1, create: ... },
  { id: 'time-machine', name: 'Career Time-Machine', shortcutIndex: 2, create: ... },
  { id: 'sql-sandbox', name: 'SQL Sandbox', shortcutIndex: 3, create: ... },
]
```

## Module Map

```text
src/hub/
├── index.ts                # TUI bootstrap
├── core/
│   ├── appShell.ts         # Keyboard routing, tab header, help overlay, footer
│   ├── db.ts               # DuckDB singleton + query<T>()
│   ├── dbHonors.ts         # Optional honors DuckDB connection
│   ├── errors.ts           # Error types
│   └── types.ts            # Shared types
├── shared/
│   └── utils/
│       ├── formatters.ts   # Table formatting, ANSI stripping, half-court drawing
│       ├── theme.ts        # TokyoNight palette + 24-bit RGB + NO_COLOR support
│       ├── keyboardHelp.ts # Keyboard shortcut definitions
│       └── keyboard-map.json # Generated from keyboardHelp.ts
├── tabs/
│   ├── registry.ts         # TAB_REGISTRY + tab factory
│   ├── types.ts            # AppShellTab interface
│   ├── gameCenter/         # tab.ts, queries.ts (game list, box scores, shot charts)
│   ├── timeMachine/        # tab.ts, queries.ts, utils/bbr/ (BBR mirror)
│   └── sqlSandbox/         # tab.ts, queries.ts (schema browser, SQL editor)
└── tests/                  # Bun tests
    ├── formatters.test.ts      # Unit (no DB)
    ├── db.test.ts              # Integration (DB path, init, query)
    ├── tui_integration.test.ts # Integration (createTestRenderer)
    ├── spans_frame.test.ts     # Focus/tab routing
    ├── golden_snapshot.test.ts # Rendered frames vs snapshots
    ├── gameCenter.test.ts      # Integration
    ├── timeMachine.test.ts     # Integration
    ├── app_shell.test.ts       # Key routing, tab switching
    ├── regression.test.ts      # Known edge cases
    ├── mutation.test.ts        # Intentionally broken queries
    ├── keyboardHelp.test.ts    # Help text generation
    ├── bbrIntegration.test.ts  # BBR parsing (optional local fixtures)
    ├── helpers/
    │   └── tabs.ts             # getTab(shell, 'game-center') helper
    └── snapshots/              # Golden frame snapshots
```

## Key Patterns

### ANSI at the Boundary

Tabs build display strings with raw ANSI. `ansiToStyledText()` converts to OpenTUI `StyledText` before `TextRenderable` writes. This keeps layout stable and tests predictable.

### Tab Isolation

Tabs never import sibling tabs (enforced by CI guards). Each tab imports only from:
- `src/hub/core/*`
- `src/hub/shared/*`
- Its own `src/hub/tabs/<tabId>/` folder

### Singleton DB Connection

`initDb()` returns cached connection if one exists. Both hub and chatbot have independent singletons (they don't share DuckDB connections, only the path resolver in `src/shared/dbPath.ts`).

### Tab Factory Pattern

`TAB_REGISTRY` stores `TabDefinition` objects with `create` factories. `createAppShell()` iterates the registry to produce tab instances. Adding a tab requires only a registry entry + folder.

### SQL Queries per Tab

Each tab colocates SQL with its view controller in `tabs/<tabId>/queries.ts`:
- Typed interfaces for row shapes
- `load*()` wrappers around `query()`
- Parameterized via `$1`, `$2` bind parameters
- CTE-based deduplication

## Testing

All hub tests use `--concurrency=1` (DuckDB constraint).

```bash
# Full suite
bun test src/hub/tests --concurrency=1

# CI fixture (smaller DB)
NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb bun run ci:integration

# Single test file
bun test src/hub/tests/formatters.test.ts --concurrency=1
```

Golden snapshots regenerated with:
```bash
UPDATE_SNAPSHOTS=1 NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb bun test src/hub/tests/golden_snapshot.test.ts --concurrency=1
```

Use `createTestRenderer` for headless TUI testing. Use `makeTestKeyEvent()` from `appShell.ts` for injected keyboard events. Access tabs via `getTab(shell, 'game-center')` with stable string IDs.

## Adding a New Tab

1. Create `src/hub/tabs/<tabId>/` with `tab.ts`, `queries.ts` (if SQL needed), `index.ts`
2. Implement `AppShellTab` interface
3. Register in `TAB_REGISTRY` in `src/hub/tabs/registry.ts`
4. Add shortcuts in `KEYBOARD_MAP.tabs` in `src/hub/shared/utils/keyboardHelp.ts`
5. Run `bun run keyboard-map:sync`
6. Add tests using `getTab(shell, '<tab-id>')`

## Adding a Query Helper

1. Add to `tabs/<tabId>/queries.ts`
2. Define typed interface for the row shape
3. Use `query<T>(sql, params?)` from `core/db.ts`
4. Add test in `__tests__/` if query has edge cases

## Package Boundaries

- Hub tabs must not import sibling tabs
- Hub code must not import from `src/chatbot/`
- Hub can import from `src/shared/dbPath.ts`
- Repo-root assets resolved via relative paths up from `src/hub/`
