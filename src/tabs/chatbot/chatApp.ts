import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  ScrollBoxRenderable,
  TextRenderable,
} from '@opentui/core';
import type { AppKeyEvent } from '../../core/input.js';
import { resetGraph } from './agent/graph.js';
import { type StreamEvent, streamQuery } from './agent/streaming.js';
import { TOOL_GET_SCHEMA_INFO, TOOL_QUERY_NBA_DB } from './agent/toolNames.js';
import { ModelSelector } from './features/modelSelector.js';
import { getModel } from './openrouter.js';
import { ansiToStyledText } from './utils/ansi.js';
import { markdownToAnsi } from './utils/markdown.js';
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
import { formatErrorForUser } from './utils/retry.js';
import { getSpinnerFrame } from './utils/spinner.js';
import {
  formatChainStageStatus,
  formatToolEndBlock,
  formatToolStartBlock,
} from './utils/streamFormatting.js';
import {
  aiLabel,
  dimOrPlain,
  errorLabel,
  sqlLabel,
  statusText,
  Theme,
  youLabel,
} from './utils/theme.js';

const DEBUG = process.env['CHATBOT_DEBUG'] === 'true';

function debugLog(label: string, data: unknown): void {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString();
  console.error(
    `[${timestamp}] [DEBUG] ${label}:`,
    typeof data === 'object' ? JSON.stringify(data, null, 2) : data,
  );
}

const FOOTER_INPUT_FOCUSED =
  '[Focused: Input] Tab to chat history | Enter send | @ or Ctrl+P models | Esc exits when idle | Ctrl+C quit';
const FOOTER_SCROLL_FOCUSED =
  '[Focused: Chat History] Tab to input | Up/Down/Page scroll | @ or Ctrl+P models | Ctrl+C quit';
const FOOTER_PROCESSING =
  '[Processing] Esc cancel | Tab to chat history/input | @ or Ctrl+P models | Ctrl+C quit';
const FOOTER_NEW_OUTPUT =
  '[Focused: Chat History] New output below | Tab to input | Up/Down/Page scroll | Ctrl+C quit';

export function shouldAutoScroll(params: {
  scrollTop: number;
  scrollHeight: number;
  height: number;
  inputFocused: boolean;
}): boolean {
  if (params.inputFocused) return true;
  const visibleHeight = params.height || 0;
  const distanceFromBottom = params.scrollHeight - (params.scrollTop + visibleHeight);
  return distanceFromBottom <= 2;
}

export function formatToolErrorLine(name: string, error: string): string {
  return `${errorLabel()} Tool ${name} failed: ${error}`;
}

export interface ChatAppOptions {
  containerMode?: boolean;
}

export class ChatApp {
  readonly container: BoxRenderable;
  readonly chatScroll: ScrollBoxRenderable;
  readonly promptInput: InputRenderable;

  private displayLines: string[] = [
    `${dimOrPlain('Welcome to BBallGenius Chat!')}\n${dimOrPlain('Ask me anything about NBA stats.')}`,
  ];
  private renderer: CliRenderer;
  private chatText: TextRenderable;
  private footerText: TextRenderable | null = null;
  private systemPrompt: string;
  private headerText: TextRenderable | null = null;
  private modelSelector: ModelSelector;
  private isProcessing = false;
  private processingCancelled = false;
  private sessionId = crypto.randomUUID();
  private hasNewOutputBelow = false;
  private sessionStartTime = 0;
  private sessionTokenCount = 0;
  private statusBarText: TextRenderable | null = null;
  private responseStartIdx = 0;
  private fullResponse = '';
  private activeToolCount = 0;
  private abortController: AbortController | undefined;
  private inputBox: BoxRenderable;

  get processing(): boolean {
    return this.isProcessing;
  }

