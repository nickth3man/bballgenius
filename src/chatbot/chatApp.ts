import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  type KeyEvent,
  ScrollBoxRenderable,
  TextRenderable,
} from '@opentui/core';
import { resetGraph } from './agent/graph.js';
import { streamQuery } from './agent/streaming.js';
import { ModelSelector } from './features/modelSelector.js';
import { getModel } from './openrouter.js';
import { ansiToStyledText } from './utils/ansi.js';
import {
  flushMetrics,
  recordChainStage,
  recordError,
  recordToken,
  recordToolCall,
  recordToolEnd,
  recordUsage,
  startMetrics,
} from './utils/metrics.js';
import { isNoColor, Theme } from './utils/theme.js';

const DEBUG = process.env['CHATBOT_DEBUG'] === 'true';

function debugLog(label: string, data: unknown): void {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString();
  console.error(
    `[${timestamp}] [DEBUG] ${label}:`,
    typeof data === 'object' ? JSON.stringify(data, null, 2) : data,
  );
}

function dimOrPlain(text: string): string {
  if (isNoColor()) return text;
  return `\x1b[2m${text}\x1b[0m`;
}

function youLabel(): string {
  if (isNoColor()) return '[You]';
  return '\x1b[1;34m[You]\x1b[0m';
}

function aiLabel(): string {
  if (isNoColor()) return '[AI]';
  return '\x1b[1;32m[AI]\x1b[0m';
}

function sqlLabel(): string {
  if (isNoColor()) return '[SQL]';
  return '\x1b[36m[SQL]\x1b[0m';
}

function errorLabel(): string {
  if (isNoColor()) return '[Error]';
  return '\x1b[1;31m[Error]\x1b[0m';
}

const FOOTER_INPUT_FOCUSED =
  '[Input] Tab \u2192 scroll \u2022 Enter send \u2022 @ models \u2022 Ctrl+C quit';
const FOOTER_SCROLL_FOCUSED = '[Chat History] Tab \u2192 input \u2022 @ models \u2022 Ctrl+C quit';
const FOOTER_PROCESSING =
  '[Processing...] Esc cancel \u2022 Tab \u2192 scroll \u2022 @ models \u2022 Ctrl+C quit';

export class ChatApp {
  readonly rootBox: BoxRenderable;
  readonly chatScroll: ScrollBoxRenderable;
  readonly promptInput: InputRenderable;

  private displayLines: string[] = [
    `${dimOrPlain('Welcome to BBallGenius Chat!')}\n${dimOrPlain('Ask me anything about NBA stats.')}`,
  ];
  private renderer: CliRenderer;
  private chatText: TextRenderable;
  private footerText: TextRenderable;
  private systemPrompt: string;
  private headerText: TextRenderable;
  private modelSelector: ModelSelector;
  private isProcessing = false;
  private processingCancelled = false;
  private sessionId = crypto.randomUUID();

