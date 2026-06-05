# packages/data/src/shared/

## Responsibility

Cross-cutting utility layer for the `data` package. Owns framework-agnostic primitives that
both the web package and internal data modules depend on: DB path resolution, terminal/UI
formatting, theme tokens, and error helpers. Nothing in this folder touches DuckDB or the
LangGraph agent graph.

## Design

Four single-purpose modules, no coupling between them:

| File | Export | Role |
|------|--------|------|
| `dbPath.ts` | `resolveDbPath()` | CI-aware DuckDB path resolver (env var → CI fixture → default) |
| `errors.ts` | `getErrorMessage()` | Type-safe extraction of human-readable messages from `unknown` |
| `formatters.ts` | `formatTable()`, `drawHalfCourt()`, `stripAnsi()` | Table grid rendering (Unicode borders, smart numeric alignment) + half-court ASCII shot chart |
| `theme.ts` | `Theme`, `isNoColor()`, ANSI color functions | TokyoNight palette, `NO_COLOR` support, 24-bit ANSI wrap helpers |

**Key decisions:**
- **`resolveDbPath()`** walks up to the monorepo root by scanning for `"workspaces"` in `package.json`, not a hardcoded relative path — portable across package launches.
- **`formatters.ts`** uses `TableDataRow` from `../core/types.js` but is otherwise dependency-free. ANSI color utilities come from sibling `theme.ts`.
- **`theme.ts`** respects the [`NO_COLOR`](https://no-color.org/) convention and short-circuits all ANSI wrapping when set.
- **Exported via `package.json` subpath exports**: `data/dbPath`, `data/formatters`, `data/theme`, `data/errors`, plus the top-level `data` barrel.

## Flow

```
env(NBA_DUCKDB_PATH) ────┐
CI / GITHUB_ACTIONS  ─────┤──→ resolveDbPath() → DuckDB connection (core/db.ts, chatbot/db.ts)
monorepo root walk   ─────┘

unknown error ──→ getErrorMessage() ──→ core/errors.ts (re-exported)

TableDataRow ──→ formatTable() ──→ string[] (terminal/web table)
Shot data   ──→ drawHalfCourt() ──→ string[] (ANSI shot chart)
                          ↑
                    theme.ts (ansiGreen, ansiRed, …)
```

**No state held.** All functions are stateless/pure (except `resolveDbPath` which reads env + filesystem once at module-load time).

## Integration

### Consumers (within `packages/data/src`)

| Consumer | Shared module imported |
|----------|----------------------|
| `core/db.ts` | `dbPath.ts` — `resolveDbPath()` |
| `core/errors.ts` | `errors.ts` — re-exports `getErrorMessage()` |
| `tabs/chatbot/db.ts` | `dbPath.ts` — `resolveDbPath()` |
| `tabs/sqlSandbox/autocomplete.ts` | `theme.ts` — `ansiDim()` |
| `shared/formatters.ts` (sibling) | `theme.ts` — ANSI color functions |

### Consumers (via `package.json` subpath / barrel)

- **`data/index.ts`** re-exports `resolveDbPath`, `formatTable`, `stripAnsi`, `isNoColor`, `Theme` — the public surface consumed by `packages/web` routes via `import { ... } from 'data'`.
- Any external consumer can import directly via `import { resolveDbPath } from 'data/dbPath'`.
