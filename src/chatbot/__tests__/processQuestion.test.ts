import { describe, expect, mock, test } from 'bun:test';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';

describe('chatbotGraph', () => {
  let nextToolResponse: string;
  let forceToolCalls: boolean;
  let forceParallelCalls = false;
  let forceMixedParallelError = false;
  let forceQueryError = false;
  let forceNeedsSchemaTools = false;

  mock.module('@langchain/openai', () => ({
    ChatOpenAI: class {
      bindTools() {
        return this;
      }
      async invoke(messages: Record<string, unknown>[]) {
        const hasToolResult = messages.some((m) => m && 'tool_call_id' in m);
        const hasSqlCorrectionRequest = messages.some(
          (m) =>
            m &&
            'content' in m &&
            typeof m.content === 'string' &&
            m.content.includes('SQL validation failed'),
        );
        if (hasSqlCorrectionRequest) {
          return new AIMessage(nextToolResponse);
        }
        if (hasToolResult) {
          return new AIMessage(nextToolResponse);
        }
        if (forceNeedsSchemaTools) {
          return new AIMessage({
            content: '',
            tool_calls: [
              {
                id: 'call_list',
                name: 'list_nba_tables',
                args: { search: 'player' },
              },
              {
                id: 'call_check',
                name: 'check_nba_sql',
                args: { sql: 'SELECT player_name FROM dim_player LIMIT 1' },
              },
            ],
          });
        }
        if (forceMixedParallelError) {
          return new AIMessage({
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                name: 'query_nba_db',
                args: { sql: 'SELECT * FROM missing_table' },
              },
              {
                id: 'call_2',
                name: 'get_schema_info',
                args: { tableName: 'dim_player' },
              },
            ],
          });
        }
        if (forceParallelCalls) {
          return new AIMessage({
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                name: 'query_nba_db',
                args: { sql: "SELECT * FROM dim_player WHERE name LIKE '%LeBron%'" },
              },
              {
                id: 'call_2',
                name: 'query_nba_db',
                args: { sql: "SELECT * FROM dim_player WHERE name LIKE '%Jordan%'" },
              },
            ],
          });
        }
        if (forceToolCalls) {
          return new AIMessage({
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                name: 'query_nba_db',
                args: { sql: 'SELECT * FROM dim_player LIMIT 1' },
              },
            ],
          });
        }
        return new AIMessage('LeBron James scored 30 points last night.');
      }
    },
  }));

  mock.module('../db.js', () => ({
    query: async () => {
      if (forceQueryError) throw new Error('table not found');
      return [{ person_id: '2544', player_name: 'LeBron James' }];
    },
    getTables: async () => ['dim_player'],
    getColumns: async () => [],
    getTableRefs: async () => [
      { schema: 'main', name: 'dim_player', type: 'BASE TABLE', qualifiedName: 'dim_player' },
    ],
  }));

  test('processes a question without tool calls', async () => {
    forceToolCalls = false;
    const { getChatbotGraph } = await import('../agent/graph.js');
    const chatbotGraph = getChatbotGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('How many points?')] },
      { configurable: { thread_id: 'no-tools' } },
    );

    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.content).toContain('LeBron');
  });

  test('handles tool calls and returns final answer', async () => {
    forceToolCalls = true;
    nextToolResponse = 'The database has LeBron James.';
    const { getChatbotGraph } = await import('../agent/graph.js');
    const chatbotGraph = getChatbotGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Who is in the DB?')] },
      { configurable: { thread_id: 'tools-test' } },
    );

    const hasToolMessage = result.messages.some((m) => ToolMessage.isInstance(m));
    expect(hasToolMessage).toBe(true);
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.content).toContain('LeBron');
  });

  test('handles SQL execution error gracefully', async () => {
    forceToolCalls = true;
    nextToolResponse = 'I could not find that table.';
    const { getChatbotGraph } = await import('../agent/graph.js');
    const chatbotGraph = getChatbotGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Query a bad table')] },
      { configurable: { thread_id: 'err-test' } },
    );

    const hasToolMessage = result.messages.some((m) => ToolMessage.isInstance(m));
    expect(hasToolMessage).toBe(true);
  });

  test('maintains conversation state across turns', async () => {
    forceToolCalls = false;
    const { getChatbotGraph, resetGraph } = await import('../agent/graph.js');
    resetGraph();
    const chatbotGraph = getChatbotGraph();

    const config = { configurable: { thread_id: 'multi-turn' } };

    const r1 = await chatbotGraph.invoke(
      { messages: [new HumanMessage('First question')] },
      config,
    );
    const r2 = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Second question')] },
      config,
    );

    expect(r1.messages.length).toBeGreaterThan(1);
    expect(r2.messages.length).toBeGreaterThan(r1.messages.length);
  });

  test('handles parallel tool calls', async () => {
    forceToolCalls = false;
    forceParallelCalls = true;
    nextToolResponse = 'Both players found in the database.';
    const { getChatbotGraph, resetGraph } = await import('../agent/graph.js');
    resetGraph();
    const chatbotGraph = getChatbotGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Compare LeBron and MJ stats')] },
      { configurable: { thread_id: 'parallel-test' } },
    );

    const toolMessages = result.messages.filter((m) => ToolMessage.isInstance(m));
    expect(toolMessages.length).toBe(2);
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.content).toContain('Both players found');
    forceParallelCalls = false;
  });

  test('routes any SQL error from parallel tool calls back to llm', async () => {
    forceToolCalls = false;
    forceMixedParallelError = true;
    nextToolResponse = 'I corrected the failed query after reviewing schema.';
    const { getChatbotGraph, resetGraph } = await import('../agent/graph.js');
    resetGraph();
    const chatbotGraph = getChatbotGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Compare with one bad query')] },
      { configurable: { thread_id: 'parallel-error-test' } },
    );

    const systemMessages = result.messages.filter((m) => SystemMessage.isInstance(m));
    expect(systemMessages.length).toBeGreaterThan(0);
    expect(systemMessages[0].content).toContain('SQL validation failed');
    expect(result.sqlRetryCount).toBe(1);
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.content).toContain('corrected');
    forceMixedParallelError = false;
  });

  test('binds table listing and SQL checking tools', async () => {
    forceToolCalls = false;
    forceNeedsSchemaTools = true;
    nextToolResponse = 'The schema and query check succeeded.';
    const { getChatbotGraph, resetGraph } = await import('../agent/graph.js');
    resetGraph();
    const chatbotGraph = getChatbotGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Find player schema before querying')] },
      { configurable: { thread_id: 'schema-tools-test' } },
    );

    const toolMessages = result.messages.filter((m) => ToolMessage.isInstance(m));
    expect(toolMessages.length).toBe(2);
    expect(toolMessages.map((m) => m.name).sort()).toEqual(['check_nba_sql', 'list_nba_tables']);
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.content).toContain('schema and query check succeeded');
    forceNeedsSchemaTools = false;
  });

  test('routes SQL errors back to llm for correction', async () => {
    forceToolCalls = true;
    forceQueryError = true;
    nextToolResponse = 'SQL Error: table not found';
    const { getChatbotGraph, resetGraph } = await import('../agent/graph.js');
    resetGraph();
    const chatbotGraph = getChatbotGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Query a bad table')] },
      { configurable: { thread_id: 'critic-retry-test' } },
    );

    const systemMessages = result.messages.filter((m) => SystemMessage.isInstance(m));
    expect(systemMessages.length).toBeGreaterThan(0);
    expect(systemMessages[0].content).toContain('SQL validation failed');
    expect(result.sqlRetryCount).toBe(1);
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg).toBeInstanceOf(AIMessage);
  });

  test('resets retry count on clean tool result', async () => {
    forceToolCalls = true;
    forceQueryError = false;
    nextToolResponse = 'Query returned 5 rows.';
    const { getChatbotGraph, resetGraph } = await import('../agent/graph.js');
    resetGraph();
    const chatbotGraph = getChatbotGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Query something valid')], sqlRetryCount: 2 },
      { configurable: { thread_id: 'critic-clean-test' } },
    );

    expect(result.sqlRetryCount ?? 0).toBe(0);
  });

  test('ends after max SQL retries exceeded', async () => {
    forceToolCalls = true;
    forceQueryError = true;
    nextToolResponse = 'SQL Error: table not found';
    const { getChatbotGraph, resetGraph } = await import('../agent/graph.js');
    resetGraph();
    const chatbotGraph = getChatbotGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Query a bad table')], sqlRetryCount: 3 },
      { configurable: { thread_id: 'critic-max-test' } },
    );

    const systemMessages = result.messages.filter((m) => SystemMessage.isInstance(m));
    expect(systemMessages.length).toBeGreaterThan(0);
    expect(systemMessages[0].content).toContain('failed after 3 retries');
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg).toBeInstanceOf(SystemMessage);
  });
});
