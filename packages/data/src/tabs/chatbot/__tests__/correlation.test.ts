import { test as baseTest, describe, expect } from 'bun:test';

const test = baseTest.serial;

describe.serial('correlation', () => {
  test('withRun generates a unique runId per call', async () => {
    const { withRun, currentRun } = await import('../utils/correlation.js');

    const r1: string[] = [];
    const r2: string[] = [];

    await withRun(0, async () => {
      r1.push(currentRun().runId);
    });
    await withRun(0, async () => {
      r2.push(currentRun().runId);
    });

    expect(r1[0]).toBeDefined();
    expect(r2[0]).toBeDefined();
    expect(r1[0]).not.toBe(r2[0]);
  });

  test('currentRun() outside a withRun returns fallback', async () => {
    const { currentRun } = await import('../utils/correlation.js');
    const ctx = currentRun();
    expect(ctx.runId).toBe('no-run');
    expect(ctx.turn).toBe(-1);
  });

  test('currentRun() inside withRun returns the runId', async () => {
    const { withRun, currentRun } = await import('../utils/correlation.js');

    let captured: string | undefined;
    await withRun(42, async () => {
      captured = currentRun().runId;
    });

    expect(captured).toBeDefined();
    expect(typeof captured).toBe('string');
  });

  test('currentRun() inside withRun returns turn 42', async () => {
    const { withRun, currentRun } = await import('../utils/correlation.js');

    let capturedTurn: number | undefined;
    await withRun(42, async () => {
      capturedTurn = currentRun().turn;
    });

    expect(capturedTurn).toBe(42);
  });

  test('updateRunContext patches the store', async () => {
    const { withRun, currentRun, updateRunContext } = await import('../utils/correlation.js');

    await withRun(0, async () => {
      updateRunContext({ intent: 'career_leaders' });
      const ctx = currentRun();
      expect(ctx.intent).toBe('career_leaders');
    });
  });

  test('updateRunContext patches turn and model', async () => {
    const { withRun, currentRun, updateRunContext } = await import('../utils/correlation.js');

    await withRun(0, async () => {
      updateRunContext({ model: 'gpt-4' });
      expect(currentRun().model).toBe('gpt-4');
    });
  });

  test('updateRunContext is no-op outside a withRun', async () => {
    const { updateRunContext, currentRun } = await import('../utils/correlation.js');

    // Should not throw
    updateRunContext({ intent: 'test' });
    const ctx = currentRun();
    expect(ctx.runId).toBe('no-run');
  });

  test('withRunContext preserves a pre-existing runId', async () => {
    const { withRunContext, currentRun } = await import('../utils/correlation.js');

    await withRunContext({ runId: 'my-id', turn: 0 }, async () => {
      expect(currentRun().runId).toBe('my-id');
      expect(currentRun().turn).toBe(0);
    });
  });

  test('withRunContext merges with existing context', async () => {
    const { withRunContext, currentRun } = await import('../utils/correlation.js');

    await withRunContext({ runId: 'parent', turn: 0, model: 'gpt-4' }, async () => {
      // Nested withRunContext should inherit model from parent
      await withRunContext({ runId: 'child', turn: 1 }, async () => {
        const ctx = currentRun();
        expect(ctx.runId).toBe('child');
        expect(ctx.turn).toBe(1);
        expect(ctx.model).toBe('gpt-4');
      });

      // After nested call, parent context should be restored
      expect(currentRun().runId).toBe('parent');
    });
  });
});
