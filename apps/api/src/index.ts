import { Hono } from 'hono';
import { logger as honoLogger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { logger } from './logger.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { menuRoutes } from './routes/menu.js';
import { paymentRoutes } from './routes/payments.js';
import { orderRoutes } from './routes/orders.js';
import { shiftRoutes } from './routes/shifts.js';
import { reportRoutes } from './routes/reports.js';
import './payments/index.js'; // ensure providers register on boot

const app = new Hono();

app.use('*', honoLogger((str) => logger.info(str.trim())));
app.use('*', cors({ origin: process.env.WEB_ORIGIN || 'http://localhost:3000', credentials: true }));
app.use('*', prettyJSON());

app.get('/', (c) => c.json({ name: 'pos-api', version: '0.1.0', service: 'hono' }));
app.route('/api/health', healthRoutes);
app.route('/api/ready', healthRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/menu', menuRoutes);
app.route('/api/payments', paymentRoutes);
app.route('/api/orders', orderRoutes);
app.route('/api/shifts', shiftRoutes);
app.route('/api/reports', reportRoutes);

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
