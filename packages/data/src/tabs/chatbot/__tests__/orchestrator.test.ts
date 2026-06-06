import { afterEach, test as baseTest, beforeEach, describe, expect, mock } from 'bun:test';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { fakeModel } from 'langchain';

const test = baseTest.serial;

describe.serial('orchestrator', () => {
  describe('parsePlan', () => {
    test('parses a multi-subtask plan', async () => {
      const { parsePlan } = await import('../agent/orchestrator.js');
      const raw =
        'Here is the plan: {"mode":"multi","subtasks":[' +
        '{"id":"a","focus":"LeBron MVPs","question":"How many MVPs does LeBron James have?"},' +
        '{"id":"b","focus":"Kareem MVPs","question":"How many MVPs does Kareem have?"}]}';
      const plan = parsePlan(raw, 'original');
      expect(plan.mode).toBe('multi');
      expect(plan.subtasks).toHaveLength(2);
      expect(plan.subtasks[0]!.question).toContain('LeBron');
    });

    test('detects a clarify plan with no subtasks', async () => {
      const { parsePlan } = await import('../agent/orchestrator.js');
      const plan = parsePlan('{"mode":"clarify","subtasks":[]}', 'Who is the best player?');
      expect(plan.mode).toBe('clarify');
      expect(plan.subtasks).toHaveLength(0);
    });

    test('falls back to a single subtask on unparseable output', async () => {
      const { parsePlan } = await import('../agent/orchestrator.js');
      const plan = parsePlan('not json at all', 'Who led the NBA in points in 2024?');
      expect(plan.mode).toBe('single');
      expect(plan.subtasks).toHaveLength(1);
      expect(plan.subtasks[0]!.question).toBe('Who led the NBA in points in 2024?');
    });

    test('caps subtasks at the maximum', async () => {
      const { parsePlan } = await import('../agent/orchestrator.js');
      const subtasks = Array.from({ length: 10 }, (_, i) => ({
        id: `t${i}`,
        focus: `f${i}`,
        question: `q${i}`,
      }));
      const plan = parsePlan(JSON.stringify({ mode: 'multi', subtasks }), 'orig');
      expect(plan.subtasks.length).toBeLessThanOrEqual(4);
    });
  });

  describe('graph pipeline (mocked model + db)', () => {
    let planJson: string;

    beforeEach(() => {
      planJson = '{"mode":"single","subtasks":[{"id":"t1","focus":"points","question":"Q"}]}';
    });
    afterEach(() => {
      mock.restore();
    });

    function installMocks() {
      mock.module('../db.js', () => ({
        query: async () => [{ player_name: 'Joel Embiid', pts: 2183 }],
        getTables: async () => ['fact_bref_player_season_totals'],
        getColumns: async () => [{ name: 'pts', type: 'BIGINT' }],
        getTableRefs: async () => [
          {
            schema: 'main',
            name: 'fact_bref_player_season_totals',
            type: 'BASE TABLE',
            qualifiedName: 'fact_bref_player_season_totals',
          },
          {
            schema: 'nbadb',
            name: 'fact_team_awards_championships',
            type: 'BASE TABLE',
            qualifiedName: 'nbadb.fact_team_awards_championships',
          },
        ],
        invalidateSchemaCache: () => {},
      }));

      // The model is constructed per node via createModel(); each gets its own
      // FakeBuiltModel instance with a factory that checks system role.
      mock.module('@langchain/openrouter', () => ({
        ChatOpenRouter: class {
          private model: ReturnType<typeof fakeModel>;
          constructor() {
            this.model = fakeModel().respond((messages) => {
              const system = String(messages[0]?.content ?? '');
              if (system.includes('PLANNER')) {
                return new AIMessage(planJson);
              }
              if (system.includes('SQL WORKER')) {
                // No tool_calls -> worker returns its finding immediately.
                return new AIMessage('Joel Embiid scored the most, with 2183 points.');
              }
              // Synthesizer.
              return new AIMessage('Joel Embiid scored the most points, with 2,183.');
            });
          }
          bindTools() {
            return this.model;
          }
          async invoke(messages: import('@langchain/core/messages').BaseMessage[]) {
            return this.model.invoke(messages);
          }
        },
      }));
    }

    test('runs plan -> workers -> synthesize and returns a final answer', async () => {
      installMocks();
      const { getOrchestratorGraph, resetOrchestratorGraph } = await import(
        '../agent/orchestrator.js'
      );
      resetOrchestratorGraph();
      const graph = getOrchestratorGraph();
      const result = await graph.invoke(
        { messages: [new HumanMessage('Who scored the most points in 2024?')] },
        { configurable: { thread_id: 'orch-test-1' } },
      );
      const last = result.messages[result.messages.length - 1]!;
      expect(last._getType()).toBe('ai');
      expect(String(last.content)).toContain('Joel Embiid');
      expect(result.planMode).toBe('single');
      expect(result.workerFindings?.[0]?.finding).toContain('2183');
    });

    test('clarify plan skips workers and still produces an answer', async () => {
      planJson = '{"mode":"clarify","subtasks":[]}';
      installMocks();
      const { getOrchestratorGraph, resetOrchestratorGraph } = await import(
        '../agent/orchestrator.js'
      );
      resetOrchestratorGraph();
      const graph = getOrchestratorGraph();
      const result = await graph.invoke(
        { messages: [new HumanMessage('Who is the best player?')] },
        { configurable: { thread_id: 'orch-test-2' } },
      );
      expect(result.planMode).toBe('clarify');
      expect(result.workerFindings).toHaveLength(0);
      const last = result.messages[result.messages.length - 1]!;
      expect(last._getType()).toBe('ai');
    });

    test('multi-subtask Send fan-out merges worker findings', async () => {
      planJson =
        '{"mode":"multi","subtasks":[' +
        '{"id":"a","focus":"LeBron MVPs","question":"How many MVPs does LeBron James have?"},' +
        '{"id":"b","focus":"Kareem MVPs","question":"How many MVPs does Kareem Abdul-Jabbar have?"}]}';

      mock.module('../db.js', () => ({
        query: async () => [{ player_name: 'Joel Embiid', pts: 2183 }],
        getTables: async () => ['fact_bref_player_season_totals'],
        getColumns: async () => [{ name: 'pts', type: 'BIGINT' }],
        getTableRefs: async () => [],
        invalidateSchemaCache: () => {},
      }));

      mock.module('@langchain/openrouter', () => ({
        ChatOpenRouter: class {
          private model: ReturnType<typeof fakeModel>;
          constructor() {
            this.model = fakeModel().respond((messages) => {
              const system = String(messages[0]?.content ?? '');
              const human = String(
                messages.find((m) => String(m?.content ?? '').includes('Worker findings'))
                  ?.content ??
                  messages.at(-1)?.content ??
                  '',
              );
              if (system.includes('PLANNER')) {
                return new AIMessage(planJson);
              }
              if (system.includes('SQL WORKER')) {
                if (human.includes('LeBron')) {
                  return new AIMessage('LeBron James has 4 MVP awards.');
                }
                if (human.includes('Kareem')) {
                  return new AIMessage('Kareem Abdul-Jabbar has 6 MVP awards.');
                }
                return new AIMessage('No finding produced.');
              }
              if (system.includes('SYNTHESIZER')) {
                return new AIMessage(
                  'LeBron James has 4 MVP awards; Kareem Abdul-Jabbar has 6 MVP awards.',
                );
              }
              return new AIMessage('Unexpected mock path.');
            });
          }
          bindTools() {
            return this.model;
          }
          async invoke(messages: import('@langchain/core/messages').BaseMessage[]) {
            return this.model.invoke(messages);
          }
        },
      }));

      const { getOrchestratorGraph, resetOrchestratorGraph } = await import(
        '../agent/orchestrator.js'
      );
      resetOrchestratorGraph();
      const graph = getOrchestratorGraph();
      const result = await graph.invoke(
        {
          messages: [new HumanMessage('Who has more MVPs, LeBron James or Kareem Abdul-Jabbar?')],
        },
        { configurable: { thread_id: 'orch-test-3' } },
      );

      expect(result.planMode).toBe('multi');
      expect(result.workerFindings).toHaveLength(2);
      expect(result.workerFindings?.some((f) => f.finding.includes('LeBron'))).toBe(true);
      expect(result.workerFindings?.some((f) => f.finding.includes('Kareem'))).toBe(true);
      const last = result.messages[result.messages.length - 1]!;
      expect(String(last.content)).toContain('4');
      expect(String(last.content)).toContain('6');
    });
  });
});
