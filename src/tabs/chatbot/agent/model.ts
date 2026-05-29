import { ChatOpenAI } from '@langchain/openai';
import { getModel } from '../openrouter.js';

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

export function createModel(): ChatOpenAI {
  const apiKey = process.env['OPENROUTER_API_KEY']?.trim();
  if (!apiKey) {
    throw new Error(
      'OpenRouter API key is missing. Set OPENROUTER_API_KEY to a valid OpenRouter key, then restart BBallGenius Chat.',
    );
  }

  return new ChatOpenAI({
    model: getModel(),
    apiKey,
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/anomalyco/bballgenius',
        'X-Title': 'BBallGenius Chatbot',
      },
    },
    temperature: getTemperature(),
    timeout: 120_000,
    modelKwargs: { parallel_tool_calls: true },
  });
}
