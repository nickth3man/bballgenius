# Architecture

## System Overview

BBallGenius is a single Bun application for a terminal NBA analytics hub (OpenTUI + DuckDB). The app has four tabs under a unified `src/` tree.

```text
┌─────────────────────────────────────────────────────────────────┐
│                        bballgenius                               │
│                                                                  │
│  ┌──────────────────────┐     ┌──────────────────────────────┐  │
│  │     App Shell         │     │     Chatbot (TUI)            │  │
│  │  src/core/            │     │  src/tabs/chatbot/           │  │
│  │    appShell.ts        │     │                              │  │
│  │    db.ts              │     │  ┌────────────────────────┐  │  │
│  │    types.ts           │     │  │  Chat App              │  │  │
│  │    errors.ts          │     │  │  (OpenTUI, streaming,  │  │  │
│  │                       │     │  │   metrics)             │  │  │
│  │  ┌─────────────────┐  │     │  └───────────┬────────────┘  │  │
│  │  │  Tab Registry    │  │     │              │               │  │
│  │  │  src/tabs/       │  │     │  ┌───────────▼────────────┐  │  │
│  │  │  ┌─────────────┐ │  │     │  │  LangGraph Agent       │  │  │
│  │  │  │Game Center  │ │  │     │  │  (llm → tools →       │  │  │
│  │  │  │Time Machine │ │  │     │  │   sql_critic → llm)   │  │  │
│  │  │  │SQL Sandbox  │ │  │     │  └───────────┬────────────┘  │  │
│  │  │  └─────────────┘ │  │     │              │               │  │
│  │  └────────┬────────┘  │     │  ┌───────────▼────────────┐  │  │
│  │           │            │     │  │  Tools                 │  │  │
│  │  ┌────────▼────────┐  │     │  │  query_nba_db          │  │  │
│  │  │  Shared utilities│  │     │  │  get_schema_info       │  │  │
│  │  │  src/shared/     │  │     │  └───────────┬────────────┘  │  │
│  │  │   formatters.ts  │  │     │              │               │  │
│  │  │   dbPath.ts      │  │     │  ┌───────────▼────────────┐  │  │
│  │  │   theme.ts       │  │     │  │  Chatbot DB            │  │  │
│  │  └────────┬────────┘  │     │  │  (db.ts)               │  │  │
│  └───────────┼───────────┘     └──────────────┼───────────────┘  │
│              │                                │                   │
│  ┌───────────▼────────────────────────────────▼───────────────┐  │
│  │              src/shared/dbPath.ts                          │  │
│  │              (shared DB path resolver)                     │  │
│  └──────────────────────────┬────────────────────────────────┘  │
│                             │                                    │
│  ┌──────────────────────────▼────────────────────────────────┐  │
│  │              DuckDB                                        │  │
│  │  data/nba.duckdb (local) | data/fixtures/nba.ci.duckdb    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              OpenRouter API (chatbot only)                 │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Repository Structure

```text
src/
├── index.ts           # TUI bootstrap
├── core/              # AppShell, DB, DB honors, errors, types
├── shared/            # Shared utilities (formatters, theme, keyboardHelp, dbPath)
├── tabs/              # Tab registry + four tabs
│   ├── registry.ts
│   ├── gameCenter/    # F1: Game directory, box scores, shot charts
│   ├── timeMachine/   # F2: Player/team search, BBR mirror, dossier, honors
│   ├── sqlSandbox/    # F3: Schema browser, SQL editor, autocomplete
│   └── chatbot/       # F4: LangGraph-powered conversational NBA agent
│       ├── tab.ts     # AppShellTab adapter
│       ├── chatApp.ts # Chat UI controller (OpenTUI, streaming, metrics)
│       ├── db.ts      # DuckDB access + schema introspection
│       ├── openrouter.ts # OpenRouter API client
│       ├── systemPrompt.ts
│       ├── agent/     # LangGraph agent (graph, state, tools, model, streaming)
│       ├── utils/     # SQL, retry, metrics, ansi, theme
│       ├── features/  # Model selector
│       ├── eval/      # 100 categorized NBA test queries
│       └── __tests__/ # Bun tests with LangChain mocking
└── tests/             # Hub tests + snapshots/
```

## App Shell (src/core/)

### Rendering Pipeline

```text
index.ts
  ├── initDb()                    # DuckDB connection (read-only)
  ├── CliRenderer (30 FPS)        # OpenTUI rendering
  └── createAppShell()
        ├── keypress handler      # Global key routing
        ├── tab headers           # F-key / digit tab switching
        └── TAB_REGISTRY
              ├── game-center/
              │     ├── tab.ts        # UI rendering
              │     └── queries.ts    # SQL queries
              ├── time-machine/
              │     ├── tab.ts
              │     ├── queries.ts
              │     └── utils/bbr/    # BBR mirror views
              ├── sql-sandbox/
              │     ├── tab.ts
              │     └── queries.ts
              └── chatbot/
                    ├── tab.ts
                    └── agent/        # LangGraph ReAct agent
