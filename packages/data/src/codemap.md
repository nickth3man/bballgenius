# packages/data/src/

## Responsibility

Top-level directory of the `data` workspace package (`@bballgenius/data`). Owns all **framework-agnostic NBA data access, query logic, and the LangGraph chatbot agent**. Provides the DuckDB connectivity layer, shared formatting/primitives, and per-feature-area business queries consumed by the TanStack Start web app and CLI scripts. Has zero runtime dependency on `packages/web`.

## Design

### Barrel entry — `index.ts`

The file `index.ts` is the package's main entry point (referenced by `"main"` and `"."` in `package.json`). It re-exports the most-used symbols from `core/` and `shared/`:

| Source | Re-exports |
|--------|-----------|
| `core/db.js` | `closeDb`, `getColumns`, `getTables`, `initDb`, `query` |
| `core/types.js` | `DbRow`, `SqlParam`, `TableDataRow` |
| `shared/dbPath.js` | `resolveDbPath` |
| `shared/formatters.js` | `formatTable`, `stripAnsi` |
| `shared/theme.js` | `isNoColor`, `Theme` |

### Subpath exports (`package.json`)

Beyond the barrel, fine-grained subpath exports give direct access to tab-specific modules:

- `data/tabs/game-center/queries`
- `data/tabs/time-machine/queries`
- `data/tabs/sql-sandbox/queries` / `autocomplete` / `schema-browser`
- `data/tabs/chatbot/system-prompt` / `db` / `openrouter` / `agent` / `utils` / `eval`
- `data/db` — `core/db.ts` (DuckDB connection)
- `data/dbPath`, `data/errors`, `data/formatters`, `data/theme` — shared utilities

### Boundary rules

- **Tab isolation:** Tab modules under `tabs/<tabId>/` must not import sibling tabs; they import only from `core/`, `shared/`, and their own folder.
- **Web boundary:** `packages/web` imports via `data` barrel or subpath exports — never via relative paths into `packages/data/src/`.

## Files at this level

| Entry | Type | Role |
|-------|------|------|
| `index.ts` | File | Public barrel — re-exports core DB and shared utilities |
| `core/` | Directory | DuckDB connection, type aliases, error utilities. See `core/codemap.md` |
| `shared/` | Directory | Cross-cutting: `dbPath.ts`, `formatters.ts`, `theme.ts`, `errors.ts`. See `shared/codemap.md` |
| `tabs/` | Directory | Per-feature business queries: gameCenter, timeMachine, sqlSandbox, chatbot. See `tabs/codemap.md` |
| `codemap.md` | File | This file |

## Flow

```
packages/web (TanStack Start routes)
       │
       │ import { query, resolveDbPath, formatTable } from 'data'
       │   or  import { ... } from 'data/tabs/game-center/queries'
       ▼
┌─────────────────────────────────────────────┐
│         packages/data/src/ (this dir)        │
│                                              │
│  index.ts  (barrel re-exports)              │
│     │                                       │
│     ├── core/  ← DuckDB connections          │
│     │    └── db.ts, dbHonors.ts, types.ts    │
│     │         │                              │
│     │         ▼                              │
│     │    DuckDB (data/nba.duckdb)            │
│     │         │                              │
│     ├── shared/ ← formatting, dbPath, theme  │
│     │    └── dbPath.ts, formatters.ts,       │
│     │        theme.ts, errors.ts             │
│     │                                        │
│     └── tabs/ ← feature business queries     │
│          ├── gameCenter/queries.ts            │
│          ├── timeMachine/queries.ts           │
│          ├── sqlSandbox/queries.ts (+ utils)  │
│          └── chatbot/                        │
│               ├── agent/     (LangGraph graph)│
│               ├── db.ts      (chatbot conn)   │
│               ├── openrouter.ts               │
│               ├── systemPrompt.ts             │
│               ├── utils/                      │
│               └── eval/                       │
└─────────────────────────────────────────────┘
```

## Integration

- **Consumer `packages/web`** — The TanStack Start app imports the barrel (`import { query, ... } from 'data'`) or subpath exports (`import { ... } from 'data/tabs/game-center/queries'`) in its route handlers and server functions.
- **Consumer scripts** — Eval/smoke scripts at repo root (`scripts/eval/*`) import chatbot internals via deep relative paths (`packages/data/src/tabs/chatbot/...`), bypassing the workspace alias.
- **CI** — `resolveDbPath()` (from `shared/dbPath.ts`) detects `CI=true`/`GITHUB_ACTIONS=true` and routes to the committed fixture at `data/fixtures/nba.ci.duckdb`.
- **Child codemaps**:
  - `core/codemap.md` — Connection lifecycle, schema search path, honors DB secondary connection
  - `shared/codemap.md` — Stateless utilities, theme tokens, formatter details
  - `tabs/codemap.md` — Tab isolation, per-feature query surfaces, chatbot agent graph
