import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RunContext {
  runId: string;
  turn: number;
  intent?: string;
  model?: string;
}

export const runContextStore = new AsyncLocalStorage<RunContext>();

/**
 * Wraps a callback in a fresh async-local run context with a new runId.
 * Resets the context after the callback completes.
 */
export async function withRun<T>(turn: number, fn: () => Promise<T>): Promise<T> {
  const runId = randomUUID();
  return runContextStore.run({ runId, turn }, fn);
}

/**
 * Wraps a callback in an async-local context with the given partial context.
 * Merges with any existing context and generates a runId if none is set.
 * Useful for nested/child operations that want to share or extend the parent
 * runId.
 */
export async function withRunContext<T>(
  ctx: Partial<RunContext>,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = runContextStore.getStore();
  const merged: RunContext = {
    runId: existing?.runId ?? randomUUID(),
    turn: existing?.turn ?? -1,
    intent: ctx.intent ?? existing?.intent,
    model: ctx.model ?? existing?.model,
  };
  if (ctx.runId) merged.runId = ctx.runId;
  if (ctx.turn !== undefined) merged.turn = ctx.turn;
  return runContextStore.run(merged, fn);
}

/**
 * Returns the current `RunContext` from async-local storage, or a fallback
 * `{ runId: 'no-run', turn: -1 }` if none is active.
 */
export function currentRun(): RunContext {
  return runContextStore.getStore() ?? { runId: 'no-run', turn: -1 };
}

/**
 * Merges a patch into the currently active run context (in-place mutation of
 * the async-local store, not a nested scoped run). No-op when no context is
 * active.
 */
export function updateRunContext(patch: Partial<RunContext>): void {
  const existing = runContextStore.getStore();
  if (!existing) return;
  runContextStore.enterWith({ ...existing, ...patch });
}