```

### Tab Isolation

Each tab lives in `src/tabs/<tabId>/` and may only import from:

- `src/core/*` (app shell, DB, types, errors)
- `src/shared/*` (formatters, theme, keyboard help, dbPath)
- Its own folder

Tabs must never import from sibling tabs. This is enforced by `scripts/ci/ci-guards.sh`.

## Chatbot Architecture (src/tabs/chatbot/)

### Agent Graph

```text
START
  │
  ▼
classify_intent ──── Deterministic keyword classification (no LLM)
  │
  ▼
llm ◄──────────────────────────────────────┐
  │                                         │
  ├──► [no tool calls] ──► END             │
  │                                         │
  └──► [tool calls] ──► tools              │
                            │                │
                            ▼                │
                        sql_critic           │
                            │                │
                     ┌──────┴──────┐         │
                     │             │         │
                [success]    [SQL error]     │
                     │             │         │
                     │        retries < 3?   │
                     │         │      │      │
                     │        yes    no      │
                     │         │      │      │
                     ▼         ▼      ▼      │
                    END      llm ────┘  END  │
                                     (retry) │
```

### State

`ChatbotState` contains:

- `messages` — conversation messages (LangChain MessagesValue)
- `sqlRetryCount` — SQL error retry counter (optional number)
- `intentCategory` — classified question category (optional string)

Do not add state fields unless a graph node reads/writes them.

### Streaming

`streamQuery()` in `streaming.ts` yields `StreamEvent` union types:

| Event | Payload |
|-------|---------|
| `token` | Text chunk from LLM |
| `tool_start` | Tool name + input |
| `tool_end` | Tool output |
| `tool_error` | Error message |
| `usage` | Token counts |
| `done` | Final answer |
| `error` | Unrecoverable error |

### Error Classification

`src/tabs/chatbot/utils/retry.ts` classifies SQL errors:

| Category | Action |
|----------|--------|
| Transient | Retry with backoff |
| Schema | Retry with corrected table/column names |
| Syntax | Retry with corrected SQL |
| Permanent | Stop, return error to user |

## Data Flow

### Hub Query Flow

```text
User keystroke → Tab handler → queries.ts (SQL) → DuckDB → Formatters → OpenTUI render
```

### Chatbot Query Flow

```text
User message → classify_intent → LLM (OpenRouter) → Tool call → DuckDB
    → sql_critic (validate) → LLM (format answer) → Streaming output → Chat UI
```

## CI/CD Pipeline

See `docs/ci.md` for the full pipeline description.

```text
PR opened / push to main
  │
  ├── guards             (static checks, Biome belt-and-suspenders)
  ├── lint               (Biome ci)
  ├── format             (Biome format check)
  ├── typecheck          (tsc src/)
  ├── typecheck-scripts  (tsc scripts/)
  ├── unit               (hub formatters, no DB)
  ├── regression         (hub regression + snapshots, CI fixture)
  ├── integration        (hub full suite, CI fixture)
  ├── chatbot            (chatbot tests, CI fixture)
  ├── test-scripts       (script tests, CI fixture)
  ├── dq-fixture         (DQ gate, CI fixture)
  ├── docs               (markdown lint)
  ├── audit              (bun audit --audit-level=moderate)
        │
        ▼
    ci-success           (aggregate: all must pass)
        │
        ▼
    integration-full     (manual: full database, workflow_dispatch only)
```

## Key Design Decisions

1. **Unified src/ tree**: A single application with four tabs under `src/tabs/`. No separate packages — tabs share `src/core/*` and `src/shared/*` but never import each other.

2. **Separate DuckDB connections**: Hub and chatbot each have their own read-only DB connection. The hub uses a simpler connection; the chatbot has richer introspection (`getTableRefs()`, `getColumns()`).

3. **CI fixture**: A pruned ~2.8 MB DuckDB committed to the repo enables integration tests in CI without the ~21.7 GB full database.

4. **Tab isolation**: Enforced by CI guards to prevent circular dependencies and keep tabs independently testable.

5. **LangGraph ReAct pattern**: The chatbot agent uses a ReAct loop with a SQL critic node for error correction, allowing up to 3 retries before giving up.

6. **Biome over ESLint + Prettier**: Single tool for linting and formatting reduces config complexity and ensures consistency.

7. **Data warehouse tiering**: Medallion architecture (`raw_*` → `stg_*` → `nbadb` star tier → `unified_star`/`api`) with cross-source BBR reconciliation. Data-quality checks in `audit` schema via `scripts/db/verify-dq.ts`.
