import { BoxRenderable, type CliRenderer, TextRenderable } from '@opentui/core';
import type { AppKeyEvent } from '../../core/input.js';
import { ansiToStyledText } from '../../shared/utils/formatters.js';
import { Theme } from '../../shared/utils/theme.js';
import { ChatApp } from './chatApp.js';
import { initDb as initChatbotDb } from './db.js';
import { getModel } from './openrouter.js';
import { buildSystemPrompt } from './systemPrompt.js';

export class ChatbotTab {
  readonly id = 'chatbot';
  readonly name = 'Chat';
  readonly container: BoxRenderable;

  private chatApp: ChatApp | null = null;
  private renderer: CliRenderer;
  private initialized = false;
  private errorText: TextRenderable | null = null;

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;
    this.container = new BoxRenderable(renderer, {
      id: 'chatbot-tab-container',
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      backgroundColor: Theme.background,
    });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      await initChatbotDb();
      const systemPrompt = await buildSystemPrompt();

      this.chatApp = new ChatApp(this.renderer, systemPrompt, {
        containerMode: true,
      });

      this.container.add(this.chatApp.container);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.errorText = new TextRenderable(this.renderer, {
        content: ansiToStyledText(
          `\x1b[31mChat unavailable:\x1b[0m ${message}\n\nSet OPENROUTER_API_KEY in your environment to enable the chatbot.`,
        ),
        wrapMode: 'word',
      });
      this.container.add(this.errorText);
    }
  }

  focus(): void {
    this.chatApp?.focus();
  }

  cycleFocus(): void {
    if (!this.chatApp) return;
    if (this.chatApp.promptInput.focused) {
      this.chatApp.chatScroll.focus();
    } else {
      this.chatApp.promptInput.focus();
    }
  }

  cycleFocusBackward(): void {
    this.cycleFocus();
  }

  getStatusLine(): string {
    if (!this.chatApp) return '';
    return `Model: ${getModel()}`;
  }

  isInputFocused(): boolean {
    if (!this.chatApp) return false;
    return this.chatApp.promptInput.focused || this.chatApp.processing;
  }

  blurInput(): void {
    if (!this.chatApp) return;
    if (this.chatApp.processing) {
      this.chatApp.cancel();
    } else {
      this.chatApp.promptInput.blur();
    }
  }

  handleKeyPress(event: AppKeyEvent): boolean {
    if (!this.chatApp) return false;
    return this.chatApp.handleKeyPress(event);
  }
}
