import { Hono } from 'hono';
import { prisma } from '@pos/db';

export const healthRoutes = new Hono();

const START_TIME = Date.now();

healthRoutes.get('/', (c) =>
  c.json({
    status: 'ok',
    service: 'pos-api',
    version: '0.1.0',
    uptimeSec: Math.floor((Date.now() - START_TIME) / 1000),
    timestamp: new Date().toISOString(),
  }),
);

// Liveness — process is alive. Cheap. No deps. No rate limit.
healthRoutes.get('/live', (c) =>
  c.json({ status: 'ok', ts: Date.now(), uptimeSec: Math.floor((Date.now() - START_TIME) / 1000) }),
);

// Readiness — process can serve. Probes DB with timeout.
healthRoutes.get('/ready', async (c) => {
  const checks: Record<string, { ok: boolean; ms?: number; error?: string }> = {};
  let allOk = true;

  const dbStart = Date.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, rej) => setTimeout(() => rej(new Error('db timeout')), 2000)),
    ]);
    checks.db = { ok: true, ms: Date.now() - dbStart };
  } catch (e) {
    allOk = false;
    checks.db = { ok: false, error: (e as Error).message, ms: Date.now() - dbStart };
  }

  return c.json(
    {
      status: allOk ? 'ready' : 'not-ready',
      checks,
      uptimeSec: Math.floor((Date.now() - START_TIME) / 1000),
    },
    allOk ? 200 : 503,
  );
});
