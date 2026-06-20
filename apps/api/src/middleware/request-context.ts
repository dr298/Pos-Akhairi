// Sprint 7.1 — Request ID + structured logging middleware
// - Generates X-Request-Id per request (or echoes client-provided)
// - Exposes via c.get('requestId') and as response header
// - Logs request start/finish with duration, status, route
// - Pino child logger bound to requestId for correlation
import type { Context, MiddlewareHandler } from 'hono';
import { randomUUID } from 'crypto';
import { logger } from '../logger.js';

const HEADER = 'x-request-id';

export function requestContext(): MiddlewareHandler {
  return async (c, next) => {
    const incoming = c.req.header(HEADER);
    const requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
    c.set('requestId' as any, requestId);
    c.header('X-Request-Id', requestId);

    const start = performance.now();
    const log = logger.child({ requestId, route: c.req.path, method: c.req.method });

    // Attach per-request logger for routes
    c.set('log' as any, log);

    log.info({ msg: 'request.start' });

    try {
      await next();
    } catch (err) {
      const ms = (performance.now() - start).toFixed(1);
      log.error(
        { msg: 'request.error', durationMs: ms, err: (err as Error).message, stack: (err as Error).stack },
        'unhandled exception',
      );
      throw err;
    }

    const ms = (performance.now() - start).toFixed(1);
    log.info({
      msg: 'request.end',
      status: c.res.status,
      durationMs: ms,
    });
  };
}

// Helper: get the per-request logger inside route handlers
export function getLog(c: Context) {
  return (c.get('log' as any) as ReturnType<typeof logger.child>) ?? logger;
}

// Helper: get the request id
export function getRequestId(c: Context): string {
  return (c.get('requestId' as any) as string) ?? 'unknown';
}
