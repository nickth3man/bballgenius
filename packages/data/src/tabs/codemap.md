# `packages/data/src/tabs/`

## Responsibility
**Tab Orchestration Layer** — Organizational directory that groups the data access modules by feature area ("tabs"). Each subdirectory corresponds to a UI feature in the TanStack Start web app: Game Center, Time Machine (Career Dossier), SQL Sandbox, and Chatbot. This directory does not contain code directly — it serves as the namespace container for the four tab modules.

## Design

### Structure
```
tabs/
├── codemap.md
├── chatbot/          # LangGraph chatbot agent + SQL pipeline + eval
├── gameCenter/       # Recent games, box scores, shot charts
├── sqlSandbox/       # Ad-hoc SQL, schema browser, autocomplete
└── timeMachine/      # Player dossier (18 data sections), team queries
```

### Tab Boundary Rule
Per project convention, tab modules under `tabs/<tabId>/` **must not import sibling tab modules**. Each tab imports only from:
- `../../core/*` — DuckDB connection, types, errors
- `../../shared/*` — dbPath, formatters, theme, sqlValidation, errors
- Their own folder (e.g., `./groupAwards.js`, `./utils/*`)

### Package.json Subpath Exports
Each tab is exposed as a separate subpath export from the `data` package, enabling tree-shaking and preventing the web build from bundling unused code:

| Subpath | Directory | Export |
|---------|-----------|--------|
| `data/tabs/game-center/queries` | `gameCenter/queries.ts` | Recent games, box scores, shots |
| `data/tabs/time-machine/queries` | `timeMachine/queries.ts` | Full player dossier + team queries |
| `data/tabs/time-machine/group-awards` | `timeMachine/groupAwards.ts` | Pure award grouping helpers |
| `data/tabs/sql-sandbox/queries` | `sqlSandbox/queries.ts` | Ad-hoc SQL, schema catalog |
| `data/tabs/sql-sandbox/autocomplete` | `sqlSandbox/autocomplete.ts` | SQL autocomplete engine |
| `data/tabs/sql-sandbox/schema-browser` | `sqlSandbox/schemaBrowser.ts` | Schema tree browser |
| `data/tabs/chatbot/system-prompt` | `chatbot/systemPrompt.ts` | Dynamic prompt builder |
| `data/tabs/chatbot/db` | `chatbot/db.ts` | Chatbot-specific DuckDB access |
| `data/tabs/chatbot/openrouter` | `chatbot/openrouter.ts` | OpenRouter model config |
| `data/tabs/chatbot/agent` | `chatbot/agent/index.ts` | LangGraph graph, state, tools, streaming |
| `data/tabs/chatbot/utils` | `chatbot/utils/index.ts` | SQL pipeline, metrics, formatting |
| `data/tabs/chatbot/eval` | `chatbot/eval/index.ts` | Eval suite (100 queries, matrix, harness) |

## Integration

### Consumed by
- **`packages/web`** — imports tab modules via `data/tabs/<tab>/<module>` subpath exports in `package.json`

### Consumes
- **`../../core/db.js`** — used by `gameCenter`, `timeMachine`, `sqlSandbox` for `query<T>()`
- **`../../core/dbHonors.js`** — used by `timeMachine` for optional honors DB
- **`../../core/types.js`** — shared type definitions
- **`../../shared/*`** — shared utilities (dbPath, formatters, theme, sqlValidation, errors)
