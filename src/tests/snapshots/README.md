# Golden frame snapshots

These text files store normalized `captureCharFrame()` output from OpenTUI test renders.

## Files

- `game_center_init.txt` — Game Center tab after `createAppShell` + `initTabs()` at 80×24.

## Updating snapshots

When you intentionally change layout, colors, or copy and tests fail on snapshot diff:

```bash
UPDATE_SNAPSHOTS=1 bun test src/tests/golden_snapshot.test.ts
```

Review the git diff on the `.txt` file before committing. Snapshots are normalized (trimmed trailing spaces, collapsed extra blank lines).

## Running regression-focused tests

```bash
bun run test:regression
```
