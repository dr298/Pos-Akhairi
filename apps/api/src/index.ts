import { Hono } from 'hono';
import { logger as honoLogger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { cors } from 'hono/cors';
import { createAdaptorServer } from '@hono/node-server';
import { logger } from './logger.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { menuRoutes } from './routes/menu.js';
import { paymentRoutes } from './routes/payments.js';
import { orderRoutes } from './routes/orders.js';
import { shiftRoutes } from './routes/shifts.js';
import { reportRoutes } from './routes/reports.js';
import { discountRoutes } from './routes/discounts.js';
import { comboRoutes } from './routes/combos.js';
import { promoRoutes } from './routes/promos.js';
import { webhookRoutes } from './routes/webhooks.js';
import { dailyCloseRoutes } from './routes/daily-close.js';
import { customerRoutes } from './routes/customers.js';
import { receiptRoutes } from './routes/receipts.js';
import { cashDrawerRoutes } from './routes/cash-drawer.js';
import { kioskRoutes } from './routes/kiosk.js';
import { reservationRoutes } from './routes/reservations.js';
import { tableRoutes } from './routes/tables.js';
import { menuEngineeringRoutes } from './routes/menu-engineering.js';
import { supplierRoutes } from './routes/suppliers.js';
import { purchaseOrderRoutes } from './routes/purchase-orders.js';
import { prepSheetRoutes } from './routes/prep-sheets.js';
import { accountingExportRoutes } from './routes/accounting-export.js';
import { wasteRoutes } from './routes/waste.js';
import { handleWebSocketUpgrade } from './lib/ws.js';
import { wsBus } from './lib/ws-bus.js';
import { requestContext } from './middleware/request-context.js';
import { rateLimit, rateLimitAuth } from './middleware/rate-limit.js';
import { securityHeaders } from './middleware/security-headers.js';
import { metricsMiddleware, incCounter, observeHistogram } from './middleware/metrics.js';
import { errorRoutes } from './routes/errors.js';
import { metricsRoutes } from './routes/metrics.js';
import './payments/index.js'; // ensure providers register on boot

const app = new Hono();

app.use('*', requestContext());
app.use('*', securityHeaders());
app.use('*', metricsMiddleware());
app.use('*', rateLimit());
app.use(
  '*',
  cors({
    origin: (process.env.WEB_ORIGIN || 'http://localhost:3080').split(',').map((s) => s.trim()),
    credentials: true,
  }),
);
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
app.route('/api/discounts', discountRoutes);
app.route('/api/combos', comboRoutes);
app.route('/api/promos', promoRoutes);
app.route('/api/webhooks', webhookRoutes);
app.route('/api/daily-close', dailyCloseRoutes);
app.route('/api/customers', customerRoutes);
app.route('/api/receipts', receiptRoutes);
app.route('/api/cash-drawer', cashDrawerRoutes);
app.route('/api/kiosk', kioskRoutes);
app.route('/api/reservations', reservationRoutes);
app.route('/api/tables', tableRoutes);
app.route('/api/menu-engineering', menuEngineeringRoutes);
app.route('/api/suppliers', supplierRoutes);
app.route('/api/purchase-orders', purchaseOrderRoutes);
app.route('/api/prep-sheets', prepSheetRoutes);
app.route('/api/accounting-export', accountingExportRoutes);
app.route('/api/waste', wasteRoutes);
app.route('/api/errors', errorRoutes);
app.route('/api/metrics', metricsRoutes);

app.notFound((c) => c.json({ error: 'Not Found', path: c.req.path }, 404));
app.onError((err, c) => {
  logger.error({ err }, 'unhandled');
  return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

const port = Number(process.env.API_PORT || 8787);
const host = process.env.API_HOST || '0.0.0.0';

const server = createAdaptorServer({
  fetch: app.fetch,
  port,
  hostname: host,
});

// WebSocket upgrade: clients connect to /ws. Single-instance system, so all
// authenticated clients receive all events (no per-branch scoping).
server.on('upgrade', (req, socket, head) => {
  if (!req.url) {
    socket.destroy();
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  handleWebSocketUpgrade(req, socket, head, {
    onOpen: (ctx) => {
      wsBus.add(ctx);
      try {
        ctx.send(JSON.stringify({ type: 'hello', at: Date.now() }));
      } catch {
        // ignore
      }
    },
    onMessage: (text, ctx) => {
      // Treat any inbound message as a heartbeat. We don't accept commands.
      try {
        const parsed = JSON.parse(text);
        if (parsed && parsed.type === 'ping') {
          ctx.send(JSON.stringify({ type: 'pong', at: Date.now() }));
        }
      } catch {
        // ignore non-JSON
      }
    },
    onClose: (ctx) => {
      wsBus.remove(ctx);
    },
    onError: (err) => {
      logger.warn({ err: err.message }, 'ws error');
    },
  });
});

server.listen(port, host, () => {
  logger.info({ port, host }, 'pos-api listening');
});

export default app;
