# scripts/eval/shared/

## Responsibility

Utility module shared across the three eval harnesses (`chatbot-smoke.ts`, `chatbot-eval-multi-model.ts`, `iterate_loop.ts`). Provides model-tier resolution for smoke tests, shared type definitions, and text-processing utilities for answer validation.

## Design

Barrel-exported from `index.ts` (`export * from './eval-models.js'; export * from './eval-types.js'; export * from './eval-utils.js'`). Each file is a single-responsibility module:

| File | Contents |
|---|---|
| `eval-models.ts` | `SMOKE_MODEL_TIERS` constant (free/baseline presets), `resolveSmokeModels()`, `smokeTierDelayMs()`, `warnFreeTierModel()` |
| `eval-types.ts` | `TestResult` interface, `FailureType` union (`PASS | WRONG_ANSWER | SQL_ERROR | LOOP | TIMEOUT | CLARIFICATION | DATA_UNAVAILABLE`), `ANSI` color constants |
| `eval-utils.ts` | `withTimeout()` (promise race), `normalizeText()` (lower + smart quote + whitespace collapse), `normalizeNumeric()` (digit/dot extraction), `normalizeNumbers()` (comma removal), `normalizeAnswer()` (aggressive special-char strip), `countOccurrences()`, `detectDuplicateFinalAnswer()` (expected token ≥4×, sentence ≥3×, paragraph ≥2×) |

## Flow

```
eval harness script
  → import { ... } from './shared/index.js'
     ├── eval-models.ts: resolveSmokeModels() / smokeTierDelayMs()
     ├── eval-types.ts: TestResult / FailureType / ANSI
     └── eval-utils.ts: withTimeout() / normalizeText() / detectDuplicateFinalAnswer() / etc.
```

## Integration

- Called by all three eval scripts in `scripts/eval/`.
- `normalizeText`, `normalizeNumeric`, `countOccurrences`, `detectDuplicateFinalAnswer` are also re-exported from `iterate_loop.ts` (used by `scripts/eval/__tests__/evaluator-utils.test.ts`).
- No dependency on chatbot internals or the monorepo workspace — pure utility code.
