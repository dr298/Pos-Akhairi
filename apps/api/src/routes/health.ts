import { Hono } from 'hono';
import { prisma } from '@pos/db';

export const healthRoutes = new Hono();

healthRoutes.get('/', async (c) => {
  return c.json({
    status: 'ok',
    service: 'pos-api',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

healthRoutes.get('/live', (c) => c.json({ status: 'ok', ts: Date.now() }));

healthRoutes.get('/ready', async (c) => {
  try {
    // ping db
    await prisma.$queryRaw`SELECT 1`;
    return c.json({ status: 'ready', db: 'up' });
  } catch (e: any) {
    return c.json({ status: 'not-ready', db: 'down', error: e?.message }, 503);
  }
});
