import { describe, expect, mock, test } from 'bun:test';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

describe('chatbotGraph', () => {
  let nextToolResponse: string;
  let forceToolCalls: boolean;

  mock.module('@langchain/openai', () => ({
    ChatOpenAI: class {
      bindTools() {
        return this;
      }
      async invoke(messages: Record<string, unknown>[]) {
        const lastMsg = messages[messages.length - 1];
        const isToolResult = lastMsg && 'tool_call_id' in lastMsg;
        if (isToolResult) {
          return new AIMessage(nextToolResponse);
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
    query: async () => [{ person_id: '2544', player_name: 'LeBron James' }],
    getTables: async () => [],
    getColumns: async () => [],
  }));

  test('processes a question without tool calls', async () => {
    forceToolCalls = false;
    const { chatbotGraph } = await import('../graph/graph.js');

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
    const { chatbotGraph } = await import('../graph/graph.js');

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
    const { chatbotGraph } = await import('../graph/graph.js');

    const result = await chatbotGraph.invoke(
      { messages: [new HumanMessage('Query a bad table')] },
      { configurable: { thread_id: 'err-test' } },
    );

    const hasToolMessage = result.messages.some((m) => ToolMessage.isInstance(m));
    expect(hasToolMessage).toBe(true);
  });

  test('maintains conversation state across turns', async () => {
    forceToolCalls = false;
    const { chatbotGraph } = await import('../graph/graph.js');

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
});