  constructor(renderer: CliRenderer, systemPrompt: string) {
    this.renderer = renderer;
    this.systemPrompt = systemPrompt;

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
      borderColor: Theme.borderFocused,
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
      content: ansiToStyledText(this.displayLines.join('\n\n')),
      wrapMode: 'word',
    });

    this.chatScroll.add(this.chatText);

    this.inputBox = new BoxRenderable(renderer, {
      width: '100%',
      height: 3,
      border: ['top'],
      borderColor: Theme.borderFocused,
      backgroundColor: '#222530',
      paddingX: 1,
    });

    this.promptInput = new InputRenderable(renderer, {
      width: '100%',
      placeholder: 'Ask about NBA stats...',
      backgroundColor: '#222530',
    });

    this.inputBox.add(this.promptInput);

    const footerBox = new BoxRenderable(renderer, {
      width: '100%',
      height: 1,
      backgroundColor: '#16161e',
    });

    this.footerText = new TextRenderable(renderer, {
      content: FOOTER_INPUT_FOCUSED,
    });

    footerBox.add(this.footerText);

    this.rootBox.add(headerBox);
    this.rootBox.add(this.chatScroll);
    this.rootBox.add(this.inputBox);
    this.rootBox.add(footerBox);

    renderer.root.add(this.rootBox);

    this.modelSelector = new ModelSelector(renderer);
    this.modelSelector.setCallbacks(
      () => {
        resetGraph();
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

  private inputBox: BoxRenderable;

  private updateFooter(): void {
    if (this.isProcessing) {
      this.footerText.content = FOOTER_PROCESSING;
    } else if (this.chatScroll.focused) {
      this.footerText.content = FOOTER_SCROLL_FOCUSED;
    } else {
      this.footerText.content = FOOTER_INPUT_FOCUSED;
    }
  }

  focus(): void {
    this.promptInput.focus();
    this.updateFooter();
  }

  handleKeyPress(event: KeyEvent): boolean {
    if (this.modelSelector.overlay.visible) {
      return this.modelSelector.handleKeyPress(event);
    }

    if (event.name === '@' || (event.ctrl && event.name === 'p')) {
      this.modelSelector.show();
      return true;
    }

    if (event.name === 'escape' && this.isProcessing) {
      this.processingCancelled = true;
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
      this.updateFooter();
      return true;
    }
    return false;
  }

  private categorizeError(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes('rate') && lower.includes('limit')) {
      return 'Rate limited. Please wait and try again.';
    }
    if (lower.includes('timeout')) {
      return 'Request timed out. Try a simpler question.';
    }
    if (lower.includes('econnrefused') || lower.includes('network') || lower.includes('fetch')) {
      return 'Network error. Check your connection.';
    }
    return message;
  }

  private async handleSubmit(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.processingCancelled = false;
    this.updateFooter();

    const text = this.promptInput.value.trim();
    if (!text) {
      this.isProcessing = false;
      this.updateFooter();
      return;
    }
    this.promptInput.value = '';

    this.displayLines.push(`${youLabel()} ${text}`);
    this.renderDisplay();

    startMetrics(this.sessionId, text, getModel());
    debugLog('Graph State Transition', {
      stage: 'start',
      threadId: this.sessionId,
      question: text,
      model: getModel(),
    });

    const inputMessages = [new SystemMessage(this.systemPrompt), new HumanMessage(text)];

    this.displayLines.push(`${aiLabel()} ${dimOrPlain('thinking...')}`);
    let responseStartIdx = this.displayLines.length - 1;
    let fullResponse = '';
    let activeToolCount = 0;

    try {
      for await (const event of streamQuery(inputMessages, this.sessionId)) {
        if (this.processingCancelled) {
          if (fullResponse) {
            fullResponse += `\n\n${dimOrPlain('(Cancelled)')}`;
            this.displayLines[responseStartIdx] = `${aiLabel()} ${fullResponse}`;
          } else {
            this.displayLines[this.displayLines.length - 1] =
              `${aiLabel()} ${dimOrPlain('(Cancelled)')}`;
          }
          this.renderDisplay();
          break;
        }

        debugLog('Stream Event', {
          type: event.type,
          name: 'name' in event ? event.name : undefined,
        });

        if (event.type === 'token') {
          recordToken();
          if (activeToolCount > 0) {
            activeToolCount = 0;
            this.displayLines.push(`${aiLabel()} `);
            responseStartIdx = this.displayLines.length - 1;
          }
          fullResponse += event.content;
          this.displayLines[responseStartIdx] = `${aiLabel()} ${fullResponse}`;
          this.renderDisplay();
        } else if (event.type === 'tool_start') {
          recordToolCall(event.name, event.input, event.runId);
          if (event.name === 'query_nba_db' && event.input?.['sql']) {
            const sql = String(event.input['sql']);
            debugLog('SQL Query', { sql, timestamp: new Date().toISOString() });
            this.displayLines.push(`${sqlLabel()} ${sql}`);
            this.displayLines.push(`${sqlLabel()} ${dimOrPlain('Running query...')}`);
            activeToolCount++;
          } else if (event.name === 'get_schema_info') {
            this.displayLines.push(`${sqlLabel()} ${dimOrPlain('Looking up schema...')}`);
            activeToolCount++;
          } else {
            this.displayLines.push(`${dimOrPlain(`[Tool] Running ${event.name}...`)}`);
            activeToolCount++;
          }
        } else if (event.type === 'tool_end') {
          recordToolEnd(event.runId);
        } else if (event.type === 'chain_stage') {
          recordChainStage(event.stage);
          debugLog('Chain Stage', { stage: event.stage });
        } else if (event.type === 'error') {
          recordError(event.message);
          debugLog('Graph Error', { message: event.message });
          if (fullResponse) {
            fullResponse += `\n\n${dimOrPlain(`(Response interrupted: ${event.message})`)}`;
            this.displayLines[responseStartIdx] = `${aiLabel()} ${fullResponse}`;
          } else {
            this.displayLines[this.displayLines.length - 1] =
              `${errorLabel()} ${this.categorizeError(event.message)}`;
          }
          this.renderDisplay();
        } else if (event.type === 'usage') {
          recordUsage(event.usage);
          debugLog('Token Usage', event.usage);
        }
      }
      debugLog('Graph State Transition', { stage: 'complete', threadId: this.sessionId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      recordError(msg);
      debugLog('Graph Exception', { message: msg });
      if (fullResponse) {
        fullResponse += `\n\n${dimOrPlain('(Response interrupted)')}`;
        this.displayLines[responseStartIdx] = `${aiLabel()} ${fullResponse}`;
      } else {
        this.displayLines[this.displayLines.length - 1] =
          `${errorLabel()} ${this.categorizeError(msg)}`;
      }
      this.renderDisplay();
    }

    this.isProcessing = false;
    this.processingCancelled = false;
    this.updateFooter();
    flushMetrics();
  }

  private renderDisplay(): void {
    this.chatText.content = ansiToStyledText(this.displayLines.join('\n\n'));
    this.chatScroll.scrollTop = this.chatScroll.scrollHeight;
    this.renderer.requestRender();
  }
}

export function createChatApp(renderer: CliRenderer, systemPrompt: string): ChatApp {
  return new ChatApp(renderer, systemPrompt);
}
