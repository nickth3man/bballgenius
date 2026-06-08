# `scripts/eval/shared/`

## Responsibility
Shared utilities and model configuration for the chatbot evaluation harnesses. Provides the common types, ANSI formatting, model tier presets, text normalization, and timeout logic used by all eval scripts.

## Design

### Module Structure
Three focused modules re-exported through a barrel `index.ts`:

| Module | Responsibility |
|--------|----------------|
| `eval-types.ts` | Shared `TestResult` interface, `FailureType` union, `ANSI` escape constant |
| `eval-models.ts` | Model tier presets (`free`, `baseline`), `resolveSmokeModels()` factory, rate-limit delay logic |
| `eval-utils.ts` | `withTimeout()`, text normalization (`normalizeText`, `normalizeNumeric`, `normalizeAnswer`), duplicate detection, `countOccurrences` |

### Model Matrix (`eval-models.ts`)
Defines the tiered model configuration system:

```typescript
SMOKE_MODEL_TIERS = {
  free:   ['openai/gpt-oss-120b:free', 'openrouter/free'],
  baseline: ['openai/gpt-oss-120b', 'google/gemini-3.5-flash'],
};
```

- `resolveSmokeModels()` — resolves `CHATBOT_SMOKE_TIER` env var to a model list; fallback to single `MODEL` env var.
- `smokeTierDelayMs()` — returns 3s delay for free tier (rate-limit avoidance), 0 for others.
- `warnFreeTierModel()` — warns if a non-free model is used with free tier.

### Text Utilities (`eval-utils.ts`)
- **`withTimeout(promise, ms, label)`**: Wraps a promise; rejects after `ms` with a labeled timeout error.
- **`normalizeText(value)`**: Lowercases, replaces smart quotes, strips special chars, collapses whitespace.
- **`normalizeNumeric(value)`**: Extracts digits, dots, and hyphens only.
- **`normalizeAnswer(value)`**: Lowercases, strips everything beyond basic punctuation.
- **`normalizeNumbers(s)`**: Removes commas from numeric strings.
- **`detectDuplicateFinalAnswer(answer, expected)`**: Heuristic that flags:
  - Expected token appearing 4+ times
  - Any sentence (≥30 chars) repeated 3+ times
  - Any paragraph (≥40 chars) repeated 2+ times
- **`countOccurrences(haystack, needle)`**: Non-overlapping substring count.

### ANSI Formatting (`eval-types.ts`)
Standard terminal color/bold/dim constants for consistent eval output formatting.

## Integration
- **Used by**: `scripts/eval/chatbot-smoke.ts`, `scripts/eval/chatbot-eval-multi-model.ts`, `scripts/eval/iterate_loop.ts`.
- **Exports**: Re-exported via `index.ts` barrel for convenient single-line imports.
- **No runtime dependencies**: Pure TypeScript utilities — no LangChain, DuckDB, or external API imports.
