// GoFood (Gojek) partner client.
// Real implementation uses Gojek's partner API at
// https://api.gojekapi.com/v2/... (sandbox: https://api.stg.gojekapi.com).
// This client is wire-compatible with the documented endpoints; the actual
// auth flow (OAuth2 + HMAC) is stubbed behind a clear error so credentials
// can be plugged in later without code changes.

import { createHmac } from 'node:crypto';
import type {
  AggregatorClient,
  AggregatorConfig,
  AggregatorMenuItem,
  AggregatorOrder,
} from './types.js';
import { AggregatorError } from './types.js';
import { logger } from '../logger.js';

const DEFAULT_BASE_URL = 'https://api.gojekapi.com';

export class GoFoodClient implements AggregatorClient {
  channel = 'GOFOOD' as const;
  private baseUrl: string;
  private config: AggregatorConfig;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config: AggregatorConfig, baseUrl = DEFAULT_BASE_URL) {
    this.config = config;
    this.baseUrl = baseUrl;
  }

  pollIntervalSeconds(): number {
    return 30;
  }

  private async ensureToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }
    // Gojek uses OAuth2 client_credentials flow.
    const url = `${this.baseUrl}/oauth/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.storeId,
      client_secret: this.config.apiSecret,
      scope: 'go_food_partner',
    });
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (e) {
      throw new AggregatorError('GOFOOD', `Network error: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AggregatorError('GOFOOD', `OAuth failed: ${res.status} ${text}`, res.status);
    }
    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.ensureToken();
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-request-id': crypto.randomUUID(),
      },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      throw new AggregatorError('GOFOOD', `Network error: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AggregatorError('GOFOOD', `HTTP ${res.status}: ${text}`, res.status);
    }
    return (await res.json()) as T;
  }

  async fetchOrders(since?: string): Promise<AggregatorOrder[]> {
    const path = since
      ? `/v2/orders?store_id=${this.config.storeId}&since=${encodeURIComponent(since)}`
      : `/v2/orders?store_id=${this.config.storeId}&status=PENDING`;
    const data = await this.request<{ orders: GojekOrder[] }>('GET', path);
    return (data.orders || []).map((o) => mapGojekOrder(o));
  }

  async fetchOrder(externalId: string): Promise<AggregatorOrder | null> {
    try {
      const data = await this.request<GojekOrder>('GET', `/v2/orders/${externalId}`);
      return mapGojekOrder(data);
    } catch (e) {
      if (e instanceof AggregatorError && e.status === 404) return null;
      throw e;
    }
  }

  async acceptOrder(externalId: string, prepMinutes: number): Promise<void> {
    await this.request('POST', `/v2/orders/${externalId}/accept`, {
      prep_time_minutes: prepMinutes,
    });
  }

  async rejectOrder(externalId: string, reason: string): Promise<void> {
    await this.request('POST', `/v2/orders/${externalId}/reject`, { reason });
  }

  async markReady(externalId: string): Promise<void> {
    await this.request('POST', `/v2/orders/${externalId}/ready`);
  }

  async cancelOrder(externalId: string, reason: string): Promise<void> {
    await this.request('POST', `/v2/orders/${externalId}/cancel`, { reason });
  }

  async syncMenu(items: AggregatorMenuItem[]): Promise<void> {
    // Gojek's bulk menu update is a PUT with full menu.
    await this.request('PUT', `/v2/stores/${this.config.storeId}/menu`, {
      items: items.map((i) => ({
        sku: i.externalSku,
        name: i.name,
        price: i.priceCents,
        available: i.isAvailable,
        prep_time_minutes: i.prepTimeMinutes ?? 15,
      })),
    });
  }

  async setItemAvailability(externalSku: string, isAvailable: boolean): Promise<void> {
    await this.request('PATCH', `/v2/stores/${this.config.storeId}/menu/${externalSku}`, {
      available: isAvailable,
    });
  }

  verifyWebhook(headers: Record<string, string>, body: string): boolean {
    // Gojek signs webhooks with HMAC-SHA256 using the api secret.
    const sig = headers['x-gojek-signature'] || headers['X-Gojek-Signature'];
    if (!sig) return false;
    const expected = createHmac('sha256', this.config.apiSecret)
      .update(body, 'utf8')
      .digest('hex');
    return safeEqual(sig, expected);
  }
}

// ─── Wire format mappers (documented Gojek shape) ─────────────────────────

interface GojekOrder {
  id: string;
  reference_id?: string;
  status: string;
  customer?: { name?: string; phone?: string };
  delivery?: {
    address?: string;
    latitude?: number;
    longitude?: number;
    notes?: string;
  };
  items: Array<{
    sku: string;
    name: string;
    quantity: number;
    price: number;
    notes?: string;
    modifiers?: Array<{ name: string; price: number }>;
  }>;
  pricing?: {
    subtotal?: number;
    delivery_fee?: number;
    service_fee?: number;
    discount?: number;
    commission?: number;
    total?: number;
  };
  ordered_at: string;
  expected_delivery_at?: string;
}

function mapGojekOrder(o: GojekOrder): AggregatorOrder {
  return {
    externalId: o.id,
    externalRef: o.reference_id,
    customerName: o.customer?.name,
    customerPhone: o.customer?.phone,
    deliveryAddress: o.delivery?.address,
    deliveryLat: o.delivery?.latitude,
    deliveryLng: o.delivery?.longitude,
    deliveryNotes: o.delivery?.notes,
    items: (o.items || []).map((i) => ({
      externalSku: i.sku,
      name: i.name,
      quantity: i.quantity,
      priceCents: i.price,
      notes: i.notes,
      modifiers: i.modifiers?.map((m) => ({ name: m.name, priceCents: m.price })),
    })),
    subtotalCents: o.pricing?.subtotal ?? 0,
    deliveryFeeCents: o.pricing?.delivery_fee ?? 0,
    serviceFeeCents: o.pricing?.service_fee ?? 0,
    discountCents: o.pricing?.discount ?? 0,
    commissionCents: o.pricing?.commission ?? 0,
    totalCents: o.pricing?.total ?? 0,
    status: mapGojekStatus(o.status),
    orderedAt: o.ordered_at,
    expectedDeliveryAt: o.expected_delivery_at,
    raw: o,
  };
}

function mapGojekStatus(s: string): AggregatorOrder['status'] {
  switch ((s || '').toUpperCase()) {
    case 'PENDING':
    case 'NEW':
      return 'PENDING';
    case 'ACCEPTED':
    case 'CONFIRMED':
      return 'ACCEPTED';
    case 'PREPARING':
    case 'COOKING':
      return 'PREPARING';
    case 'READY':
    case 'READY_FOR_PICKUP':
      return 'READY';
    case 'PICKED_UP':
    case 'ON_THE_WAY':
      return 'PICKED_UP';
    case 'DELIVERED':
    case 'COMPLETED':
      return 'DELIVERED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'REJECTED':
      return 'REJECTED';
    default:
      logger.warn({ status: s }, 'GoFood: unknown status');
      return 'PENDING';
  }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
