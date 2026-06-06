export interface ModelInfo {
  id: string;
  name: string;
}

let currentModel = process.env['MODEL'] || 'deepseek/deepseek-r1';

export function getModel(): string {
  return currentModel;
}

export function setModel(id: string): void {
  currentModel = id;
}

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
let modelsCache: { data: ModelInfo[]; timestamp: number } | null = null;

export async function fetchModels(): Promise<ModelInfo[]> {
  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (!apiKey) return [];

  if (modelsCache && Date.now() - modelsCache.timestamp < MODEL_CACHE_TTL_MS) {
    return modelsCache.data;
  }

  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.error(`[fetchModels] OpenRouter API returned ${res.status}: ${res.statusText}`);
    return [];
  }
  const data = (await res.json()) as { data?: { id: string; name: string }[] };
  const models = (data.data || [])
    .map((m) => ({ id: m.id, name: m.name || m.id }))
    .sort((a, b) => a.id.localeCompare(b.id));

  modelsCache = { data: models, timestamp: Date.now() };
  return models;
}
