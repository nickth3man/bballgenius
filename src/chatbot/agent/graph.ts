import { SystemMessage, ToolMessage } from '@langchain/core/messages';
import { Command, END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';
import { ERROR_PREFIX } from '../utils/retry.js';
import { createModel } from './model.js';
import { ChatbotState, type ChatbotStateType } from './state.js';
import { nbaTools } from './tools.js';

const MAX_SQL_RETRIES = 3;

const INTENT_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  {
    pattern:
      /\b(triple.doubles?|quadruple.doubles?|50.point|career\s+(points|rebounds|assists|steals|blocks|games|three|free\s+throw))\b/i,
    category: 'career_leaders',
  },
  {
    pattern:
      /\b(career\s+leader|all.time|most\s+(points|rebounds|assists|steals|blocks|three|games))\b/i,
    category: 'career_leaders',
  },
  {
    pattern:
      /\b(season\s+leader|points?\s+per\s+game|assists?\s+per\s+game|rebounds?\s+per\s+game|led\s+the\s+nba)\b/i,
    category: 'season_leaders',
  },
  {
    pattern:
      /\b(mvp|roy|rookie\s+of\s+the\s+year|dpoy|defensive\s+player|all.nba|all.defensive|all.star|all.rookie)\b/i,
    category: 'awards',
  },
  { pattern: /\b(award|honor|winner|vote)\b/i, category: 'awards' },
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
    pattern: /\b(finals?\s+game|final\s+score|box\s+score|stat\s+line|game_id)\b/i,
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
  const firstLine = (content.split('\n')[0] ?? '').trim();
  return SQL_ERROR_PREFIXES.some((prefix) => firstLine.startsWith(prefix));
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

function trimMessagesForModel(state: ChatbotStateType) {
  const messages = state.messages;
  const systemMessages = messages.filter((message) => SystemMessage.isInstance(message));
  const nonSystemMessages = messages.filter((message) => !SystemMessage.isInstance(message));
  const retainedSystemMessages =
    systemMessages.length <= 5 ? systemMessages : [systemMessages[0]!, ...systemMessages.slice(-4)];
  return [...retainedSystemMessages, ...nonSystemMessages.slice(-40)];
}

function getCheckpointer() {
  const persistDir = process.env['CHATBOT_PERSIST_DIR'];
  if (persistDir) {
    const { SqliteSaver } = require('@langchain/langgraph-checkpoint-sqlite') as {
      SqliteSaver: new (opts: { path: string }) => MemorySaver;
    };
    return new SqliteSaver({ path: persistDir });
  }
  return new MemorySaver();
}

function buildGraph() {
  const model = createModel().bindTools([...nbaTools]);

  async function callModel(state: ChatbotStateType): Promise<Partial<ChatbotStateType>> {
    const response = await model.invoke(trimMessagesForModel(state));
    return { messages: [response] };
  }

  async function sqlCritic(state: ChatbotStateType): Promise<Partial<ChatbotStateType> | Command> {
    const toolMessages = getTrailingToolMessages(state);
    if (toolMessages.length === 0) {
      return new Command({ goto: 'llm', update: { sqlRetryCount: 0 } });
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
          update: { messages: [errorMsg], sqlRetryCount: currentRetry },
        });
      }

      const nextRetry = currentRetry + 1;
      const systemMsg = new SystemMessage(
        `SQL validation failed: ${erroredContent}. Please correct the query.`,
      );
      return new Command({
        goto: 'llm',
        update: { messages: [systemMsg], sqlRetryCount: nextRetry },
      });
    }

    return new Command({ goto: 'llm', update: { sqlRetryCount: 0 } });
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

  const toolNode = new ToolNode([...nbaTools]);

  return new StateGraph(ChatbotState)
    .addNode('classify_intent', classifyIntent)
    .addNode('llm', callModel)
    .addNode('tools', toolNode)
    .addNode('sql_critic', sqlCritic)
    .addEdge(START, 'classify_intent')
    .addEdge('classify_intent', 'llm')
    .addConditionalEdges('llm', toolsCondition, {
      tools: 'tools',
      [END]: END,
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
}
