// Sprint 7.2 — Self-hosted error tracker.
// Captures unhandled errors and writes them to the error_events table.
// Fire-and-forget; never block the request path.
import type { Context } from 'hono';
import { prisma } from '@pos/db';
import { logger } from '../logger.js';
import { getRequestId } from '../middleware/request-context.js';

export type ErrorSeverity = 'ERROR' | 'WARN' | 'FATAL';
export type ErrorSource = 'API' | 'WORKER' | 'WEBHOOK';

export interface ErrorCapture {
  severity?: ErrorSeverity;
  source?: ErrorSource;
  message: string;
  err?: Error | unknown;
  context?: Record<string, unknown>;
}

const MAX_STACK_LEN = 4000;
const MAX_MESSAGE_LEN = 2000;

function truncate(s: string | undefined | null, max: number): string | undefined {
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// Strip obvious secrets from context (best-effort; not exhaustive).
function sanitizeContext(ctx: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!ctx) return undefined;
  const SENSITIVE = /password|token|secret|api[-_]?key|authorization|cookie/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (SENSITIVE.test(k)) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'string' && v.length > 1000) {
      out[k] = v.slice(0, 1000) + '…';
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function captureError(c: Context, capture: ErrorCapture): void {
  const err = capture.err as Error | undefined;
  const statusCode = (c.res && c.res.status) || 500;
  const user = c.get('user' as any) as { id?: string } | undefined;
  const route = `${c.req.method} ${c.req.path}`;

  // Log structured
  logger.error(
    {
      requestId: getRequestId(c),
      route,
      statusCode,
      severity: capture.severity ?? 'ERROR',
      msg: capture.message,
      err: err?.message,
      stack: err?.stack,
    },
    'error captured',
  );

  // Persist async (fire-and-forget). Never await — don't block the request.
  void (async () => {
    try {
      await prisma.errorEvent.create({
        data: {
          severity: capture.severity ?? 'ERROR',
          source: capture.source ?? 'API',
          requestId: getRequestId(c),
          route,
          method: c.req.method,
          statusCode,
          userId: user?.id ?? null,
          message: truncate(capture.message, MAX_MESSAGE_LEN) ?? 'unknown',
          stack: truncate(err?.stack, MAX_STACK_LEN),
          context: sanitizeContext(capture.context) as any,
        },
      });
    } catch (e) {
      // Last resort: log to stderr, never rethrow
      logger.error({ err: (e as Error).message }, 'failed to persist error event');
    }
  })();
}

// Convenience: capture from anywhere (no Context needed) for workers.
export function captureBare(capture: ErrorCapture, extra?: { route?: string; method?: string }): void {
  logger.error(
    {
      severity: capture.severity ?? 'ERROR',
      source: capture.source ?? 'API',
      route: extra?.route,
      method: extra?.method,
      msg: capture.message,
      err: (capture.err as Error | undefined)?.message,
      stack: (capture.err as Error | undefined)?.stack,
    },
    'error captured (bare)',
  );
  void (async () => {
    try {
      await prisma.errorEvent.create({
        data: {
          severity: capture.severity ?? 'ERROR',
          source: capture.source ?? 'API',
          requestId: null,
          route: extra?.route ?? null,
          method: extra?.method ?? null,
          statusCode: null,
          userId: null,
          message: truncate(capture.message, MAX_MESSAGE_LEN) ?? 'unknown',
          stack: truncate((capture.err as Error | undefined)?.stack, MAX_STACK_LEN),
          context: sanitizeContext(capture.context) as any,
        },
      });
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'failed to persist bare error event');
    }
  })();
}
