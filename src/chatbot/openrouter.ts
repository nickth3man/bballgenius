import OpenAI from 'openai';

export interface ModelInfo {
  id: string;
  name: string;
}

interface ProviderPreferences {
  order: string[];
  allow_fallbacks: boolean;
}

let client: OpenAI | null = null;
let currentModel = process.env.MODEL || 'openai/gpt-oss-120b';

function _getProviderPreferences(): ProviderPreferences | undefined {
  const provider = process.env.OPENROUTER_PROVIDER || 'google-vertex';
  if (!provider) return undefined;
  return {
    order: [provider],
    allow_fallbacks: process.env.OPENROUTER_ALLOW_FALLBACKS === '1',
  };
}

export function getModel(): string {
  return currentModel;
}

export function setModel(id: string): void {
  currentModel = id;
}

export function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENROUTER_API_KEY || 'sk-or-v1-missing';
    client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/anomalyco/bballgenius',
        'X-Title': 'BBallGenius Chatbot',
      },
    });
  }
  return client;
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return [];
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { data?: { id: string; name: string }[] };
  return (data.data || [])
    .map((m) => ({ id: m.id, name: m.name || m.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
