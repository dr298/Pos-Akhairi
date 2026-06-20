// GrabFood (Grab) partner client.
// Uses Grab's "GrabFood" partner API. Base URL: https://partner-api.grab.com.
// All requests signed with HMAC-SHA256 over (timestamp + method + path + body).

import { createHmac } from 'node:crypto';
import type {
  AggregatorClient,
  AggregatorConfig,
  AggregatorMenuItem,
  AggregatorOrder,
} from './types.js';
import { AggregatorError } from './types.js';

const DEFAULT_BASE_URL = 'https://partner-api.grab.com';

export class GrabFoodClient implements AggregatorClient {
  channel = 'GRABFOOD' as const;
  private baseUrl: string;
  private config: AggregatorConfig;

  constructor(config: AggregatorConfig, baseUrl = DEFAULT_BASE_URL) {
    this.config = config;
    this.baseUrl = baseUrl;
  }

  pollIntervalSeconds(): number {
    return 30;
  }

  private sign(method: string, path: string, body: string, ts: string): string {
    return createHmac('sha256', this.config.apiSecret)
      .update(`${ts}\n${method.toUpperCase()}\n${path}\n${body}`)
      .digest('hex');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const bodyStr = body !== undefined ? JSON.stringify(body) : '';
    const ts = String(Date.now());
    const sig = this.sign(method, path, bodyStr, ts);
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        authorization: `${this.config.apiKey}:${sig}`,
        'x-grabkit-date': ts,
        'content-type': 'application/json',
      },
    };
    if (body !== undefined) init.body = bodyStr;
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      throw new AggregatorError('GRABFOOD', `Network error: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AggregatorError('GRABFOOD', `HTTP ${res.status}: ${text}`, res.status);
    }
    return (await res.json()) as T;
  }

  async fetchOrders(since?: string): Promise<AggregatorOrder[]> {
    const path = since
      ? `/grabfood/v1/orders?merchantID=${this.config.storeId}&updatedSince=${encodeURIComponent(since)}`
      : `/grabfood/v1/orders?merchantID=${this.config.storeId}&orderStatus=NEW`;
    const data = await this.request<{ orders: GrabOrder[] }>('GET', path);
    return (data.orders || []).map((o) => mapGrabOrder(o));
  }

  async fetchOrder(externalId: string): Promise<AggregatorOrder | null> {
    try {
      const data = await this.request<GrabOrder>('GET', `/grabfood/v1/orders/${externalId}`);
      return mapGrabOrder(data);
    } catch (e) {
      if (e instanceof AggregatorError && e.status === 404) return null;
      throw e;
    }
  }

  async acceptOrder(externalId: string, prepMinutes: number): Promise<void> {
    await this.request('POST', `/grabfood/v1/orders/${externalId}/accept`, {
      prepareFor: prepMinutes,
    });
  }

  async rejectOrder(externalId: string, reason: string): Promise<void> {
    await this.request('POST', `/grabfood/v1/orders/${externalId}/reject`, { reason });
  }

  async markReady(externalId: string): Promise<void> {
    await this.request('POST', `/grabfood/v1/orders/${externalId}/ready`);
  }

  async cancelOrder(externalId: string, reason: string): Promise<void> {
    await this.request('POST', `/grabfood/v1/orders/${externalId}/cancel`, { reason });
  }

  async syncMenu(items: AggregatorMenuItem[]): Promise<void> {
    await this.request('PUT', `/grabfood/v1/merchants/${this.config.storeId}/menu`, {
      menu: items.map((i) => ({
        id: i.externalSku,
        name: i.name,
        price: { value: i.priceCents, currency: 'IDR' },
        available: i.isAvailable,
        cookingTime: i.prepTimeMinutes ?? 15,
      })),
    });
  }

  async setItemAvailability(externalSku: string, isAvailable: boolean): Promise<void> {
    await this.request('PATCH', `/grabfood/v1/merchants/${this.config.storeId}/menu/${externalSku}`, {
      available: isAvailable,
    });
  }

  verifyWebhook(headers: Record<string, string>, body: string): boolean {
    const sig = headers['authorization']?.split(':')[1] || headers['x-grab-signature'];
    if (!sig) return false;
    const ts = headers['x-grabkit-date'] || '';
    const method = headers['x-grabkit-method'] || 'POST';
    const path = headers['x-grabkit-path'] || '';
    const expected = this.sign(method, path, body, ts);
    return safeEqual(sig, expected);
  }
}

interface GrabOrder {
  orderID: string;
  shortOrderNumber?: string;
  orderStatus: string;
  patron?: { firstName?: string; phone?: string };
  deliveryAddress?: {
    address?: string;
    latitude?: number;
    longitude?: number;
    notes?: string;
  };
  items: Array<{
    itemID: string;
    name: string;
    quantity: number;
    price: number;
    specialInstructions?: string;
    modifiers?: Array<{ name: string; price: number }>;
  }>;
  payment?: {
    subtotal?: number;
    deliveryFee?: number;
    serviceFee?: number;
    discount?: number;
    commission?: number;
    total?: number;
  };
  createdAt: string;
  deliverBy?: string;
}

function mapGrabOrder(o: GrabOrder): AggregatorOrder {
  return {
    externalId: o.orderID,
    externalRef: o.shortOrderNumber,
    customerName: o.patron?.firstName,
    customerPhone: o.patron?.phone,
    deliveryAddress: o.deliveryAddress?.address,
    deliveryLat: o.deliveryAddress?.latitude,
    deliveryLng: o.deliveryAddress?.longitude,
    deliveryNotes: o.deliveryAddress?.notes,
    items: (o.items || []).map((i) => ({
      externalSku: i.itemID,
      name: i.name,
      quantity: i.quantity,
      priceCents: i.price,
      notes: i.specialInstructions,
      modifiers: i.modifiers?.map((m) => ({ name: m.name, priceCents: m.price })),
    })),
    subtotalCents: o.payment?.subtotal ?? 0,
    deliveryFeeCents: o.payment?.deliveryFee ?? 0,
    serviceFeeCents: o.payment?.serviceFee ?? 0,
    discountCents: o.payment?.discount ?? 0,
    commissionCents: o.payment?.commission ?? 0,
    totalCents: o.payment?.total ?? 0,
    status: mapGrabStatus(o.orderStatus),
    orderedAt: o.createdAt,
    expectedDeliveryAt: o.deliverBy,
    raw: o,
  };
}

function mapGrabStatus(s: string): AggregatorOrder['status'] {
  switch ((s || '').toUpperCase()) {
    case 'NEW':
    case 'SCHEDULED':
      return 'PENDING';
    case 'ACCEPTED':
      return 'ACCEPTED';
    case 'COOKING':
    case 'PREPARING':
      return 'PREPARING';
    case 'READY':
    case 'READY_FOR_PICKUP':
      return 'READY';
    case 'DRIVER_ASSIGNED':
    case 'PICKED_UP':
      return 'PICKED_UP';
    case 'DELIVERED':
    case 'COMPLETED':
      return 'DELIVERED';
    case 'CANCELLED':
    case 'VOIDED':
      return 'CANCELLED';
    case 'REJECTED':
      return 'REJECTED';
    default:
      return 'PENDING';
  }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
