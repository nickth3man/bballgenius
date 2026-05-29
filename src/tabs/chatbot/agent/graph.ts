import { createRequire } from 'node:module';
import type { BaseMessage } from '@langchain/core/messages';
import { SystemMessage, ToolMessage } from '@langchain/core/messages';
import { Command, END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';
import { invalidateSchemaCache } from '../db.js';
import { ERROR_PREFIX } from '../utils/retry.js';
import { createModel } from './model.js';
import { buildIntentSchemaPrompt } from './schemaFilter.js';
import { ChatbotState, type ChatbotStateType } from './state.js';
import { nbaTools } from './tools.js';

const MAX_SQL_RETRIES = 3;
const MAX_TOTAL_TOOL_CALLS = 10;
const LOOP_DETECTION_THRESHOLD = 3;
const HALLUCINATION_NUMBER_THRESHOLD = 500;
const MAX_VALIDATE_ANSWER_RETRIES = 2;

let _abortSignal: AbortSignal | undefined;
export function setAbortSignal(signal: AbortSignal | undefined): void {
  _abortSignal = signal;
}

const INTENT_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  {
    pattern:
      /\b(triple.doubles?|quadruple.doubles?|50.point|career\s+(points|rebounds|assists|steals|blocks|games|three|free\s+throw|leader)|all.time|most\s+(points|rebounds|assists|steals|blocks|three|games)|(second|2nd|third|3rd|fourth|4th|fifth|5th)\s+(on|in)\s+(the\s+)?(all.time|scoring|assist|rebound|steal|block))\b/i,
    category: 'career_leaders',
  },
  {
    pattern:
      /\b(season\s+leader|points?\s+per\s+game|assists?\s+per\s+game|rebounds?\s+per\s+game|led\s+the\s+nba)\b/i,
    category: 'season_leaders',
  },
  {
    pattern:
      /\b(mvp|roy|rookie\s+of\s+the\s+year|dpoy|defensive\s+player|all.nba|all.defensive|all.star|all.rookie|award|honor|winner|vote)\b/i,
    category: 'awards',
  },
  {
    pattern:
      /\b(team\s+(record|season|rating|srs|pace|offensive|defensive)|warriors|bulls|celtics|lakers)\b/i,
    category: 'team_seasons',
  },
  {
    pattern: /\b(cross.check|cross\s+schema|between\s+(main|unified|bref|nbadb))\b/i,
    category: 'cross_schema',
  },
  {
    pattern:
      /\b(finals?\s+game|final\s+score|box\s+score|stat\s+line|game_id|playoff|post.?season)\b/i,
    category: 'games',
  },
  {
    pattern:
      /\b(shot\s+chart|three\s+pointer|corner\s+three|mid.range|at\s+the\s+rim|shot\s+distribution)\b/i,
    category: 'shot_charts',
  },
  { pattern: /\b(play.by.play|turnover|made\s+shot)\b/i, category: 'play_by_play' },
  {
    pattern:
      /\b(basketball.reference\s+id|nba\s+api\s+(person_id|id)|identity\s+bridge|unresolved|ambiguous)\b/i,
    category: 'identity',
  },
  { pattern: /\b(draft\s+pick|draft|first\s+overall)\b/i, category: 'draft' },
  { pattern: /\b(data\s+quality|dq_results|row\s+count|audit)\b/i, category: 'data_quality' },
];

function classifyQuestion(text: string): string {
  for (const { pattern, category } of INTENT_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return 'general';
}

export { classifyQuestion };

const SQL_ERROR_PREFIXES = [
  ERROR_PREFIX.SQL_ERROR,
  ERROR_PREFIX.SCHEMA_ERROR,
  ERROR_PREFIX.SYNTAX_ERROR,
  ERROR_PREFIX.TRANSIENT_ERROR,
  ERROR_PREFIX.SCHEMA_VALIDATION_FAILED,
];

function containsSqlError(content: string): boolean {
  return content
    .split('\n')
    .some((line) => SQL_ERROR_PREFIXES.some((prefix) => line.trim().startsWith(prefix)));
}

function extractNumbers(text: string): number[] {
  const matches = text.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g);
  if (!matches) return [];
  return matches.map((m) => parseFloat(m.replace(/,/g, '')));
}

