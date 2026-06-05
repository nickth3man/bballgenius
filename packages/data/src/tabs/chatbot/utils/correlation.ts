import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RunContext {
  runId: string;
  turn: number;
  intent?: string;
  model?: string;
}

export const runContextStore = new AsyncLocalStorage<RunContext>();

export async function withRun<T>(turn: number, fn: () => Promise<T>): Promise<T> {
  const runId = randomUUID();
  return runContextStore.run({ runId, turn }, fn);
}

export async function withRunContext<T>(
  ctx: Partial<RunContext>,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = runContextStore.getStore();
  const merged: RunContext = {
    runId: randomUUID(),
    turn: -1,
    ...existing,
    ...ctx,
  };
  return runContextStore.run(merged, fn);
}

export function currentRun(): RunContext {
  return runContextStore.getStore() ?? { runId: 'no-run', turn: -1 };
}

export function updateRunContext(patch: Partial<RunContext>): void {
  const existing = runContextStore.getStore();
  if (!existing) return;
  runContextStore.enterWith({ ...existing, ...patch });
}
