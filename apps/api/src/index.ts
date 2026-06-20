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
import { channelRoutes } from './routes/channels.js';
import { channelOrderRoutes } from './routes/channel-orders.js';
import { channelAnalyticsRoutes } from './routes/channel-analytics.js';
import { webhookRoutes } from './routes/webhooks.js';
import { dailyCloseRoutes } from './routes/daily-close.js';
import { commissionRoutes } from './routes/commissions.js';
import { transferRoutes } from './routes/transfers.js';
import { branchRoutes } from './routes/branches.js';
import { startChannelPoller } from './services/channel-poller.js';
import { handleWebSocketUpgrade } from './lib/ws.js';
import { wsBus } from './lib/ws-bus.js';
import { readToken } from './middleware/auth.js';
import './payments/index.js'; // ensure providers register on boot

const app = new Hono();

app.use('*', honoLogger((str) => logger.info(str.trim())));
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
app.route('/api/channels', channelRoutes);
app.route('/api/channel-orders', channelOrderRoutes);
app.route('/api/channel-analytics', channelAnalyticsRoutes);
app.route('/api/webhooks', webhookRoutes);
app.route('/api/daily-close', dailyCloseRoutes);
app.route('/api/commissions', commissionRoutes);
app.route('/api/transfers', transferRoutes);
app.route('/api/branches', branchRoutes);

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

// WebSocket upgrade: clients connect to /ws. Auth is best-effort — we read
// the pos_session cookie from the upgrade request so we can scope events to
// the user's branch. Unauthenticated clients still receive events for the
// default branch (useful for the /display page).
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
  // Resolve branchId via the cookie before the upgrade handshake so wsBus
  // registers the client with the correct branch. The token in the cookie
  // is signed with JWT_SECRET and is safe to verify here. We do it inside
  // onOpen because readToken is async; the bus starts with branchId=null
  // and updates once the auth check resolves.
  handleWebSocketUpgrade(req, socket, head, {
    onOpen: (ctx) => {
      // best-effort: try to read the token, then update the bus
      wsBus.add(ctx, null);
      try {
        const cookieHeader = req.headers.cookie || '';
        const match = cookieHeader.match(/(?:^|;\s*)pos_session=([^;]+)/);
        if (match) {
          const token = decodeURIComponent(match[1]);
          // readToken is async; the bus will start with branchId=null and
          // update once it resolves. (Filter is per-broadcast, so a brief
          // window of cross-branch delivery is acceptable.)
          readToken(token)
            .then((u) => {
              if (u?.branchId) wsBus.setBranch(ctx, u.branchId);
            })
            .catch(() => {
              // ignore
            });
        }
      } catch {
        // ignore
      }
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
  // Start the channel poller in the background. It reads enabled
  // ChannelConfigs every pollIntervalSec and pulls new orders.
  if (process.env.CHANNEL_POLLER_ENABLED !== 'false') {
    startChannelPoller();
    logger.info('channel poller started');
  }
});

export default app;
