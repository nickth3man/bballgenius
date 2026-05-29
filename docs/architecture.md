# Architecture

## System Overview

BBallGenius is a Bun monorepo with two production packages that share only a database path resolver.

```text
┌─────────────────────────────────────────────────────────────────┐
│                        bballgenius                               │
│                                                                  │
│  ┌──────────────────────┐     ┌──────────────────────────────┐  │
│  │     Hub (TUI)        │     │     Chatbot (TUI)            │  │
│  │  src/hub/            │     │  src/chatbot/                │  │
│  │                      │     │                              │  │
│  │  ┌────────────────┐  │     │  ┌────────────────────────┐  │  │
│  │  │  App Shell      │  │     │  │  Chat App              │  │  │
│  │  │  (key router,   │  │     │  │  (OpenTUI, streaming,  │  │  │
│  │  │   tab headers)  │  │     │  │   metrics)             │  │  │
│  │  └───────┬────────┘  │     │  └───────────┬────────────┘  │  │
│  │          │            │     │              │               │  │
│  │  ┌───────▼────────┐  │     │  ┌───────────▼────────────┐  │  │
│  │  │  Tab Registry   │  │     │  │  LangGraph Agent       │  │  │
│  │  │  ┌────────────┐ │  │     │  │  ┌──────────────────┐  │  │  │
│  │  │  │Game Center │ │  │     │  │  │ llm → tools →    │  │  │  │
│  │  │  │Time Machine│ │  │     │  │  │ sql_critic → llm │  │  │  │
│  │  │  │SQL Sandbox │ │  │     │  │  └──────────────────┘  │  │  │
│  │  │  └────────────┘ │  │     │  └────────────────────────┘  │  │
│  │  └───────┬────────┘  │     │              │               │  │
│  │          │            │     │  ┌───────────▼────────────┐  │  │
│  │  ┌───────▼────────┐  │     │  │  Tools                 │  │  │
│  │  │  Per-Tab SQL    │  │     │  │  query_nba_db          │  │  │
│  │  │  (queries.ts)   │  │     │  │  get_schema_info       │  │  │
│  │  └───────┬────────┘  │     │  └───────────┬────────────┘  │  │
│  │          │            │     │              │               │  │
│  │  ┌───────▼────────┐  │     │  ┌───────────▼────────────┐  │  │
│  │  │  Hub DB         │  │     │  │  Chatbot DB            │  │  │
│  │  │  (core/db.ts)   │  │     │  │  (db.ts)               │  │  │
│  │  └───────┬────────┘  │     │  └───────────┬────────────┘  │  │
│  └──────────┼───────────┘     └──────────────┼───────────────┘  │
│             │                                │                   │
│  ┌──────────▼────────────────────────────────▼───────────────┐  │
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

## Hub Architecture

### Rendering Pipeline

```text
index.ts
  ├── initDb()                    # DuckDB connection
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
              └── sql-sandbox/
                    ├── tab.ts
                    └── queries.ts
```

### Tab Isolation

Each tab lives in `src/hub/tabs/<tabId>/` and may only import from:

- `src/hub/core/*` (app shell, DB, types, errors)
- `src/hub/shared/*` (formatters, theme, keyboard help)
- Its own folder

Tabs must never import from sibling tabs. This is enforced by `scripts/ci-guards.sh`.

## Chatbot Architecture

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

`src/chatbot/utils/retry.ts` classifies SQL errors:

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

```text
PR opened / push to main
  │
  ├── guards          (static checks, no deps)
  ├── lint            (Biome)
  ├── format          (Biome format check)
  ├── typecheck       (tsc full repo)
  ├── unit            (hub formatters, no DB)
  ├── regression      (hub regression on CI fixture)
  ├── integration     (hub full suite on CI fixture)
  ├── chatbot         (strict typecheck + chatbot tests)
  └── audit           (bun audit --audit-level=moderate)
        │
        ▼
    ci-success        (aggregate: all must pass)
        │
        ▼
    integration-full  (manual: full database, workflow_dispatch only)
```

## Key Design Decisions

1. **Separate DuckDB connections**: Hub and chatbot each have their own DB connection. The hub uses a simpler connection; the chatbot has richer introspection (`getTableRefs()`, `getColumns()`).

2. **CI fixture**: A pruned ~2.8 MB DuckDB committed to the repo enables integration tests in CI without the 1.5 GB full database.

3. **Tab isolation**: Enforced by CI guards to prevent circular dependencies and keep tabs independently testable.

4. **Strict chatbot typecheck**: A separate `tsconfig.chatbot.json` with stricter options catches bugs that the base config misses, without slowing down hub development.

5. **LangGraph ReAct pattern**: The agent uses a ReAct loop with a SQL critic node for error correction, allowing up to 3 retries before giving up.

6. **Biome over ESLint + Prettier**: Single tool for linting and formatting reduces config complexity and ensures consistency.
