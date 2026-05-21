import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

const DEFAULT_MAX_TOKENS = 16000;
const TRIM_THRESHOLD = 0.8;
const ESTIMATE_DIVISOR = 4;
const ESTIMATE_CONSTANT = 5;

export class ConversationManager {
  private messages: ChatCompletionMessageParam[] = [];

  private totalTokens: number = 0;

  private maxTokens: number;

  constructor(maxTokens?: number) {
    this.maxTokens = maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  add(role: 'user' | 'assistant' | 'system', content: string): void {
    const message: ChatCompletionMessageParam = { role, content };
    this.messages.push(message);

    if (role !== 'system') {
      this.totalTokens += this.estimateTokens(content);
    }

    if (this.totalTokens > this.maxTokens) {
      this.trim();
    }
  }

  getMessages(): readonly ChatCompletionMessageParam[] {
    return this.messages;
  }

  clear(): void {
    this.messages = [];
    this.totalTokens = 0;
  }

  trim(): void {
    const threshold = Math.floor(this.maxTokens * TRIM_THRESHOLD);

    while (this.totalTokens > threshold) {
      const idx = this.messages.findIndex((m) => m.role !== 'system');
      if (idx === -1) {
        break;
      }
      const removed = this.messages.splice(idx, 1)[0];
      if (removed.role !== 'system' && typeof removed.content === 'string') {
        this.totalTokens -= this.estimateTokens(removed.content);
      }
    }
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / ESTIMATE_DIVISOR) + ESTIMATE_CONSTANT;
  }
}
