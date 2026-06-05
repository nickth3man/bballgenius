import { updateRunContext } from './correlation.js';
import { logMetric } from './metrics.js';

export interface ErrorContext {
  intent?: string;
  model?: string;
  sql?: string;
  toolName?: string;
  retryCount?: number;
  stage?: string;
  question?: string;
  runId?: string;
}

export function captureError(err: unknown, ctx?: ErrorContext): Error {
  if (ctx?.runId) {
    updateRunContext({ runId: ctx.runId });
  }

  const record: Record<string, unknown> = {
    level: 'error',
    event: 'error',
    ...ctx,
  };

  if (err instanceof Error) {
    record.errName = err.name;
    record.errMessage = err.message;
    record.stack = err.stack;
  } else {
    record.errName = 'Unknown';
    record.errMessage = String(err);
  }

  if (ctx?.sql) {
    record.sqlPreview = ctx.sql.slice(0, 500);
  }

  logMetric(record as { level?: string; [k: string]: unknown });

  if (err instanceof Error) return err;
  return new Error(String(err));
}
