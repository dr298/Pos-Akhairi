// Channel client registry. Given a ChannelConfig row, return a usable
// AggregatorClient with credentials decrypted.

import type { Channel } from '@prisma/client';
import type { AggregatorClient, AggregatorConfig } from './types.js';
import { GoFoodClient } from './gofood.js';
import { GrabFoodClient } from './grabfood.js';
import { ShopeeFoodClient } from './shopeefood.js';
import { decrypt } from './crypto.js';

export interface ChannelConfigRow {
  channel: Channel;
  storeId: string | null;
  apiKeyEncrypted: string | null;
  apiSecretEncrypted: string | null;
}

export function buildClient(row: ChannelConfigRow): AggregatorClient | null {
  if (!row.storeId || !row.apiKeyEncrypted || !row.apiSecretEncrypted) {
    return null;
  }
  const config: AggregatorConfig = {
    storeId: row.storeId,
    apiKey: decrypt(row.apiKeyEncrypted),
    apiSecret: decrypt(row.apiSecretEncrypted),
  };
  switch (row.channel) {
    case 'GOFOOD':
      return new GoFoodClient(config);
    case 'GRABFOOD':
      return new GrabFoodClient(config);
    case 'SHOPEEFOOD':
      return new ShopeeFoodClient(config);
    default:
      return null;
  }
}
