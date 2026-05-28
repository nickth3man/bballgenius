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
  private hasNewOutputBelow = false;
  private sessionStartTime = 0;
  private sessionTokenCount = 0;
  private statusBarText: TextRenderable;
  private spinnerTick = 0;

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

    const statusBar = new BoxRenderable(renderer, {
      width: '100%',
      height: 1,
      backgroundColor: '#16161e',
      border: ['top'],
      borderColor: Theme.borderNormal,
    });

    this.statusBarText = new TextRenderable(renderer, {
      content: dimOrPlain(`${getModel()} | tokens: 0 | 0.0s`),
    });

    statusBar.add(this.statusBarText);

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
    this.rootBox.add(statusBar);
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
    } else if (this.hasNewOutputBelow && this.chatScroll.focused) {
      this.footerText.content = FOOTER_NEW_OUTPUT;
    } else if (this.chatScroll.focused) {
      this.footerText.content = FOOTER_SCROLL_FOCUSED;
    } else {
      this.footerText.content = FOOTER_INPUT_FOCUSED;
    }
    this.inputBox.borderColor = this.promptInput.focused ? Theme.borderFocused : Theme.borderNormal;
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

    this.sessionStartTime = Date.now();
    this.sessionTokenCount = 0;
    this.spinnerTick = 0;

    this.displayLines.push(`${aiLabel()} ${statusText(getSpinnerFrame(0, 'thinking...'))}`);
    let responseStartIdx = this.displayLines.length - 1;
    let fullResponse = '';
    let activeToolCount = 0;

    try {
      for await (const event of streamQuery(inputMessages, this.sessionId)) {
        if (this.processingCancelled) {
          if (fullResponse) {
            fullResponse += `\n\n${statusText('(Cancelled)')}`;
            this.displayLines[responseStartIdx] = `${aiLabel()} ${fullResponse}`;
          } else {
            this.displayLines[this.displayLines.length - 1] =
              `${aiLabel()} ${statusText('(Cancelled)')}`;
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
          this.sessionTokenCount++;
          this.spinnerTick++;
          if (activeToolCount > 0) {
            activeToolCount = 0;
            this.displayLines.push(`${aiLabel()} `);
            responseStartIdx = this.displayLines.length - 1;
          }
          fullResponse += event.content;
          this.displayLines[responseStartIdx] = `${aiLabel()} ${fullResponse}`;
          this.updateStatusBar();
          this.renderDisplay();
        } else if (event.type === 'tool_start') {
          recordToolCall(event.name, event.input, event.runId);
          if (event.name === TOOL_QUERY_NBA_DB && event.input?.['sql']) {
            const sql = String(event.input['sql']);
            debugLog('SQL Query', { sql, timestamp: new Date().toISOString() });
            this.displayLines.push(`${sqlLabel()} ${sql}`);
            this.displayLines.push(
              `${sqlLabel()} ${statusText(getSpinnerFrame(this.spinnerTick, 'Running query...'))}`,
            );
            activeToolCount++;
          } else if (event.name === TOOL_GET_SCHEMA_INFO) {
            this.displayLines.push(
              `${sqlLabel()} ${statusText(getSpinnerFrame(this.spinnerTick, 'Looking up schema...'))}`,
            );
            activeToolCount++;
          } else {
            this.displayLines.push(
              `${statusText(getSpinnerFrame(this.spinnerTick, `Running ${event.name}...`))}`,
            );
            activeToolCount++;
          }
        } else if (event.type === 'tool_end') {
          recordToolEnd(event.runId);
        } else if (event.type === 'tool_error') {
          recordError(event.error);
          this.displayLines.push(formatToolErrorLine(event.name, event.error));
          activeToolCount = Math.max(0, activeToolCount - 1);
          this.renderDisplay();
        } else if (event.type === 'chain_stage') {
          recordChainStage(event.stage);
          debugLog('Chain Stage', { stage: event.stage });
        } else if (event.type === 'error') {
          recordError(event.message);
          debugLog('Graph Error', { message: event.message });
          if (fullResponse) {
            fullResponse += `\n\n${statusText(`(Response interrupted: ${event.message})`)}`;
            this.displayLines[responseStartIdx] = `${aiLabel()} ${fullResponse}`;
          } else {
            this.displayLines[this.displayLines.length - 1] =
              `${errorLabel()} ${formatErrorForUser(new Error(event.message))}`;
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
        fullResponse += `\n\n${statusText('(Response interrupted)')}`;
        this.displayLines[responseStartIdx] = `${aiLabel()} ${fullResponse}`;
      } else {
        this.displayLines[this.displayLines.length - 1] =
          `${errorLabel()} ${formatErrorForUser(err instanceof Error ? err : new Error(msg))}`;
      }
      this.renderDisplay();
    }

    this.isProcessing = false;
    this.processingCancelled = false;
    this.updateFooter();
    flushMetrics();
  }

  private updateStatusBar(): void {
    const elapsed = this.sessionStartTime
      ? ((Date.now() - this.sessionStartTime) / 1000).toFixed(1)
      : '0.0';
    this.statusBarText.content = dimOrPlain(
      `${getModel()} | tokens: ${this.sessionTokenCount} | ${elapsed}s`,
    );
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

export function createChatApp(renderer: CliRenderer, systemPrompt: string): ChatApp {
  return new ChatApp(renderer, systemPrompt);
}
