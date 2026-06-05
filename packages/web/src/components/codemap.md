# packages/web/src/components/

## Responsibility

Three reusable UI components that collectively power the **SQL Sandbox** route (`/sql-sandbox`):
a live-editing SQL editor, a read-only schema browser tree, and a query-results data table.
All are inert presentational components — they hold no DB connection, no server state,
and delegate all I/O to their parent route via callback props.

## Components

### `CodeEditor` (`code-editor.tsx`)
- **Role**: CodeMirror 6 wrapper providing a SQL text editor with PostgreSQL dialect, line numbers, active-line highlight, and One Dark theme.
- **Props**:
  | Prop | Type | Purpose |
  |------|------|---------|
  | `value` | `string` | Controlled editor content (from parent state) |
  | `onChange` | `(value: string) => void` | Fired on every document change; parent stores `sqlText` |
  | `onRun` | `() => void` | Fired on `Ctrl+Enter` / `Cmd+Enter`; parent triggers `runQueryFn` |
  | `completer?` | `(ctx: CompletionContext) => { from, options } \| null` | Optional auto-completion override injected by parent (e.g. table/column names) |
- **Internals**: Creates `EditorState` + `EditorView` in a `useEffect` (mounts once per `value` snapshot). A second `useEffect` syncs external `value` changes back into the editor via `view.dispatch({ changes })` without destroying the view. Maintains a `onRunRef` to keep the callback fresh without re-mounting the editor.
- **Edge cases**: If `value` differs from editor state on external update, the diff-sync effect re-dispatches. Keyboard handler is cleaned up on unmount.

### `SchemaTree` (`schema-tree.tsx`)
- **Role**: Recursive accordion tree that renders a nested `Schema` → `Table` → `Column` hierarchy. Users click table names to append `SELECT * FROM table` to the editor, or column names to append `, column_name`.
- **Props**:
  | Prop | Type | Purpose |
  |------|------|---------|
  | `nodes` | `SchemaNode[]` | Root-level schemas with nested children |
  | `onSelectTable` | `(tableName: string) => void` | Called when a table row is clicked |
  | `onSelectColumn` | `(tableName: string, columnName: string) => void` | Called when a column leaf is clicked |
- **Types**:
  ```ts
  interface SchemaNode {
    name: string;
    type: 'schema' | 'table' | 'column';
    children?: SchemaNode[];
    expanded?: boolean;     // initial state hint
  }
  ```
- **Internals**: Recursive `TreeNode` sub-component uses local `useState<boolean>` for expand/collapse toggle. Column nodes render as plain buttons; schema/table nodes have toggle arrows (`▶`/`▼`). `parentTable` is passed down via recursion.
- **Edge cases**: Column clicks require a valid `parentTable` (non-null); the guard `parentTable && onSelectColumn(parentTable, node.name)` silently drops orphan column clicks.

### `ResultsTable` (`results-table.tsx`)
- **Role**: TanStack React Table v8 wrapper that renders an array of flat row objects into a styled HTML table with auto-generated columns from the first row's keys.
- **Props**:
  | Prop | Type | Purpose |
  |------|------|---------|
  | `data` | `Record<string, unknown>[]` | Query result rows |
  | `loading` | `boolean` | When `true`, shows "Executing query..." placeholder |
  | `error` | `string \| null` | When non-null, shows a red error banner |
  | `elapsedMs?` | `number` | Optional timing footer (`N rows · Xms`) |
- **Internals**: Uses `useReactTable` with `getCoreRowModel()` (no filtering/sorting/pagination). Columns are derived dynamically: `Object.keys(data[0])` → `columnHelper.accessor(...)`. Memoized via `useMemo`. Renders four states:
  1. `loading` → spinner text
  2. `error` → styled error div
  3. `data.length === 0` → "no results" text
  4. Normal → full table with header groups + row body + optional timing bar
- **Edge cases**: Zero-length data renders a static empty div rather than a zero-row table. `NULL`/`undefined` cells render as `<span className="text-fg-dim">NULL</span>`.

## Integration

**Single consumer**: the route at `packages/web/src/routes/sql-sandbox.tsx` (`/sql-sandbox`).

```
┌─────────────────────────────────────────────────────────┐
│  SqlSandboxPage (route component)                       │
│                                                          │
│  ┌────────────┐  ┌──────────────────────────────────┐   │
│  │ SchemaTree │  │ CodeEditor  (h-40)               │   │
│  │ (w-56)     │  │  value={sqlText}                 │   │
│  │            │  │  onChange={setSqlText}            │   │
│  │            │  │  onRun={runQuery}                 │   │
│  │            │  └──────────────────────────────────┘   │
│  │            │  ┌──────────────────────────────────┐   │
│  │            │  │ ResultsTable  (flex-1)            │   │
│  │            │  │  data={results?.rows ?? []}       │   │
│  │            │  │  loading={loading}                │   │
│  │            │  │  error={error}                    │   │
│  │            │  │  elapsedMs={results?.elapsedMs}   │   │
│  │            │  └──────────────────────────────────┘   │
│  └────────────┘                                        │
│                                                          │
│  runQuery → createServerFn('POST') → data package→DuckDB│
└─────────────────────────────────────────────────────────┘
```

### Data flow

1. User types SQL in `CodeEditor` → `onChange` → `sqlText` state in `SqlSandboxPage`.
2. User clicks a table in `SchemaTree` → `onSelectTable` → appends `SELECT * FROM table` to `sqlText`.
   User clicks a column → appends `, column_name`.
3. User presses `Ctrl+Enter` or clicks Run → `runQuery` callback:
   - Sets `loading=true`, clears previous error/results.
   - Calls `runQueryFn` (a `createServerFn` with `POST` method) that resolves the DuckDB path via `resolveDbPath()` and delegates to the `data` package's `query()`.
   - On success: stores `{ rows, elapsedMs }` in state.
   - On error: stores error string.
   - Abort controller cancels in-flight queries.
4. `ResultsTable` reactively renders the results.

### Package boundary

These three components are the **only** UI components imported from `packages/web/src/routes/`. They sit inside `packages/web` and do **not** import from `packages/data` directly — all DB calls are handled by server functions in the route. This keeps the component layer cleanly separated from the data-access layer.

### Styling contract

All components use Tailwind semantic color tokens (`fg`, `fg-dim`, `fg-muted`, `bg`, `surface`, `surface-alt`, `border`, `primary`, `danger`) defined in the shared theme (see `packages/web/src/shared/theme`). No raw color values.
