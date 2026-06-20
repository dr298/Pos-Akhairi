// Public webhook endpoints for delivery aggregators.
// No auth — these are called by external services. Each route verifies the
// incoming request via the channel's HMAC signature.

import { Hono } from 'hono';
import type { Channel } from '@prisma/client';
import { prisma } from '@pos/db';
import { ok, fail } from '../middleware/auth.js';
import { buildClient } from '../channels/registry.js';
import { consolidateChannelOrder } from '../services/channel-orders.js';
import { logger } from '../logger.js';

export const webhookRoutes = new Hono();

/**
 * POST /api/webhooks/gofood — GoFood order webhook.
 * The store_id is in the payload; we look up ChannelConfig by (storeId, channel).
 */
webhookRoutes.post('/gofood', async (c) => {
  const body = await c.req.text();
  const payload = parseJsonSafe(body);
  if (!payload) return fail(c, 'InvalidPayload', 'Body must be JSON', 400);

  // Look up the config from the payload
  const storeId = String(payload.merchant_id ?? payload.store_id ?? '');
  if (!storeId) return fail(c, 'NoStore', 'Missing store_id in payload', 400);

  const cfg = await prisma.channelConfig.findFirst({
    where: { channel: 'GOFOOD', storeId, enabled: true },
  });
  if (!cfg) return fail(c, 'NoConfig', 'No enabled GoFood config for this store', 404);

  const client = buildClient({
    channel: cfg.channel,
    storeId: cfg.storeId,
    apiKeyEncrypted: cfg.apiKeyEncrypted,
    apiSecretEncrypted: cfg.apiSecretEncrypted,
  });
  if (!client) return fail(c, 'NotConfigured', 'Missing credentials', 400);

  const headers = headerToObject(c.req.raw.headers);
  if (!client.verifyWebhook(headers, body)) {
    logger.warn({ storeId }, 'gofood webhook: signature verification failed');
    return fail(c, 'InvalidSignature', 'Webhook signature mismatch', 401);
  }

  // Fetch the order from GoFood to get full details
  const orderId = String(payload.order_id ?? payload.id ?? '');
  if (!orderId) return fail(c, 'NoOrder', 'Missing order_id in payload', 400);
  const order = await client.fetchOrder(orderId);
  if (!order) return fail(c, 'NotFound', 'Order not found at aggregator', 404);

  const row = await consolidateChannelOrder({
    branchId: cfg.branchId,
    channel: 'GOFOOD',
    channelConfigId: cfg.id,
    order,
  });
  return ok(c, { id: row.id, status: row.status });
});

webhookRoutes.post('/grabfood', async (c) => {
  const body = await c.req.text();
  const payload = parseJsonSafe(body);
  if (!payload) return fail(c, 'InvalidPayload', 'Body must be JSON', 400);
  const storeId = String(payload.merchantID ?? '');
  if (!storeId) return fail(c, 'NoStore', 'Missing merchantID in payload', 400);

  const cfg = await prisma.channelConfig.findFirst({
    where: { channel: 'GRABFOOD', storeId, enabled: true },
  });
  if (!cfg) return fail(c, 'NoConfig', 'No enabled GrabFood config for this store', 404);

  const client = buildClient({
    channel: cfg.channel,
    storeId: cfg.storeId,
    apiKeyEncrypted: cfg.apiKeyEncrypted,
    apiSecretEncrypted: cfg.apiSecretEncrypted,
  });
  if (!client) return fail(c, 'NotConfigured', 'Missing credentials', 400);

  const headers = headerToObject(c.req.raw.headers);
  if (!client.verifyWebhook(headers, body)) {
    logger.warn({ storeId }, 'grabfood webhook: signature verification failed');
    return fail(c, 'InvalidSignature', 'Webhook signature mismatch', 401);
  }

  const orderId = String(payload.orderID ?? '');
  if (!orderId) return fail(c, 'NoOrder', 'Missing orderID in payload', 400);
  const order = await client.fetchOrder(orderId);
  if (!order) return fail(c, 'NotFound', 'Order not found at aggregator', 404);

  const row = await consolidateChannelOrder({
    branchId: cfg.branchId,
    channel: 'GRABFOOD',
    channelConfigId: cfg.id,
    order,
  });
  return ok(c, { id: row.id, status: row.status });
});

webhookRoutes.post('/shopeefood', async (c) => {
  const body = await c.req.text();
  const payload = parseJsonSafe(body);
  if (!payload) return fail(c, 'InvalidPayload', 'Body must be JSON', 400);
  // Shopee webhooks are typically per-shop
  const shopId = String(payload.shop_id ?? '');
  const partnerId = String(payload.partner_id ?? '');
  const storeId = `${partnerId}:${shopId}`;

  const cfg = await prisma.channelConfig.findFirst({
    where: { channel: 'SHOPEEFOOD', storeId, enabled: true },
  });
  if (!cfg) return fail(c, 'NoConfig', 'No enabled ShopeeFood config for this store', 404);

  const client = buildClient({
    channel: cfg.channel,
    storeId: cfg.storeId,
    apiKeyEncrypted: cfg.apiKeyEncrypted,
    apiSecretEncrypted: cfg.apiSecretEncrypted,
  });
  if (!client) return fail(c, 'NotConfigured', 'Missing credentials', 400);

  const headers = headerToObject(c.req.raw.headers);
  if (!client.verifyWebhook(headers, body)) {
    logger.warn({ storeId }, 'shopeefood webhook: signature verification failed');
    return fail(c, 'InvalidSignature', 'Webhook signature mismatch', 401);
  }

  // The webhook payload includes an order_sn
  const orderSn = String(payload.order_sn ?? '');
  if (!orderSn) return fail(c, 'NoOrder', 'Missing order_sn in payload', 400);
  const order = await client.fetchOrder(orderSn);
  if (!order) return fail(c, 'NotFound', 'Order not found at aggregator', 404);

  const row = await consolidateChannelOrder({
    branchId: cfg.branchId,
    channel: 'SHOPEEFOOD',
    channelConfigId: cfg.id,
    order,
  });
  return ok(c, { id: row.id, status: row.status });
});

function parseJsonSafe(s: string): Record<string, any> {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? (v as Record<string, any>) : {};
  } catch {
    return {};
  }
}

function headerToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}
