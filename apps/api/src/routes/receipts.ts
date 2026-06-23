// apps/api/src/routes/receipts.ts
//
// Sprint 8.9 — Digital receipt routes.
//
// Endpoints (all require auth):
//   GET  /api/receipts                        — Sprint 21: list all delivery
//                                                  attempts across orders (log)
//   GET  /api/receipts/:orderId              — list all delivery attempts
//   POST /api/receipts/send                  — trigger delivery (WHATSAPP / EMAIL)
//   GET  /api/receipts/preview/:orderId      — render the receipt as text/html
//
// Indonesian UI strings for staff-facing flows.

import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';
import {
  renderReceipt,
  dispatch,
  type ReceiptChannelKind,
} from '../services/receipt-delivery.js';

export const receiptRoutes = new Hono<AppEnv>();

receiptRoutes.use('*', requireAuth);

// ─── list deliveries for an order ───────────────────────────────────────────

// Sprint 21 — list ALL delivery attempts across all orders (most recent
// first). Manager/Owner only — used by the /pos/orders/receipt log page.
//
// We can't `include` the order because ReceiptDelivery has no relation
// field (it's orderId-as-string with no FK constraint, so it stays loose
// for cross-system deliveries). We pull the order rows separately and
// merge in JS — at most 200 rows, this is cheap.
receiptRoutes.get('/', requireRole('MANAGER', 'OWNER'), async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10) || 100, 500);

  const [deliveries, orderIds] = await Promise.all([
    prisma.receiptDelivery.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.receiptDelivery.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { orderId: true },
    }),
  ]);

  const uniqueOrderIds = Array.from(new Set(orderIds.map((d) => d.orderId)));
  const orders = uniqueOrderIds.length
    ? await prisma.order.findMany({
        where: { id: { in: uniqueOrderIds } },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalCents: true,
          openedAt: true,
        },
      })
    : [];

  const orderMap = new Map(orders.map((o) => [o.id, o]));
  const enriched = deliveries.map((d) => ({
    ...d,
    order: orderMap.get(d.orderId) ?? null,
  }));

  return ok(c, enriched);
});

receiptRoutes.get('/:orderId', async (c) => {
  const orderId = c.req.param('orderId');
  // Order must exist (defensive: 404 is friendlier than an empty array for
  // a typo'd orderId).
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
  if (!order) return fail(c, 'NotFound', 'Pesanan tidak ditemukan', 404);

  const deliveries = await prisma.receiptDelivery.findMany({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return ok(c, deliveries);
});

// ─── trigger delivery ───────────────────────────────────────────────────────

const sendSchema = z.object({
  orderId: z.string().min(1).max(50),
  channels: z
    .array(z.enum(['WHATSAPP', 'EMAIL', 'PRINT']))
    .min(1, 'Minimal 1 channel')
    .max(3),
  // Optional explicit targets. When missing, falls back to customer phone
  // (WHATSAPP) / customer email (EMAIL) on the linked customer.
  target: z
    .object({
      whatsapp: z.string().min(3).max(30).optional(),
      email: z.string().email().max(200).optional(),
    })
    .optional(),
});

receiptRoutes.post('/send', requireRole('CASHIER', 'MANAGER', 'OWNER'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);
  }
  const { orderId, channels, target } = parsed.data;

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return fail(c, 'NotFound', 'Pesanan tidak ditemukan', 404);

  try {
    const result = await dispatch(orderId, channels as ReceiptChannelKind[], target);
    logger.info(
      {
        orderId,
        channels,
        deliveryCount: result.deliveries.length,
        by: user.id,
      },
      'receipt delivery requested',
    );
    return ok(c, result);
  } catch (e) {
    const msg = (e as Error).message || 'Pengiriman struk gagal';
    logger.error({ err: msg, orderId }, 'receipt dispatch failed');
    return fail(c, 'DispatchFailed', msg, 500);
  }
});

// ─── preview (HTML/text) ────────────────────────────────────────────────────

receiptRoutes.get('/preview/:orderId', async (c) => {
  const orderId = c.req.param('orderId');
  const format = c.req.query('format') || 'text';
  try {
    const rendered = await renderReceipt(orderId);
    if (format === 'html') {
      return new Response(rendered.html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return new Response(rendered.text, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  } catch (e) {
    const msg = (e as Error).message || 'Gagal merender struk';
    return fail(c, 'PreviewFailed', msg, 500);
  }
});
