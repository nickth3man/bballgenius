# Agent-driven TUI exploration (agent-tui)

BBallGenius CI uses OpenTUI `createTestRenderer` for fast, headless tests. For **real terminal** behavior (PTY, timing, alternate screen), use [agent-tui](https://github.com/pproenca/agent-tui) as an optional manual tool — it is **not** part of `bun run ci`.

## Prerequisites

- Unix-like environment with PTY support (Linux, macOS, or WSL on Windows)
- Install agent-tui separately (not a repo dependency):

```bash
# Follow upstream install instructions for your platform
```

## Quick start

Use the CI fixture so you do not need the 1.5 GB local database:

```bash
export NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb
agent-tui spawn -- bun run start
```

Inspect and drive the session:

```bash
agent-tui screenshot --session <id>
agent-tui key --session <id> F2
agent-tui key --session <id> c
```

## Keyboard reference

Machine-readable shortcuts live in [`src/hub/shared/utils/keyboard-map.json`](../src/hub/shared/utils/keyboard-map.json), generated from [`KEYBOARD_MAP`](../src/hub/shared/utils/keyboardHelp.ts). Edit `keyboardHelp.ts`, then run `bun run keyboard-map:sync`. The in-app `?` help overlay uses the same `KEYBOARD_MAP` data.

## When to use what

| Tool | Use when |
|------|----------|
| `createTestRenderer` + `bun test` | Regression, CI, fast agent loops |
| `scripts/agent-smoke.sh` | ~30s smoke before a PR |
| `scripts/capture-spans-dump.ts` | Structured span JSON for LLM review (no PTY) |
| agent-tui | Exploratory QA, true terminal quirks |

## Structured spans dump (no agent-tui)

```bash
NBA_DUCKDB_PATH=data/fixtures/nba.ci.duckdb bun run scripts/capture-spans-dump.ts 1
```

Tab index: `0` Game Center, `1` Time Machine, `2` SQL Sandbox.
