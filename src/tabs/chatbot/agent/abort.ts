/**
 * Shared abort-signal holder for the chatbot agent graphs.
 *
 * Both the single-agent worker graph (graph.ts) and the multi-agent
 * orchestrator (orchestrator.ts) need to honour the same caller-supplied
 * AbortSignal. Keeping it in its own module avoids a circular import between
 * graph.ts and orchestrator.ts.
 */

let _abortSignal: AbortSignal | undefined;

export function setAbortSignal(signal: AbortSignal | undefined): void {
  _abortSignal = signal;
}

export function getAbortSignal(): AbortSignal | undefined {
  return _abortSignal;
}

/** Invoke options that carry the active abort signal, or an empty object. */
export function abortOptions(): { signal?: AbortSignal } {
  return _abortSignal ? { signal: _abortSignal } : {};
}
