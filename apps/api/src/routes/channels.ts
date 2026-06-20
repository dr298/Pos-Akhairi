// Channel configuration routes + webhook receivers.
//
// CRUD for ChannelConfig (per branch × channel) — credentials are stored
// encrypted. Webhooks are public, signature-verified per channel.

import { Hono } from 'hono';
import { z } from 'zod';
import type { Channel } from '@prisma/client';
import { prisma } from '@pos/db';
import { requireAuth, requireRole, ok, fail, type AppEnv } from '../middleware/auth.js';
import { encrypt, decrypt } from '../channels/crypto.js';
import { buildClient } from '../channels/registry.js';
import { consolidateChannelOrder } from '../services/channel-orders.js';
import { syncBranchMenuToChannels } from '../services/menu-sync.js';
import { logger } from '../logger.js';

export const channelRoutes = new Hono<AppEnv>();

channelRoutes.use('*', requireAuth);

const configSchema = z.object({
  channel: z.enum(['GOFOOD', 'GRABFOOD', 'SHOPEEFOOD']),
  enabled: z.boolean().default(false),
  storeId: z.string().min(1),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
  webhookSecret: z.string().optional(),
  pollIntervalSec: z.number().int().min(10).max(3600).default(60),
  configJson: z.record(z.unknown()).optional(),
});

// List all channel configs for the current branch
channelRoutes.get('/', async (c) => {
  const user = c.get('user');
  if (!user.branchId) return fail(c, 'NoBranch', 'User has no branch', 400);
  const rows = await prisma.channelConfig.findMany({
    where: { branchId: user.branchId },
  });
  // Redact secrets
  return ok(
    c,
    rows.map((r) => ({
      id: r.id,
      branchId: r.branchId,
      channel: r.channel,
      enabled: r.enabled,
      storeId: r.storeId,
      hasApiKey: !!r.apiKeyEncrypted,
      hasApiSecret: !!r.apiSecretEncrypted,
      hasWebhookSecret: !!r.webhookSecret,
      pollIntervalSec: r.pollIntervalSec,
      lastPolledAt: r.lastPolledAt,
      configJson: r.configJson,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  );
});

// Create or update a channel config
channelRoutes.put('/:channel', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  if (!user.branchId) return fail(c, 'NoBranch', 'User has no branch', 400);
  const channel = c.req.param('channel') as Channel;
  if (!['GOFOOD', 'GRABFOOD', 'SHOPEEFOOD'].includes(channel)) {
    return fail(c, 'InvalidChannel', 'channel must be GOFOOD/GRABFOOD/SHOPEEFOOD', 400);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = configSchema.safeParse({ ...body, channel });
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.flatten());
  }
  const d = parsed.data;
  const data = {
    branchId: user.branchId,
    channel,
    enabled: d.enabled,
    storeId: d.storeId,
    apiKeyEncrypted: encrypt(d.apiKey),
    apiSecretEncrypted: encrypt(d.apiSecret),
    webhookSecret: d.webhookSecret,
    pollIntervalSec: d.pollIntervalSec,
    configJson: (d.configJson ?? undefined) as any,
  };
  const row = await prisma.channelConfig.upsert({
    where: { branchId_channel: { branchId: user.branchId, channel } },
    create: data,
    update: data,
  });
  return ok(c, { id: row.id, channel: row.channel, enabled: row.enabled });
});

// Delete a channel config
channelRoutes.delete('/:channel', requireRole('OWNER'), async (c) => {
  const user = c.get('user');
  if (!user.branchId) return fail(c, 'NoBranch', 'User has no branch', 400);
  const channel = c.req.param('channel') as Channel;
  await prisma.channelConfig
    .delete({ where: { branchId_channel: { branchId: user.branchId, channel } } })
    .catch(() => null);
  return ok(c, { deleted: true });
});

// Test connection (ping aggregator)
channelRoutes.post('/:channel/test', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  if (!user.branchId) return fail(c, 'NoBranch', 'User has no branch', 400);
  const channel = c.req.param('channel') as Channel;
  const row = await prisma.channelConfig.findUnique({
    where: { branchId_channel: { branchId: user.branchId, channel } },
  });
  if (!row) return fail(c, 'NotFound', 'Channel not configured', 404);
  const client = buildClient({
    channel: row.channel,
    storeId: row.storeId,
    apiKeyEncrypted: row.apiKeyEncrypted,
    apiSecretEncrypted: row.apiSecretEncrypted,
  });
  if (!client) return fail(c, 'NotConfigured', 'Missing credentials', 400);
  try {
    // Try a no-op fetch (empty result is fine, we just want to verify auth)
    await client.fetchOrders();
    return ok(c, { ok: true, message: 'Connection successful' });
  } catch (e) {
    const msg = (e as Error).message;
    logger.warn({ err: msg, channel }, 'channel test failed');
    return fail(c, 'TestFailed', msg, 502);
  }
});

// Manual poll trigger
channelRoutes.post('/:channel/poll', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  if (!user.branchId) return fail(c, 'NoBranch', 'User has no branch', 400);
  const channel = c.req.param('channel') as Channel;
  const row = await prisma.channelConfig.findUnique({
    where: { branchId_channel: { branchId: user.branchId, channel } },
  });
  if (!row) return fail(c, 'NotFound', 'Channel not configured', 404);
  const client = buildClient({
    channel: row.channel,
    storeId: row.storeId,
    apiKeyEncrypted: row.apiKeyEncrypted,
    apiSecretEncrypted: row.apiSecretEncrypted,
  });
  if (!client) return fail(c, 'NotConfigured', 'Missing credentials', 400);
  try {
    const orders = await client.fetchOrders();
    for (const o of orders) {
      await consolidateChannelOrder({
        branchId: user.branchId,
        channel,
        channelConfigId: row.id,
        order: o,
      });
    }
    await prisma.channelConfig.update({
      where: { id: row.id },
      data: { lastPolledAt: new Date() },
    });
    return ok(c, { polled: orders.length });
  } catch (e) {
    const msg = (e as Error).message;
    return fail(c, 'PollFailed', msg, 502);
  }
});

// Manual menu sync trigger
channelRoutes.post('/:channel/menu-sync', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  if (!user.branchId) return fail(c, 'NoBranch', 'User has no branch', 400);
  const channel = c.req.param('channel') as Channel;
  const result = await syncBranchMenuToChannels(user.branchId);
  return ok(c, result);
});
