import { afterEach, test as baseTest, beforeEach, describe, expect, mock } from 'bun:test';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { fakeModel } from 'langchain';

const test = baseTest.serial;

// Force MemorySaver even when CHATBOT_PERSIST_DIR is set in .env
delete process.env['CHATBOT_PERSIST_DIR'];

/**
 * Module-scoped fake model reference.
 * Tests reassign this before importing the graph to control the response sequence.
 */
let modelRef: ReturnType<typeof fakeModel>;

describe.serial('chatbotGraph', () => {
  let forceQueryError = false;

  beforeEach(() => {
    forceQueryError = false;
    modelRef = fakeModel().respond(new AIMessage('LeBron James scored 30 points last night.'));
  });

  afterEach(() => {
    forceQueryError = false;
  });

  mock.module('@langchain/openrouter', () => ({
    ChatOpenRouter: class {
      bindTools() {
        return modelRef;
      }
      async invoke(messages: import('@langchain/core/messages').BaseMessage[]) {
        return modelRef.invoke(messages);
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
      { schema: 'main', name: 'fact_game', type: 'BASE TABLE', qualifiedName: 'fact_game' },
      {
        schema: 'main',
        name: 'fact_player_award_vote',
        type: 'BASE TABLE',
        qualifiedName: 'fact_player_award_vote',
      },
      {
        schema: 'stg_bref',
        name: 'player_totals',
        type: 'BASE TABLE',
        qualifiedName: 'stg_bref.player_totals',
      },
    ],
    invalidateSchemaCache: () => {},
  }));

  test('processes a question without tool calls', async () => {
    const { getWorkerGraph } = await import('../agent/graph.js');
    const chatbotGraph = getWorkerGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('How many points?')] },
      { configurable: { thread_id: 'no-tools' } },
    );

    const lastMsg = result.messages[result.messages.length - 1]!;
    expect(lastMsg.content).toContain('LeBron');
  });

  test('handles tool calls and returns final answer', async () => {
    modelRef = fakeModel()
      .respondWithTools([
        { name: 'query_nba_db', args: { sql: 'SELECT * FROM dim_player LIMIT 1' }, id: 'call_1' },
      ])
      .respond(new AIMessage('The database has LeBron James.'));
    const { getWorkerGraph } = await import('../agent/graph.js');
    const chatbotGraph = getWorkerGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Who is in the DB?')] },
      { configurable: { thread_id: 'tools-test' } },
    );

    const hasToolMessage = result.messages.some((m) => ToolMessage.isInstance(m));
    expect(hasToolMessage).toBe(true);
    const lastMsg = result.messages[result.messages.length - 1]!;
    expect(lastMsg.content).toContain('LeBron');
  });

  test('handles SQL execution error gracefully', async () => {
    modelRef = fakeModel()
      .respondWithTools([
        { name: 'query_nba_db', args: { sql: 'SELECT * FROM dim_player LIMIT 1' }, id: 'call_1' },
      ])
      .respond(new AIMessage('I could not find that table.'));
    const { getWorkerGraph } = await import('../agent/graph.js');
    const chatbotGraph = getWorkerGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Query a bad table')] },
      { configurable: { thread_id: 'err-test' } },
    );

    const hasToolMessage = result.messages.some((m) => ToolMessage.isInstance(m));
    expect(hasToolMessage).toBe(true);
  });

  test('maintains conversation state across turns', async () => {
    modelRef = fakeModel()
      .respond(new AIMessage('LeBron James scored 30 points last night.'))
      .respond(new AIMessage('LeBron James scored 30 points last night.'));
    const { getWorkerGraph, resetGraph } = await import('../agent/graph.js');
    resetGraph();
    const chatbotGraph = getWorkerGraph();

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
    modelRef = fakeModel()
      .respondWithTools([
        {
          name: 'query_nba_db',
          args: { sql: "SELECT * FROM dim_player WHERE name LIKE '%LeBron%'" },
          id: 'call_1',
        },
        {
          name: 'query_nba_db',
          args: { sql: "SELECT * FROM dim_player WHERE name LIKE '%Jordan%'" },
          id: 'call_2',
        },
      ])
      .respond(new AIMessage('Both players found in the database.'));
    const { getWorkerGraph, resetGraph } = await import('../agent/graph.js');
    resetGraph();
    const chatbotGraph = getWorkerGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Compare LeBron and MJ stats')] },
      { configurable: { thread_id: 'parallel-test' } },
    );

    const toolMessages = result.messages.filter((m) => ToolMessage.isInstance(m));
    expect(toolMessages.length).toBe(2);
    const lastMsg = result.messages[result.messages.length - 1]!;
    expect(lastMsg!.content).toContain('Both players found');
  });

  test('routes any SQL error from parallel tool calls back to llm', async () => {
    modelRef = fakeModel()
      .respondWithTools([
        { name: 'query_nba_db', args: { sql: 'SELECT * FROM missing_table' }, id: 'call_1' },
        { name: 'get_schema_info', args: { tableName: 'dim_player' }, id: 'call_2' },
      ])
      .respond(new AIMessage('I corrected the failed query after reviewing schema.'));
    const { getWorkerGraph, resetGraph } = await import('../agent/graph.js');
    resetGraph();
    const chatbotGraph = getWorkerGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Compare with one bad query')] },
      { configurable: { thread_id: 'parallel-error-test' } },
    );

    const systemMessages = result.messages.filter((m) => SystemMessage.isInstance(m));
    expect(systemMessages.length).toBeGreaterThan(0);
    expect(systemMessages[0]!.content).toContain('SQL validation failed');
    expect(result.sqlRetryCount ?? 0).toBe(0);
    const lastMsg = result.messages[result.messages.length - 1]!;
    expect(lastMsg.content).toContain('corrected');
  });

  test('binds table listing and SQL checking tools', async () => {
    modelRef = fakeModel()
      .respondWithTools([
        { name: 'list_nba_tables', args: { search: 'player' }, id: 'call_list' },
        {
          name: 'check_nba_sql',
          args: { sql: 'SELECT player_name FROM dim_player LIMIT 1' },
          id: 'call_check',
        },
      ])
      .respond(new AIMessage('The schema and query check succeeded.'));
    const { getWorkerGraph, resetGraph } = await import('../agent/graph.js');
    resetGraph();
    const chatbotGraph = getWorkerGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Find player schema before querying')] },
      { configurable: { thread_id: 'schema-tools-test' } },
    );

    const toolMessages = result.messages.filter((m) => ToolMessage.isInstance(m));
    expect(toolMessages.length).toBe(2);
    expect(toolMessages.map((m) => m.name).sort()).toEqual(['check_nba_sql', 'list_nba_tables']);
    const lastMsg = result.messages[result.messages.length - 1]!;
    expect(lastMsg.content).toContain('schema and query check succeeded');
  });

  test('routes SQL errors back to llm for correction', async () => {
    forceQueryError = true;
    modelRef = fakeModel()
      .respondWithTools([
        { name: 'query_nba_db', args: { sql: 'SELECT * FROM dim_player LIMIT 1' }, id: 'call_1' },
      ])
      .respond(new AIMessage('SQL Error: table not found'));
    const { getWorkerGraph, resetGraph } = await import('../agent/graph.js');
    resetGraph();
    const chatbotGraph = getWorkerGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Query a bad table')] },
      { configurable: { thread_id: 'critic-retry-test' } },
    );

    const systemMessages = result.messages.filter((m) => SystemMessage.isInstance(m));
    expect(systemMessages.length).toBeGreaterThan(0);
    expect(systemMessages[0]!.content).toContain('SQL validation failed');
    expect(result.sqlRetryCount ?? 0).toBe(0);
    const lastMsg = result.messages[result.messages.length - 1]!;
    expect(lastMsg).toBeInstanceOf(AIMessage);
  });

  test('resets retry count on clean tool result', async () => {
    forceQueryError = false;
    modelRef = fakeModel()
      .respondWithTools([
        { name: 'query_nba_db', args: { sql: 'SELECT * FROM dim_player LIMIT 1' }, id: 'call_1' },
      ])
      .respond(new AIMessage('Query returned 5 rows.'));
    const { getWorkerGraph, resetGraph } = await import('../agent/graph.js');
    resetGraph();
    const chatbotGraph = getWorkerGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Query something valid')], sqlRetryCount: 2 },
      { configurable: { thread_id: 'critic-clean-test' } },
    );

    expect(result.sqlRetryCount ?? 0).toBe(0);
  });

  test('resets per-turn tool budget before handling a new tool call', async () => {
    forceQueryError = false;
    modelRef = fakeModel()
      .respondWithTools([
        { name: 'query_nba_db', args: { sql: 'SELECT * FROM dim_player LIMIT 1' }, id: 'call_1' },
      ])
      .respond(new AIMessage('Query returned after a fresh turn budget.'));
    const { getWorkerGraph, resetGraph } = await import('../agent/graph.js');
    resetGraph();
    const chatbotGraph = getWorkerGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Query something valid')], totalToolCalls: 10 },
      { configurable: { thread_id: 'fresh-tool-budget-test' } },
    );

    const lastMsg = result.messages[result.messages.length - 1]!;
    expect(lastMsg).toBeInstanceOf(AIMessage);
    expect(lastMsg.content).toContain('fresh turn budget');
    expect(result.totalToolCalls ?? 0).toBe(0);
  });

  test('ends after max SQL retries exceeded', async () => {
    forceQueryError = true;
    modelRef = fakeModel()
      .respondWithTools([
        { name: 'query_nba_db', args: { sql: 'SELECT * FROM dim_player LIMIT 1' }, id: 'call_1' },
      ])
      .respondWithTools([{ name: 'query_nba_db', args: { sql: 'SELECT * FROM missing_table' } }])
      .respondWithTools([{ name: 'query_nba_db', args: { sql: 'SELECT * FROM missing_table' } }])
      .respondWithTools([{ name: 'query_nba_db', args: { sql: 'SELECT * FROM missing_table' } }]);
    const { getWorkerGraph, resetGraph } = await import('../agent/graph.js');
    resetGraph();
    const chatbotGraph = getWorkerGraph();

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Query a bad table')] },
      { configurable: { thread_id: 'critic-max-test' } },
    );

    const systemMessages = result.messages.filter((m) => SystemMessage.isInstance(m));
    const maxRetryMessage = systemMessages.find(
      (message) =>
        typeof message.content === 'string' && message.content.includes('failed after 3 retries'),
    );
    expect(maxRetryMessage).toBeDefined();
    const lastMsg = result.messages[result.messages.length - 1]!;
    expect(lastMsg).toBeInstanceOf(SystemMessage);
  });
});
