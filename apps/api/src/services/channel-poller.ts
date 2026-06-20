// Background poller for delivery aggregator channels.
//
// Periodically scans enabled ChannelConfigs, builds a client, and pulls new
// orders. For high-volume channels, webhooks are preferred; polling is the
// fallback that catches dropped webhooks and missed events.

import { prisma } from '@pos/db';
import { logger } from '../logger.js';
import { buildClient } from '../channels/registry.js';
import { consolidateChannelOrder } from './channel-orders.js';

let intervalHandle: NodeJS.Timeout | null = null;

const TICK_MS = 5_000; // 5s scheduler tick; respects per-config poll interval

export function startChannelPoller(): void {
  if (intervalHandle) return; // idempotent
  // Run once immediately so we don't wait for the first tick
  void tick();
  intervalHandle = setInterval(() => void tick(), TICK_MS);
}

export function stopChannelPoller(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

async function tick(): Promise<void> {
  try {
    const configs = await prisma.channelConfig.findMany({
      where: { enabled: true },
    });
    const now = Date.now();
    for (const cfg of configs) {
      const last = cfg.lastPolledAt?.getTime() ?? 0;
      const intervalMs = cfg.pollIntervalSec * 1000;
      if (now - last < intervalMs) continue;
      await pollOne(cfg.id);
    }
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'channel poller tick failed');
  }
}

async function pollOne(configId: string): Promise<void> {
  const cfg = await prisma.channelConfig.findUnique({ where: { id: configId } });
  if (!cfg || !cfg.enabled) return;
  const client = buildClient({
    channel: cfg.channel,
    storeId: cfg.storeId,
    apiKeyEncrypted: cfg.apiKeyEncrypted,
    apiSecretEncrypted: cfg.apiSecretEncrypted,
  });
  if (!client) {
    logger.warn({ configId, channel: cfg.channel }, 'no client (missing creds)');
    return;
  }
  try {
    const since = cfg.lastPolledAt?.toISOString();
    const orders = await client.fetchOrders(since);
    for (const order of orders) {
      try {
        await consolidateChannelOrder({
          branchId: cfg.branchId,
          channel: cfg.channel,
          channelConfigId: cfg.id,
          order,
        });
      } catch (e) {
        logger.warn(
          { err: (e as Error).message, externalId: order.externalId, channel: cfg.channel },
          'failed to consolidate polled order',
        );
      }
    }
    await prisma.channelConfig.update({
      where: { id: cfg.id },
      data: { lastPolledAt: new Date() },
    });
    logger.info(
      { channel: cfg.channel, count: orders.length, configId },
      'channel poll ok',
    );
  } catch (e) {
    logger.warn(
      { err: (e as Error).message, channel: cfg.channel, configId },
      'channel poll failed',
    );
  }
}
