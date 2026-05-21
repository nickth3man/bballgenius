import { AIMessageChunk, HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { CliRenderer, KeyEvent } from '@opentui/core';
import { BoxRenderable, InputRenderable, ScrollBoxRenderable, TextRenderable } from '@opentui/core';
import { ConversationManager } from './conversation.js';
import { ModelSelector } from './features/modelSelector.js';
import { chatbotGraph } from './graph/graph.js';
import { getModel } from './openrouter.js';
import { ansiToStyledText } from './utils/ansi.js';
import { Theme } from './utils/theme.js';

export class ChatApp {
  readonly rootBox: BoxRenderable;
  readonly chatScroll: ScrollBoxRenderable;
  readonly promptInput: InputRenderable;

  private conversation: ConversationManager;
  private renderer: CliRenderer;
  private chatText: TextRenderable;
  private footerText: TextRenderable;
  private systemPrompt: string;
  private headerText: TextRenderable;
  private modelSelector: ModelSelector;
  private isProcessing = false;
  private pendingAssistant = '';
  private sessionId = crypto.randomUUID();

  constructor(renderer: CliRenderer, systemPrompt: string) {
    this.renderer = renderer;
    this.systemPrompt = systemPrompt;
    this.conversation = new ConversationManager();

    this.rootBox = new BoxRenderable(renderer, {
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      backgroundColor: Theme.background,
    });

    const headerBox = new BoxRenderable(renderer, {
      width: '100%',
      height: 3,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#16161e',
      border: ['bottom'],
      borderColor: Theme.borderNormal,
    });

    this.headerText = new TextRenderable(renderer, {
      content: `BBallGenius Chat | ${getModel()}`,
    });

    headerBox.add(this.headerText);

    this.chatScroll = new ScrollBoxRenderable(renderer, {
      width: '100%',
      flexGrow: 1,
      stickyScroll: true,
    });

    this.chatText = new TextRenderable(renderer, {
      content: ansiToStyledText(
        '\x1b[2mWelcome to BBallGenius Chat!\nAsk me anything about NBA stats.\x1b[0m',
      ),
      wrapMode: 'word',
    });

    this.chatScroll.add(this.chatText);

    const inputBox = new BoxRenderable(renderer, {
      width: '100%',
      height: 3,
      border: ['top'],
      borderColor: Theme.borderNormal,
      backgroundColor: '#222530',
      paddingX: 1,
    });

    this.promptInput = new InputRenderable(renderer, {
      width: '100%',
      placeholder: 'Ask about NBA stats...',
      backgroundColor: '#222530',
    });

    inputBox.add(this.promptInput);

    const footerBox = new BoxRenderable(renderer, {
      width: '100%',
      height: 1,
      backgroundColor: '#16161e',
    });

    this.footerText = new TextRenderable(renderer, {
      content: 'Tab to focus scroll • Enter to send • Esc to quit',
    });

    footerBox.add(this.footerText);

    this.rootBox.add(headerBox);
    this.rootBox.add(this.chatScroll);
    this.rootBox.add(inputBox);
    this.rootBox.add(footerBox);

    renderer.root.add(this.rootBox);

    this.modelSelector = new ModelSelector(renderer);
    this.modelSelector.setCallbacks(
      () => {
        this.headerText.content = `BBallGenius Chat | ${getModel()}`;
        this.renderer.requestRender();
      },
      () => {
        this.focus();
      },
    );
    renderer.root.add(this.modelSelector.overlay);

    this.promptInput.on('enter', () => this.handleSubmit());
  }

  private async handleSubmit(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const text = this.promptInput.value.trim();
    if (!text) {
      this.isProcessing = false;
      return;
    }
    this.promptInput.value = '';

    this.conversation.add('user', text);
    this.renderMessages();

    const isFirstMessage =
      this.conversation.getMessages().filter((m) => m.role !== 'system').length <= 1;
    const inputMessages: (SystemMessage | HumanMessage)[] = [];
    if (isFirstMessage) {
      inputMessages.push(new SystemMessage(this.systemPrompt));
    }
    inputMessages.push(new HumanMessage(text));

    this.conversation.add('assistant', '');
    let fullResponse = '';

    try {
      const stream = await chatbotGraph.stream(
        { messages: inputMessages },
        {
          configurable: { thread_id: this.sessionId },
          streamMode: 'messages',
        },
      );

      for await (const [message, _metadata] of stream) {
        if (AIMessageChunk.isInstance(message)) {
          const content = message.content;
          if (typeof content === 'string' && content) {
            fullResponse += content;
            this.pendingAssistant = fullResponse;
            this.renderMessages();
          }
        }
      }
    } catch (err) {
      fullResponse = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    this.pendingAssistant = '';
    const convMsgs = this.conversation.getMessages();
    const lastMsg = convMsgs[convMsgs.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      lastMsg.content = fullResponse;
    }

    this.isProcessing = false;
    this.renderMessages();
  }

  private renderMessages(): void {
    const lines: string[] = [];
    for (const msg of this.conversation.getMessages()) {
      if (msg.role === 'system') continue;
      const content = typeof msg.content === 'string' ? msg.content : '';
      if (msg.role === 'user') {
        lines.push(`\x1b[1;34mYou:\x1b[0m ${content}`);
      } else if (msg.role === 'assistant') {
        lines.push(`\x1b[1;32mAI:\x1b[0m ${content}`);
      }
    }
    if (this.pendingAssistant) {
      lines.push(`\x1b[1;32mAI:\x1b[0m ${this.pendingAssistant}`);
    }
    this.chatText.content = ansiToStyledText(lines.join('\n\n'));
    this.chatScroll.scrollTop = this.chatScroll.scrollHeight;
    this.renderer.requestRender();
  }

  focus(): void {
    this.promptInput.focus();
  }

  handleKeyPress(event: KeyEvent): boolean {
    if (this.modelSelector.overlay.visible) {
      return this.modelSelector.handleKeyPress(event);
    }

    if (event.name === '@' || (event.ctrl && event.name === 'p')) {
      this.modelSelector.show();
      return true;
    }

    if (event.name === 'tab') {
      if (event.shift) {
        if (this.chatScroll.focused) {
          this.promptInput.focus();
        } else {
          this.chatScroll.focus();
        }
      } else {
        if (this.promptInput.focused) {
          this.chatScroll.focus();
        } else {
          this.promptInput.focus();
        }
      }
      return true;
    }
    return false;
  }
}

export function createChatApp(renderer: CliRenderer, systemPrompt: string): ChatApp {
  return new ChatApp(renderer, systemPrompt);
}