function extractNumbersFromToolMessages(messages: readonly BaseMessage[]): Set<number> {
  const numbers = new Set<number>();
  for (const msg of messages) {
    if (ToolMessage.isInstance(msg)) {
      const content = typeof msg.content === 'string' ? msg.content : '';
      for (const n of extractNumbers(content)) {
        numbers.add(n);
      }
      const rawInts = content.match(/\b\d{4,}\b/g);
      for (const m of rawInts ?? []) {
        numbers.add(Number(m));
      }
    }
  }
  return numbers;
}

function getTrailingToolMessages(state: ChatbotStateType): ToolMessage[] {
  const toolMessages: ToolMessage[] = [];
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i];
    if (!ToolMessage.isInstance(message)) {
      break;
    }
    toolMessages.unshift(message);
  }
  return toolMessages;
}

const MAX_SYSTEM_MESSAGES = 5;
const MAX_NON_SYSTEM_MESSAGES = 40;

function trimMessagesForModel(state: ChatbotStateType) {
  const messages = state.messages;
  const systemMessages = messages.filter((message) => SystemMessage.isInstance(message));
  const nonSystemMessages = messages.filter((message) => !SystemMessage.isInstance(message));
  const retainedSystemMessages =
    systemMessages.length <= MAX_SYSTEM_MESSAGES
      ? systemMessages
      : [systemMessages[0]!, ...systemMessages.slice(-(MAX_SYSTEM_MESSAGES - 1))];
  return [...retainedSystemMessages, ...nonSystemMessages.slice(-MAX_NON_SYSTEM_MESSAGES)];
}

function getCheckpointer() {
  const persistDir = process.env['CHATBOT_PERSIST_DIR'];
  if (persistDir) {
    try {
      const require = createRequire(import.meta.url);
      const { SqliteSaver } = require('@langchain/langgraph-checkpoint-sqlite') as {
        SqliteSaver: new (opts: { path: string }) => MemorySaver;
      };
      return new SqliteSaver({ path: persistDir });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('@langchain/langgraph-checkpoint-sqlite')) {
        throw err;
      }
    }
  }
  return new MemorySaver();
}

