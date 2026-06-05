# Architecture

## System Overview

BBallGenius is a Bun workspace monorepo: a React web app (`packages/web`) backed by a shared data layer (`packages/data`) that owns DuckDB access, tab queries, and the LangGraph chatbot agent.

```text
┌─────────────────────────────────────────────────────────────────┐
│                        bballgenius                               │
│                                                                  │
│  ┌──────────────────────────────┐  ┌──────────────────────────┐ │
│  │  packages/web                │  │  packages/data           │ │
│  │  TanStack Start + React      │  │                          │ │
│  │                              │  │  ┌────────────────────┐  │ │
│  │  routes/                     │  │  │  Tab queries       │  │ │
│  │  ├── game-center             │──│──│  gameCenter/       │  │ │
│  │  ├── time-machine            │  │  │  timeMachine/      │  │ │
│  │  ├── sql-sandbox             │  │  │  sqlSandbox/       │  │ │
│  │  ├── chat                    │  │  └─────────┬──────────┘  │ │
│  │  └── api/copilotkit          │  │            │             │ │
│  │         │                    │  │  ┌─────────▼──────────┐  │ │
│  │         └────────────────────│──│──│  LangGraph Agent     │  │ │
│  │                              │  │  │  chatbot/agent/    │  │ │
│  │                              │  │  └─────────┬──────────┘  │ │
│  │                              │  │            │             │ │
│  │                              │  │  ┌─────────▼──────────┐  │ │
│  │                              │  │  │  DuckDB connections│  │ │
│  │                              │  │  │  core/db.ts        │  │ │
│  │                              │  │  │  chatbot/db.ts     │  │ │
│  │                              │  │  └─────────┬──────────┘  │ │
│  └──────────────────────────────┘  └────────────┼─────────────┘ │
│                                                 │               │
│  ┌──────────────────────────────────────────────▼─────────────┐ │
│  │  packages/data/src/shared/dbPath.ts                        │ │
│  └──────────────────────────────┬─────────────────────────────┘ │
│                                 │                               │
│  ┌──────────────────────────────▼─────────────────────────────┐ │
│  │  DuckDB                                                      │ │
│  │  data/nba.duckdb (local) | data/fixtures/nba.ci.duckdb      │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  OpenRouter API (chatbot only)                               │ │
│  └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Repository Structure

```text
packages/
├── web/
│   └── src/
│       ├── routes/          # TanStack Start file routes
│       │   ├── game-center.tsx
│       │   ├── time-machine.tsx
│       │   ├── sql-sandbox.tsx
│       │   ├── chat.tsx
│       │   └── api/copilotkit.ts
│       ├── components/      # Shared React components
│       └── styles/
└── data/
    └── src/
        ├── core/            # db.ts, dbHonors.ts, errors, types
        ├── shared/          # dbPath, formatters, theme
        └── tabs/
            ├── gameCenter/  # queries.ts
            ├── timeMachine/ # queries.ts, utils/bbr/
            ├── sqlSandbox/  # queries, autocomplete, schema browser
            └── chatbot/     # LangGraph agent + eval + tests
                ├── agent/   # graph, state, tools, model, streaming
                ├── db.ts
                ├── openrouter.ts
                ├── systemPrompt.ts
                ├── utils/   # SQL, retry, metrics
                └── eval/    # 100 categorized NBA test queries
```

## Web App (`packages/web`)

### Request Flow

```text
Browser → TanStack Router route → server loader / API handler
  → import from 'data/tabs/...' or 'data/db'
  → DuckDB query → JSON/HTML response → React render
```

### Routes

| Route | Data dependency | Purpose |
|-------|-----------------|---------|
| `/game-center` | `data/tabs/game-center/queries` | Games, box scores, shot charts |
| `/time-machine` | `data/tabs/time-machine/queries` | Player/team search, BBR mirror |
| `/sql-sandbox` | `data/tabs/sql-sandbox/*` | Schema browser, SQL editor |
| `/chat` | CopilotKit + agent | Conversational NBA agent |
| `/api/copilotkit` | LangGraph streaming | Server-side chat API |

### Package Exports

The `data` workspace package exposes stable entry points via `packages/data/package.json` `exports` map. Web code should import through these paths, not relative filesystem paths into `packages/data/src/`.

## Data Package (`packages/data`)

### Tab Isolation

Each tab lives in `packages/data/src/tabs/<tabId>/` and may only import from:

- `packages/data/src/core/*`
- `packages/data/src/shared/*`
- Its own folder

Tabs must never import from sibling tabs.

### DuckDB Connections

- **`core/db.ts`** — shared read-only connection for tab queries (Game Center, Time Machine, SQL Sandbox).
- **`tabs/chatbot/db.ts`** — separate read-only connection with richer introspection (`getTableRefs()`, `getColumns()`, `getTables()`).

Both resolve the database path via `shared/dbPath.ts`.

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

`packages/data/src/tabs/chatbot/utils/retry.ts` classifies SQL errors:

| Category | Action |
|----------|--------|
| Transient | Retry with backoff |
| Schema | Retry with corrected table/column names |
| Syntax | Retry with corrected SQL |
| Permanent | Stop, return error to user |

## Data Flow

### Web Query Flow

```text
User action → Route handler → data/tabs/*/queries.ts (SQL) → DuckDB → formatters → React UI
```

### Chatbot Query Flow

```text
User message → classify_intent → LLM (OpenRouter) → Tool call → DuckDB
    → sql_critic (validate) → LLM (format answer) → Streaming → Chat UI
```

## CI/CD Pipeline

See `docs/ci.md` for the full pipeline description.

```text
PR opened / push to main
  │
  ├── guards             (no .only/.skip under packages/, Biome warnings)
  ├── lint               (Biome ci on packages/ + scripts/)
  ├── format             (Biome format check)
  ├── typecheck          (packages/data)
  ├── typecheck-scripts  (root scripts/)
  ├── data-tests         (bun --filter data test, CI fixture)
  ├── dq-fixture         (DQ gate, CI fixture)
  ├── docs               (markdown lint)
  ├── audit              (bun audit --audit-level=moderate)
        │
        ▼
    ci-success           (aggregate: all must pass)
```

## Key Design Decisions

1. **Workspace split**: Web UI and data/agent logic are separate packages with explicit exports. The web app never reaches into data internals with relative paths.

2. **Separate DuckDB connections**: Tab queries and chatbot each have their own read-only DB connection. The chatbot connection has richer schema introspection for agent tools.

3. **CI fixture**: A pruned ~2.8 MB DuckDB committed to the repo enables tests in CI without the ~21.7 GB full database.

4. **Tab isolation**: Tab modules under `packages/data/src/tabs/` must not import sibling tabs, keeping query layers independently maintainable.

5. **LangGraph ReAct pattern**: The chatbot agent uses a ReAct loop with a SQL critic node for error correction, allowing up to 3 retries before giving up.

6. **Biome over ESLint + Prettier**: Single tool for linting and formatting on `packages/` and `scripts/`.

7. **Data warehouse tiering**: Medallion architecture (`raw_*` → `stg_*` → `nbadb` star tier → `unified_star`/`api`) with cross-source BBR reconciliation. Data-quality checks in `audit` schema via `scripts/db/verify-dq.ts`.
