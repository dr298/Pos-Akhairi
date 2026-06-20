// ChannelOrder routes — list orders from external channels, accept/reject,
// update status, create local Order.

import { Hono } from 'hono';
import { z } from 'zod';
import type { ChannelOrderStatus } from '@prisma/client';
import { prisma } from '@pos/db';
import { requireAuth, requireRole, ok, fail, type AppEnv } from '../middleware/auth.js';
import { buildClient } from '../channels/registry.js';
import {
  consolidateChannelOrder,
  createLocalOrderFromChannel,
  updateChannelOrderStatus,
} from '../services/channel-orders.js';
import { logger } from '../logger.js';

export const channelOrderRoutes = new Hono<AppEnv>();

channelOrderRoutes.use('*', requireAuth);

const STATUSES: ChannelOrderStatus[] = [
  'PENDING',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'PICKED_UP',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
  'REJECTED',
];

// List channel orders (current branch)
channelOrderRoutes.get('/', async (c) => {
  const user = c.get('user');
  if (!user.branchId) return fail(c, 'NoBranch', 'User has no branch', 400);
  const status = c.req.query('status') as ChannelOrderStatus | undefined;
  const channel = c.req.query('channel');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);

  const where: any = { branchId: user.branchId };
  if (status) where.status = status;
  if (channel) where.channel = channel;

  const rows = await prisma.channelOrder.findMany({
    where,
    orderBy: { receivedAt: 'desc' },
    take: limit,
  });
  return ok(c, rows);
});

// Get single channel order (with event history)
channelOrderRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  if (!user.branchId) return fail(c, 'NoBranch', 'User has no branch', 400);
  const id = c.req.param('id');
  const row = await prisma.channelOrder.findFirst({
    where: { id, branchId: user.branchId },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  });
  if (!row) return fail(c, 'NotFound', 'Order not found', 404);
  return ok(c, row);
});

// Accept a channel order: marks as ACCEPTED, creates linked local Order
channelOrderRoutes.post('/:id/accept', requireRole('OWNER', 'MANAGER', 'KITCHEN'), async (c) => {
  const user = c.get('user');
  if (!user.branchId) return fail(c, 'NoBranch', 'User has no branch', 400);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const schema = z.object({ prepMinutes: z.number().int().min(1).max(180).default(15) });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail(c, 'ValidationError', 'Bad payload', 400);

  const co = await prisma.channelOrder.findFirst({
    where: { id, branchId: user.branchId },
  });
  if (!co) return fail(c, 'NotFound', 'Order not found', 404);
  if (!['PENDING'].includes(co.status)) {
    return fail(c, 'InvalidState', `Cannot accept order in status ${co.status}`, 409);
  }

  // Get the aggregator client (if configured) so we can push the accept
  let client;
  if (co.channelConfigId) {
    const cfg = await prisma.channelConfig.findUnique({ where: { id: co.channelConfigId } });
    if (cfg) {
      client = buildClient({
        channel: cfg.channel,
        storeId: cfg.storeId,
        apiKeyEncrypted: cfg.apiKeyEncrypted,
        apiSecretEncrypted: cfg.apiSecretEncrypted,
      }) ?? undefined;
    }
  }

  // 1. Create the local order
  const orderId = await createLocalOrderFromChannel(id);

  // 2. Update channel order status (and push to aggregator)
  try {
    await updateChannelOrderStatus(id, 'ACCEPTED', user.id, `accepted with ${parsed.data.prepMinutes}m prep`, client);
  } catch (e) {
    logger.warn(
      { err: (e as Error).message, channelOrderId: id },
      'failed to push accept to aggregator (order created locally anyway)',
    );
  }

  return ok(c, { id, orderId, status: 'ACCEPTED' });
});

// Reject a channel order
channelOrderRoutes.post(
  '/:id/reject',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const user = c.get('user');
    if (!user.branchId) return fail(c, 'NoBranch', 'User has no branch', 400);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({ reason: z.string().min(1).max(500) });
    const parsed = schema.safeParse(body);
    if (!parsed.success) return fail(c, 'ValidationError', 'reason required', 400);

    const co = await prisma.channelOrder.findFirst({
      where: { id, branchId: user.branchId },
    });
    if (!co) return fail(c, 'NotFound', 'Order not found', 404);
    if (co.status !== 'PENDING') {
      return fail(c, 'InvalidState', `Cannot reject order in status ${co.status}`, 409);
    }

    let client;
    if (co.channelConfigId) {
      const cfg = await prisma.channelConfig.findUnique({ where: { id: co.channelConfigId } });
      if (cfg) {
        client = buildClient({
          channel: cfg.channel,
          storeId: cfg.storeId,
          apiKeyEncrypted: cfg.apiKeyEncrypted,
          apiSecretEncrypted: cfg.apiSecretEncrypted,
        }) ?? undefined;
      }
    }

    await updateChannelOrderStatus(id, 'REJECTED', user.id, parsed.data.reason, client);
    return ok(c, { id, status: 'REJECTED' });
  },
);

// Update channel order status (kitchen marks ready, etc.)
channelOrderRoutes.post('/:id/status', async (c) => {
  const user = c.get('user');
  if (!user.branchId) return fail(c, 'NoBranch', 'User has no branch', 400);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const schema = z.object({
    status: z.enum(['ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP', 'DELIVERED', 'CANCELLED']),
    note: z.string().max(500).optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail(c, 'ValidationError', 'Bad payload', 400, parsed.error.flatten());

  const co = await prisma.channelOrder.findFirst({
    where: { id, branchId: user.branchId },
  });
  if (!co) return fail(c, 'NotFound', 'Order not found', 404);
  if (!STATUSES.includes(parsed.data.status as ChannelOrderStatus)) {
    return fail(c, 'InvalidStatus', 'Status not allowed', 400);
  }
  // Permission: kitchen can update PREPARING/READY; manager+ for other
  const restricted: ChannelOrderStatus[] = ['CANCELLED'];
  if (restricted.includes(parsed.data.status as ChannelOrderStatus)) {
    if (!['OWNER', 'MANAGER'].includes(user.role)) {
      return fail(c, 'Forbidden', 'Manager/Owner required', 403);
    }
  }

  let client;
  if (co.channelConfigId) {
    const cfg = await prisma.channelConfig.findUnique({ where: { id: co.channelConfigId } });
    if (cfg) {
      client = buildClient({
        channel: cfg.channel,
        storeId: cfg.storeId,
        apiKeyEncrypted: cfg.apiKeyEncrypted,
        apiSecretEncrypted: cfg.apiSecretEncrypted,
      }) ?? undefined;
    }
  }

  await updateChannelOrderStatus(
    id,
    parsed.data.status as ChannelOrderStatus,
    user.id,
    parsed.data.note,
    client,
  );
  return ok(c, { id, status: parsed.data.status });
});
