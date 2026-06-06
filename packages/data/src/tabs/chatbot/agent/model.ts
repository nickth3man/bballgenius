import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenRouter } from '@langchain/openrouter';
import { getModel } from '../openrouter.js';

/**
 * Builds the OpenRouter `reasoning` request param so models stream their
 * thinking tokens back (surfaced in the chat UI). Effort is configurable via
 * `REASONING_EFFORT`; set it to `off` to disable reasoning output entirely.
 */
function getReasoningConfig(): Record<string, unknown> | undefined {
  const effort = (process.env['REASONING_EFFORT'] ?? 'medium').trim().toLowerCase();
  if (effort === 'off' || effort === 'none' || effort === 'false') return undefined;
  if (effort === 'low' || effort === 'medium' || effort === 'high') {
    return { reasoning: { effort } };
  }
  return { reasoning: { effort: 'medium' } };
}

function getTemperature(): number {
  const envTemp =
    process.env['TEMPERATURE'] ??
    process.env['LLM_TEMPERATURE'] ??
    process.env['OPENROUTER_TEMPERATURE'];
  if (envTemp != null && envTemp !== '') {
    const parsed = Number.parseFloat(envTemp);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 2) return parsed;
  }
  return 0.3;
}

export function createModel(): BaseChatModel {
  const apiKey = process.env['OPENROUTER_API_KEY']?.trim();
  if (!apiKey) {
    throw new Error(
      'OpenRouter API key is missing. Set OPENROUTER_API_KEY to a valid OpenRouter key, then restart BBallGenius Chat.',
    );
  }

  return new ChatOpenRouter({
    model: getModel(),
    apiKey,
    temperature: getTemperature(),
    siteUrl: 'https://github.com/anomalyco/bballgenius',
    siteName: 'BBallGenius Chatbot',
    modelKwargs: { parallel_tool_calls: true, ...getReasoningConfig() },
  });
}