  constructor(renderer: CliRenderer, systemPrompt: string, options?: ChatAppOptions) {
    this.renderer = renderer;
    this.systemPrompt = systemPrompt;
    const containerMode = options?.containerMode ?? false;

    this.container = new BoxRenderable(renderer, {
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      backgroundColor: Theme.background,
    });

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
      backgroundColor: Theme.inputBg,
      paddingX: 1,
    });

    this.promptInput = new InputRenderable(renderer, {
      width: '100%',
      placeholder: 'Ask about NBA stats...',
      backgroundColor: Theme.inputBg,
    });

    this.inputBox.add(this.promptInput);

    if (!containerMode) {
      const headerBox = new BoxRenderable(renderer, {
        width: '100%',
        height: 3,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: Theme.surface,
        border: ['bottom'],
        borderColor: Theme.borderFocused,
      });

      this.headerText = new TextRenderable(renderer, {
        content: `BBallGenius Chat | ${getModel()}`,
      });
      headerBox.add(this.headerText);

      const statusBar = new BoxRenderable(renderer, {
        width: '100%',
        height: 1,
        backgroundColor: Theme.surface,
        border: ['top'],
        borderColor: Theme.borderNormal,
      });

      this.statusBarText = new TextRenderable(renderer, {
        content: dimOrPlain(`${getModel()} | tokens: 0 | 0.0s`),
      });
      statusBar.add(this.statusBarText);

      const footerBox = new BoxRenderable(renderer, {
        width: '100%',
        height: 1,
        backgroundColor: Theme.surface,
      });

      this.footerText = new TextRenderable(renderer, {
        content: FOOTER_INPUT_FOCUSED,
      });
      footerBox.add(this.footerText);

      this.container.add(headerBox);
      this.container.add(this.chatScroll);
      this.container.add(statusBar);
      this.container.add(this.inputBox);
      this.container.add(footerBox);

      renderer.root.add(this.container);
    } else {
      this.container.add(this.chatScroll);
      this.container.add(this.inputBox);
    }

    this.modelSelector = new ModelSelector(renderer);
    this.modelSelector.setCallbacks(
      () => {
        resetGraph();
        if (this.headerText) {
          this.headerText.content = `BBallGenius Chat | ${getModel()}`;
        }
        this.renderer.requestRender();
      },
      () => {
        this.focus();
      },
    );
    renderer.root.add(this.modelSelector.overlay);

    this.promptInput.on('enter', () => this.handleSubmit());
  }

  private updateFooter(): void {
    if (this.footerText) {
      if (this.isProcessing) {
        this.footerText.content = FOOTER_PROCESSING;
      } else if (this.hasNewOutputBelow && this.chatScroll.focused) {
        this.footerText.content = FOOTER_NEW_OUTPUT;
      } else if (this.chatScroll.focused) {
        this.footerText.content = FOOTER_SCROLL_FOCUSED;
      } else {
        this.footerText.content = FOOTER_INPUT_FOCUSED;
      }
    }
    this.inputBox.borderColor = this.promptInput.focused ? Theme.borderFocused : Theme.borderNormal;
  }

  focus(): void {
    this.promptInput.focus();
    this.updateFooter();
  }

  cancel(): void {
    if (this.isProcessing) {
      this.processingCancelled = true;
      this.abortController?.abort();
    }
  }

  handleKeyPress(event: AppKeyEvent): boolean {
    if (this.modelSelector.overlay.visible) {
      return this.modelSelector.handleKeyPress(event);
    }

    if (event.name === '@' || (event.ctrl && event.name === 'p')) {
      this.modelSelector.show();
      return true;
    }

    if (event.name === 'escape' && this.isProcessing) {
      this.processingCancelled = true;
      this.abortController?.abort();
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

  private handleTokenEvent(event: Extract<StreamEvent, { type: 'token' }>): void {
    recordToken();
    this.sessionTokenCount++;
    if (this.activeToolCount > 0) {
      this.activeToolCount = 0;
      this.displayLines.push(`${aiLabel()} `);
      this.responseStartIdx = this.displayLines.length - 1;
    }
    this.fullResponse += event.content;
    this.displayLines[this.responseStartIdx] = `${aiLabel()} ${this.fullResponse}`;
    this.updateStatusBar();
    this.renderStreaming();
  }

  private handleToolStartEvent(event: Extract<StreamEvent, { type: 'tool_start' }>): void {
    recordToolCall(event.name, event.input, event.runId);
    const lines = formatToolStartBlock(event.name, event.input);
    if (event.name === TOOL_QUERY_NBA_DB && event.input?.['sql']) {
      const sql = String(event.input['sql']);
      debugLog('SQL Query', { sql, timestamp: new Date().toISOString() });
      this.displayLines.push(`${sqlLabel()} ${lines[1]}`);
      this.displayLines.push(`${sqlLabel()} ${statusText(lines[0])}`);
    } else if (event.name === TOOL_GET_SCHEMA_INFO) {
      this.displayLines.push(`${sqlLabel()} ${statusText(lines.join(' | '))}`);
    } else {
      this.displayLines.push(statusText(lines.join(' | ')));
    }
    this.activeToolCount++;
    this.renderStreaming();
  }

  private handleToolEndEvent(event: Extract<StreamEvent, { type: 'tool_end' }>): void {
    recordToolEnd(event.runId);
    const lines = formatToolEndBlock(event.name, event.output, event.durationMs);
    const prefix = event.name === TOOL_QUERY_NBA_DB ? sqlLabel() : statusText('[Tool]');
    this.displayLines.push(`${prefix} ${statusText(lines.join(' | '))}`);
    this.activeToolCount = Math.max(0, this.activeToolCount - 1);
    this.renderStreaming();
  }

  private handleToolErrorEvent(event: Extract<StreamEvent, { type: 'tool_error' }>): void {
    recordError(event.error);
    this.displayLines.push(formatToolErrorLine(event.name, event.error));
    this.activeToolCount = Math.max(0, this.activeToolCount - 1);
    this.renderDisplay();
  }

  private handleChainStageEvent(event: Extract<StreamEvent, { type: 'chain_stage' }>): void {
    recordChainStage(event.stage);
    debugLog('Chain Stage', { stage: event.stage });
    this.displayLines.push(statusText(`[Status] ${formatChainStageStatus(event.stage)}`));
    this.renderStreaming();
  }

  private handleErrorEvent(event: Extract<StreamEvent, { type: 'error' }>): void {
    recordError(event.message);
    debugLog('Graph Error', { message: event.message });
    if (this.fullResponse) {
      this.fullResponse += `\n\n${statusText(`(Response interrupted: ${event.message})`)}`;
      this.displayLines[this.responseStartIdx] = `${aiLabel()} ${this.fullResponse}`;
    } else {
      this.displayLines[this.displayLines.length - 1] =
        `${errorLabel()} ${formatErrorForUser(new Error(event.message))}`;
    }
    this.renderDisplay();
  }

  private handleCancellation(): void {
    if (this.fullResponse) {
      this.fullResponse += `\n\n${statusText('(Cancelled)')}`;
      this.displayLines[this.responseStartIdx] = `${aiLabel()} ${this.fullResponse}`;
    } else {
      this.displayLines[this.displayLines.length - 1] = `${aiLabel()} ${statusText('(Cancelled)')}`;
    }
    this.renderDisplay();
  }

  private handleStreamError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    recordError(msg);
    debugLog('Graph Exception', { message: msg });
    if (this.fullResponse) {
      this.fullResponse += `\n\n${statusText('(Response interrupted)')}`;
      this.displayLines[this.responseStartIdx] = `${aiLabel()} ${this.fullResponse}`;
    } else {
      this.displayLines[this.displayLines.length - 1] =
        `${errorLabel()} ${formatErrorForUser(err instanceof Error ? err : new Error(msg))}`;
    }
    this.renderDisplay();
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

    const MAX_DISPLAY_LINES = 500;
    if (this.displayLines.length > MAX_DISPLAY_LINES) {
      this.displayLines = this.displayLines.slice(-MAX_DISPLAY_LINES);
    }

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

    this.sessionStartTime = Date.now();
    this.sessionTokenCount = 0;
    this.fullResponse = '';
    this.activeToolCount = 0;

    this.displayLines.push(`${aiLabel()} ${statusText(getSpinnerFrame(0, 'thinking...'))}`);
    this.responseStartIdx = this.displayLines.length - 1;

    this.abortController = new AbortController();

    try {
      for await (const event of streamQuery(
        inputMessages,
        this.sessionId,
        this.abortController.signal,
      )) {
        if (this.processingCancelled) {
          this.handleCancellation();
          break;
        }

        debugLog('Stream Event', {
          type: event.type,
          name: 'name' in event ? event.name : undefined,
        });

        switch (event.type) {
          case 'token':
            this.handleTokenEvent(event);
            break;
          case 'tool_start':
            this.handleToolStartEvent(event);
            break;
          case 'tool_end':
            this.handleToolEndEvent(event);
            break;
          case 'tool_error':
            this.handleToolErrorEvent(event);
            break;
          case 'chain_stage':
            this.handleChainStageEvent(event);
            break;
          case 'error':
            this.handleErrorEvent(event);
            break;
          case 'usage':
            recordUsage(event.usage);
            debugLog('Token Usage', event.usage);
            break;
          case 'done':
            break;
        }
      }
      debugLog('Graph State Transition', { stage: 'complete', threadId: this.sessionId });
    } catch (err) {
      this.handleStreamError(err);
    } finally {
      this.isProcessing = false;
      this.processingCancelled = false;
      this.abortController = undefined;
      this.updateFooter();
    }
    this.renderDisplay();
    flushMetrics();
  }

  private updateStatusBar(): void {
    if (!this.statusBarText) return;
    const elapsed = this.sessionStartTime
      ? ((Date.now() - this.sessionStartTime) / 1000).toFixed(1)
      : '0.0';
    this.statusBarText.content = dimOrPlain(
      `${getModel()} | tokens: ${this.sessionTokenCount} | ${elapsed}s`,
    );
  }

  private renderStreaming(): void {
    this.chatText.content = ansiToStyledText(this.displayLines.join('\n\n'));
    this.chatScroll.scrollTop = this.chatScroll.scrollHeight;
    this.renderer.requestRender();
  }

  private renderDisplay(): void {
    const autoScroll = shouldAutoScroll({
      scrollTop: this.chatScroll.scrollTop,
      scrollHeight: this.chatScroll.scrollHeight,
      height: this.chatScroll.height || 0,
      inputFocused: this.promptInput.focused,
    });

    const separator = dimOrPlain('─'.repeat(40));
    const parts: string[] = [];
    for (let i = 0; i < this.displayLines.length; i++) {
      const line = this.displayLines[i]!;
      if (i > 0 && line.startsWith(youLabel())) {
        parts.push(separator);
      }
      if (line.startsWith(aiLabel())) {
        const content = line.slice(aiLabel().length + 1);
        parts.push(`${aiLabel()} ${markdownToAnsi(content)}`);
      } else {
        parts.push(line);
      }
    }

    this.chatText.content = ansiToStyledText(parts.join('\n\n'));
    if (autoScroll) {
      this.chatScroll.scrollTop = this.chatScroll.scrollHeight;
      this.hasNewOutputBelow = false;
    } else {
      this.hasNewOutputBelow = true;
      this.updateFooter();
    }
    this.renderer.requestRender();
  }
}

export function createChatApp(
  renderer: CliRenderer,
  systemPrompt: string,
  options?: ChatAppOptions,
): ChatApp {
  return new ChatApp(renderer, systemPrompt, options);
}