function buildGraph() {
  const model = createModel().bindTools([...nbaTools]);

  async function callModel(state: ChatbotStateType): Promise<Partial<ChatbotStateType>> {
    const options = _abortSignal ? { signal: _abortSignal } : {};
    const response = await model.invoke(trimMessagesForModel(state), options);
    return { messages: [response] };
  }

  async function sqlCritic(state: ChatbotStateType): Promise<Partial<ChatbotStateType> | Command> {
    const toolMessages = getTrailingToolMessages(state);
    if (toolMessages.length === 0) {
      return new Command({ goto: 'llm', update: { sqlRetryCount: 0 } });
    }

    const totalToolCalls = (state.totalToolCalls ?? 0) + toolMessages.length;

    // Loop detection: same tool name with identical args 3+ times in current batch
    const toolSignatures = toolMessages.map((msg) => {
      const args = typeof msg.content === 'string' ? msg.content.slice(0, 80) : '';
      return `${msg.name}:${args}`;
    });
    const isLooping = toolSignatures.some(
      (sig) => toolSignatures.filter((s) => s === sig).length >= LOOP_DETECTION_THRESHOLD,
    );

    if (totalToolCalls > MAX_TOTAL_TOOL_CALLS || isLooping) {
      return new Command({
        goto: END,
        update: { sqlRetryCount: 0, totalToolCalls },
      });
    }

    const erroredContent = toolMessages
      .map((message) => String(message.content))
      .find((content) => containsSqlError(content));
    const currentRetry = state.sqlRetryCount ?? 0;

    if (erroredContent) {
      if (currentRetry >= MAX_SQL_RETRIES) {
        const errorMsg = new SystemMessage(
          `SQL validation failed after ${MAX_SQL_RETRIES} retries. Unable to execute query.`,
        );
        return new Command({
          goto: END,
          update: { messages: [errorMsg], sqlRetryCount: currentRetry, totalToolCalls },
        });
      }

      const nextRetry = currentRetry + 1;
      const systemMsg = new SystemMessage(
        `SQL validation failed: ${erroredContent}. Please correct the query.`,
      );
      return new Command({
        goto: 'llm',
        update: { messages: [systemMsg], sqlRetryCount: nextRetry, totalToolCalls },
      });
    }

    return new Command({ goto: 'llm', update: { sqlRetryCount: 0, totalToolCalls } });
  }

  async function classifyIntent(state: ChatbotStateType): Promise<Partial<ChatbotStateType>> {
    const messages = state.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]!;
      if (message._getType() === 'human' && typeof message.content === 'string') {
        const category = classifyQuestion(message.content);
        return { intentCategory: category };
      }
    }
    return { intentCategory: 'general' };
  }

  async function injectSchema(state: ChatbotStateType): Promise<Partial<ChatbotStateType>> {
    const intent = state.intentCategory ?? 'general';
    const schemaPrompt = await buildIntentSchemaPrompt(intent);
    if (!schemaPrompt) {
      return {};
    }
    const systemMsg = new SystemMessage(schemaPrompt);
    return { messages: [systemMsg] };
  }

  const toolNode = new ToolNode([...nbaTools]);

  async function validateAnswer(
    state: ChatbotStateType,
  ): Promise<Partial<ChatbotStateType> | Command> {
    const retries = state.validateAnswerRetries ?? 0;
    const lastMessage = state.messages[state.messages.length - 1];
    if (!lastMessage || lastMessage._getType() !== 'ai') {
      return new Command({ goto: END, update: { validateAnswerRetries: 0 } });
    }

    const answerText = typeof lastMessage.content === 'string' ? lastMessage.content : '';
    if (!answerText) {
      return new Command({ goto: END, update: { validateAnswerRetries: 0 } });
    }

    const answerNumbers = extractNumbers(answerText).filter(
      (n) => n >= HALLUCINATION_NUMBER_THRESHOLD && (n < 1900 || n > 2099),
    );
    if (answerNumbers.length === 0) {
      return new Command({ goto: END, update: { validateAnswerRetries: 0 } });
    }

    const dataNumbers = extractNumbersFromToolMessages(state.messages);
    const hallucinated = answerNumbers.filter((n) => !dataNumbers.has(n));

    if (hallucinated.length > 0) {
      if (retries >= MAX_VALIDATE_ANSWER_RETRIES) {
        // Exceeded retry budget — terminate to prevent infinite loop
        return new Command({ goto: END, update: { validateAnswerRetries: 0 } });
      }
      const correctionMsg = new SystemMessage(
        `HALLUCINATION DETECTED: You reported the number${hallucinated.length > 1 ? 's' : ''} ` +
          `${hallucinated.join(', ')} in your answer, but the database query results do not contain ` +
          'these values. Correct your answer to use only the exact numbers returned by the queries.',
      );
      return new Command({
        goto: 'llm',
        update: { messages: [correctionMsg], validateAnswerRetries: retries + 1 },
      });
    }

    return new Command({ goto: END, update: { validateAnswerRetries: 0 } });
  }

  return new StateGraph(ChatbotState)
    .addNode('classify_intent', classifyIntent)
    .addNode('inject_schema', injectSchema)
    .addNode('llm', callModel)
    .addNode('tools', toolNode)
    .addNode('sql_critic', sqlCritic, { ends: ['llm', END] })
    .addNode('validate_answer', validateAnswer, { ends: ['llm', END] })
    .addEdge(START, 'classify_intent')
    .addEdge('classify_intent', 'inject_schema')
    .addEdge('inject_schema', 'llm')
    .addConditionalEdges('llm', toolsCondition, {
      tools: 'tools',
      [END]: 'validate_answer',
    })
    .addEdge('tools', 'sql_critic')
    .compile({ checkpointer: getCheckpointer() });
}

let _graph: ReturnType<typeof buildGraph> | undefined;

export function getChatbotGraph() {
  if (!_graph) {
    _graph = buildGraph();
  }
  return _graph;
}

export function resetGraph() {
  _graph = undefined;
  invalidateSchemaCache();
}
