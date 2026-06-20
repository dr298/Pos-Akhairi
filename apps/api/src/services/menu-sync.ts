// Menu synchronization: push local menu state to enabled aggregators.
// Triggered manually by manager, or after menu item availability toggles.

import { prisma } from '@pos/db';
import { logger } from '../logger.js';
import { buildClient } from '../channels/registry.js';
import type { AggregatorMenuItem } from '../channels/types.js';

export interface SyncResult {
  channel: string;
  ok: boolean;
  message: string;
  itemCount?: number;
}

export async function syncBranchMenuToChannels(branchId: string): Promise<SyncResult[]> {
  const items = await prisma.menuItem.findMany({
    where: { branchId, isActive: true },
  });
  const configs = await prisma.channelConfig.findMany({
    where: { branchId, enabled: true },
  });
  const results: SyncResult[] = [];
  for (const cfg of configs) {
    const client = buildClient({
      channel: cfg.channel,
      storeId: cfg.storeId,
      apiKeyEncrypted: cfg.apiKeyEncrypted,
      apiSecretEncrypted: cfg.apiSecretEncrypted,
    });
    if (!client) {
      results.push({ channel: cfg.channel, ok: false, message: 'missing credentials' });
      continue;
    }
    const payload: AggregatorMenuItem[] = items.map((i) => ({
      externalSku: i.sku,
      localMenuItemId: i.id,
      name: i.name,
      priceCents: i.priceCents,
      isAvailable: i.isAvailable,
      prepTimeMinutes: 15,
    }));
    try {
      await client.syncMenu(payload);
      results.push({ channel: cfg.channel, ok: true, message: 'synced', itemCount: items.length });
    } catch (e) {
      results.push({ channel: cfg.channel, ok: false, message: (e as Error).message });
    }
  }
  return results;
}

export async function toggleItemAvailabilityOnChannels(
  branchId: string,
  menuItemId: string,
  isAvailable: boolean,
): Promise<SyncResult[]> {
  const item = await prisma.menuItem.findFirst({ where: { id: menuItemId, branchId } });
  if (!item) throw new Error('MenuItem not found in branch');
  const configs = await prisma.channelConfig.findMany({
    where: { branchId, enabled: true },
  });
  const results: SyncResult[] = [];
  for (const cfg of configs) {
    const client = buildClient({
      channel: cfg.channel,
      storeId: cfg.storeId,
      apiKeyEncrypted: cfg.apiKeyEncrypted,
      apiSecretEncrypted: cfg.apiSecretEncrypted,
    });
    if (!client) {
      results.push({ channel: cfg.channel, ok: false, message: 'missing credentials' });
      continue;
    }
    try {
      await client.setItemAvailability(item.sku, isAvailable);
      results.push({ channel: cfg.channel, ok: true, message: isAvailable ? 'available' : 'unavailable' });
    } catch (e) {
      logger.warn(
        { err: (e as Error).message, channel: cfg.channel, sku: item.sku },
        'setItemAvailability failed',
      );
      results.push({ channel: cfg.channel, ok: false, message: (e as Error).message });
    }
  }
  return results;
}
