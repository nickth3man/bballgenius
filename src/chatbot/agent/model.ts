import { ChatOpenAI } from '@langchain/openai';
import { getModel } from '../openrouter.js';

export function createModel(): ChatOpenAI {
  return new ChatOpenAI({
    model: getModel(),
    apiKey: process.env['OPENROUTER_API_KEY'] || 'sk-or-v1-missing',
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/anomalyco/bballgenius',
        'X-Title': 'BBallGenius Chatbot',
      },
    },
    temperature: 0.3,
    timeout: 120_000,
    modelKwargs: { parallel_tool_calls: true },
  });
}
