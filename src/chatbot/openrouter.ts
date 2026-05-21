export interface ModelInfo {
  id: string;
  name: string;
}

let currentModel = process.env['MODEL'] || 'openai/gpt-oss-120b';

export function getModel(): string {
  return currentModel;
}

export function setModel(id: string): void {
  currentModel = id;
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const apiKey = process.env['OPENROUTER_API_KEY'];
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
