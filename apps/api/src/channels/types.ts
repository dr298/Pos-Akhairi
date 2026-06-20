// Common types for delivery aggregator integrations.
//
// Each channel (GoFood, GrabFood, ShopeeFood) implements a common interface.
// The actual HTTP wire format differs, but the semantics — fetch new orders,
// update status, push menu availability — are the same.

import type { Channel } from '@prisma/client';

export type AggregatorOrderStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REJECTED';

export interface AggregatorMenuItem {
  /** Aggregator-side SKU (channel id for this product). */
  externalSku: string;
  /** Local menu item id (POS-side). */
  localMenuItemId: string;
  name: string;
  priceCents: number;
  isAvailable: boolean;
  /** Optional prep time override in minutes. */
  prepTimeMinutes?: number;
}

export interface AggregatorOrderItem {
  externalSku: string;
  name: string;
  quantity: number;
  priceCents: number;
  notes?: string;
  modifiers?: { name: string; priceCents: number }[];
}

export interface AggregatorOrder {
  externalId: string;
  externalRef?: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryLat?: number;
  deliveryLng?: number;
  deliveryNotes?: string;
  items: AggregatorOrderItem[];
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  discountCents: number;
  commissionCents: number;
  totalCents: number;
  status: AggregatorOrderStatus;
  /** ISO timestamp from aggregator. */
  orderedAt: string;
  /** ISO timestamp for delivery deadline (when applicable). */
  expectedDeliveryAt?: string;
  /** Raw payload for audit / debugging. */
  raw: unknown;
}

export interface AggregatorConfig {
  storeId: string;
  apiKey: string;
  apiSecret: string;
  /** Aggregator-specific JSON blob (store hours, etc.). */
  extras?: Record<string, unknown>;
}

export interface AggregatorClient {
  channel: Channel;
  /** Fetch new orders since `cursor` (or recent if undefined). */
  fetchOrders(since?: string): Promise<AggregatorOrder[]>;
  /** Fetch a single order by id. */
  fetchOrder(externalId: string): Promise<AggregatorOrder | null>;
  /** Acknowledge / accept the order. */
  acceptOrder(externalId: string, prepMinutes: number): Promise<void>;
  /** Reject the order. */
  rejectOrder(externalId: string, reason: string): Promise<void>;
  /** Mark ready for pickup. */
  markReady(externalId: string): Promise<void>;
  /** Push menu + availability to the aggregator. */
  syncMenu(items: AggregatorMenuItem[]): Promise<void>;
  /** Update availability of a single item. */
  setItemAvailability(externalSku: string, isAvailable: boolean): Promise<void>;
  /** Cancel an order from our side. */
  cancelOrder(externalId: string, reason: string): Promise<void>;
  /** Verify an inbound webhook signature. */
  verifyWebhook(headers: Record<string, string>, body: string): boolean;
  /** Optional: status to be polled periodically. */
  pollIntervalSeconds(): number;
}

export class AggregatorError extends Error {
  status?: number;
  channel: Channel;
  constructor(channel: Channel, message: string, status?: number) {
    super(message);
    this.channel = channel;
    this.status = status;
  }
}
