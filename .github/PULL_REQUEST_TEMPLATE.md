## Summary

Brief description of what this PR does and why.

## Changes

- [ ] Change 1
- [ ] Change 2

## Testing

- [ ] `bun run lint` passes
- [ ] `bun run typecheck` passes
- [ ] `bun run typecheck:chatbot` passes
- [ ] `bun run test:unit` passes
- [ ] `bun run ci:integration` passes (if hub changes)
- [ ] `bun run test:chatbot` passes (if chatbot changes)

## Checklist

- [ ] No `.only(` or `.skip(` in test files
- [ ] No `any` types or untyped `let`
- [ ] Golden snapshots regenerated against CI fixture (if applicable)
- [ ] No cross-package imports (hub ↔ chatbot) beyond `src/shared/`
- [ ] `AGENTS.md` updated if architecture or commands changed
