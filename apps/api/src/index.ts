import { Hono } from 'hono';
import { logger as honoLogger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { logger } from './logger.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';

const app = new Hono();

app.use('*', honoLogger((str) => logger.info(str.trim())));
app.use('*', cors({ origin: process.env.WEB_ORIGIN || 'http://localhost:3000', credentials: true }));
app.use('*', prettyJSON());

app.get('/', (c) => c.json({ name: 'pos-api', version: '0.1.0', service: 'hono' }));
app.route('/api/health', healthRoutes);
app.route('/api/ready', healthRoutes);
app.route('/api/auth', authRoutes);

app.notFound((c) => c.json({ error: 'Not Found', path: c.req.path }, 404));
app.onError((err, c) => {
  logger.error({ err }, 'unhandled');
  return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

const port = Number(process.env.API_PORT || 8787);
const host = process.env.API_HOST || '0.0.0.0';

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  logger.info({ port: info.port, host: info.address }, 'pos-api listening');
});

export default app;
