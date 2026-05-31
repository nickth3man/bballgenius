/** OpenRouter model presets for tiered chatbot smoke eval. */
export const SMOKE_MODEL_TIERS = {
  free: ['openai/gpt-oss-120b:free', 'openrouter/free'],
  baseline: ['openai/gpt-oss-120b', 'google/gemini-3.5-flash'],
} as const;

export type SmokeModelTier = keyof typeof SMOKE_MODEL_TIERS | 'all';

export function resolveSmokeModels(): string[] {
  const tier = process.env.CHATBOT_SMOKE_TIER?.trim() as SmokeModelTier | undefined;
  const defaultModel = process.env.MODEL || 'openai/gpt-oss-120b';

  if (!tier) {
    return [defaultModel];
  }

  if (tier === 'all') {
    return [...SMOKE_MODEL_TIERS.free, ...SMOKE_MODEL_TIERS.baseline];
  }

  if (tier in SMOKE_MODEL_TIERS) {
    return [...SMOKE_MODEL_TIERS[tier as keyof typeof SMOKE_MODEL_TIERS]];
  }

  console.error(
    `Invalid CHATBOT_SMOKE_TIER="${tier}" — use free, baseline, or all (or omit for single MODEL).`,
  );
  process.exit(1);
}

export function smokeTierDelayMs(tier: SmokeModelTier | undefined): number {
  if (tier === 'free' || tier === 'all') {
    return Number(process.env.CHATBOT_SMOKE_DELAY_MS || 3000);
  }
  return 0;
}

export function warnFreeTierModel(modelId: string, tier: SmokeModelTier | undefined): void {
  if (tier !== 'free' && tier !== 'all') {
    return;
  }
  if (!modelId.includes(':free') && modelId !== 'openrouter/free') {
    console.warn(
      `Warning: model "${modelId}" may not be a free-tier variant (expected :free suffix or openrouter/free).`,
    );
  }
}
