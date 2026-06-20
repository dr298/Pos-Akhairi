// ShopeeFood (Shopee) partner client.
// Base URL: https://partner.open-api.shopeemobile.com.
// Auth: SHA256 of (partnerId + path + timestamp + accessToken + shopId) +
// partnerKey (HMAC variant in newer revisions). This is the standard Shopee
// open platform signature scheme.

import { createHmac, createHash } from 'node:crypto';
import type {
  AggregatorClient,
  AggregatorConfig,
  AggregatorMenuItem,
  AggregatorOrder,
} from './types.js';
import { AggregatorError } from './types.js';

const DEFAULT_BASE_URL = 'https://partner.open-api.shopeemobile.com';

export class ShopeeFoodClient implements AggregatorClient {
  channel = 'SHOPEEFOOD' as const;
  private baseUrl: string;
  private config: AggregatorConfig;
  // storeId holds "partnerId:shopId" (Shopee is multi-tenant; we pair them).
  private partnerId: string;
  private shopId: string;

  constructor(config: AggregatorConfig, baseUrl = DEFAULT_BASE_URL) {
    this.config = config;
    this.baseUrl = baseUrl;
    const [partnerId, shopId] = (config.storeId || '').split(':');
    this.partnerId = partnerId || '';
    this.shopId = shopId || '';
  }

  pollIntervalSeconds(): number {
    return 30;
  }

  private sign(method: string, path: string, body: string, ts: number): string {
    // Shopee v2: HMAC-SHA256(key=partnerKey, msg=partnerId + path + ts + accessToken + shopId + body)
    const msg = `${this.partnerId}${path}${ts}${this.config.apiKey}${this.shopId}${body}`;
    return createHmac('sha256', this.config.apiSecret).update(msg).digest('hex');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const bodyStr = body !== undefined ? JSON.stringify(body) : '';
    const ts = Math.floor(Date.now() / 1000);
    const sig = this.sign(method, path, bodyStr, ts);
    const qs = `partner_id=${this.partnerId}&shop_id=${this.shopId}&timestamp=${ts}&access_token=${encodeURIComponent(this.config.apiKey)}&sign=${sig}`;
    const url = `${this.baseUrl}${path}?${qs}`;
    const init: RequestInit = {
      method,
      headers: { 'content-type': 'application/json' },
    };
    if (body !== undefined) init.body = bodyStr;
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      throw new AggregatorError('SHOPEEFOOD', `Network error: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AggregatorError('SHOPEEFOOD', `HTTP ${res.status}: ${text}`, res.status);
    }
    const data = (await res.json()) as { response?: T; error?: string; message?: string };
    if (data.error) {
      throw new AggregatorError('SHOPEEFOOD', `${data.error}: ${data.message ?? ''}`);
    }
    return data.response as T;
  }

  async fetchOrders(since?: string): Promise<AggregatorOrder[]> {
    const path = '/api/v2/food/order/get_order_list';
    const params: Record<string, unknown> = {
      page_size: 50,
      time_range_field: 'update_time',
      order_status: 'READY_TO_PICKUP,PREPARING,PENDING,CONFIRMED,DELIVERED,CANCELLED',
    };
    if (since) {
      params.update_time_from = Math.floor(new Date(since).getTime() / 1000);
      params.update_time_to = Math.floor(Date.now() / 1000);
    }
    const data = await this.request<{
      order_list: Array<{ order_sn: string; update_time: number }>;
    }>('GET', path, params);
    const orders: AggregatorOrder[] = [];
    for (const ref of data.order_list || []) {
      try {
        const o = await this.fetchOrder(ref.order_sn);
        if (o) orders.push(o);
      } catch (e) {
        // log and continue
        continue;
      }
    }
    return orders;
  }

  async fetchOrder(externalId: string): Promise<AggregatorOrder | null> {
    try {
      const data = await this.request<ShopeeOrder>('GET', '/api/v2/food/order/get_order_detail', {
        order_sn: externalId,
      });
      return mapShopeeOrder(data);
    } catch (e) {
      if (e instanceof AggregatorError && e.status === 404) return null;
      throw e;
    }
  }

  async acceptOrder(externalId: string, prepMinutes: number): Promise<void> {
    await this.request('POST', '/api/v2/food/order/accept_order', {
      order_sn: externalId,
      prepare_time_minutes: prepMinutes,
    });
  }

  async rejectOrder(externalId: string, reason: string): Promise<void> {
    await this.request('POST', '/api/v2/food/order/cancel_order', {
      order_sn: externalId,
      cancel_reason: reason,
    });
  }

  async markReady(externalId: string): Promise<void> {
    await this.request('POST', '/api/v2/food/order/set_order_ready', { order_sn: externalId });
  }

  async cancelOrder(externalId: string, reason: string): Promise<void> {
    await this.request('POST', '/api/v2/food/order/cancel_order', {
      order_sn: externalId,
      cancel_reason: reason,
    });
  }

  async syncMenu(items: AggregatorMenuItem[]): Promise<void> {
    await this.request('POST', '/api/v2/food/product/update_stock_batch', {
      item_list: items.map((i) => ({
        item_id: i.externalSku,
        stock: i.isAvailable ? 999 : 0,
      })),
    });
  }

  async setItemAvailability(externalSku: string, isAvailable: boolean): Promise<void> {
    await this.request('POST', '/api/v2/food/product/update_stock', {
      item_id: externalSku,
      stock: isAvailable ? 999 : 0,
    });
  }

  verifyWebhook(headers: Record<string, string>, body: string): boolean {
    // Shopee uses HMAC-SHA256 over the raw body, in the X-Shopee-Hmac-Sha256
    // header (hex). We compare with the partner key.
    const sig = headers['x-shopee-hmac-sha256'] || headers['X-Shopee-Hmac-Sha256'];
    if (!sig) return false;
    const expected = createHmac('sha256', this.config.apiSecret)
      .update(body, 'utf8')
      .digest('hex');
    return safeEqual(sig, expected);
  }
}

interface ShopeeOrder {
  order_sn: string;
  booking_id?: string;
  order_status: string;
  buyer_name?: string;
  buyer_phone?: string;
  shipping_address?: {
    address?: string;
    latitude?: number;
    longitude?: number;
    note?: string;
  };
  item_list: Array<{
    item_id: string;
    item_name: string;
    quantity: number;
    item_price: number;
    note?: string;
  }>;
  total_amount?: number;
  shipping_fee?: number;
  service_fee?: number;
  discount?: number;
  commission_fee?: number;
  create_time: number;
  pickup_time?: number;
}

function mapShopeeOrder(o: ShopeeOrder): AggregatorOrder {
  const items: AggregatorOrder['items'] = (o.item_list || []).map((i) => ({
    externalSku: i.item_id,
    name: i.item_name,
    quantity: i.quantity,
    priceCents: i.item_price,
    notes: i.note,
  }));
  const subtotal = items.reduce((s, i) => s + i.priceCents * i.quantity, 0);
  return {
    externalId: o.order_sn,
    externalRef: o.booking_id,
    customerName: o.buyer_name,
    customerPhone: o.buyer_phone,
    deliveryAddress: o.shipping_address?.address,
    deliveryLat: o.shipping_address?.latitude,
    deliveryLng: o.shipping_address?.longitude,
    deliveryNotes: o.shipping_address?.note,
    items,
    subtotalCents: subtotal,
    deliveryFeeCents: o.shipping_fee ?? 0,
    serviceFeeCents: o.service_fee ?? 0,
    discountCents: o.discount ?? 0,
    commissionCents: o.commission_fee ?? 0,
    totalCents: o.total_amount ?? subtotal,
    status: mapShopeeStatus(o.order_status),
    orderedAt: new Date(o.create_time * 1000).toISOString(),
    expectedDeliveryAt: o.pickup_time ? new Date(o.pickup_time * 1000).toISOString() : undefined,
    raw: o,
  };
}

function mapShopeeStatus(s: string): AggregatorOrder['status'] {
  switch ((s || '').toUpperCase()) {
    case 'PENDING':
    case 'UNPAID':
      return 'PENDING';
    case 'CONFIRMED':
    case 'ACCEPTED':
      return 'ACCEPTED';
    case 'PREPARING':
      return 'PREPARING';
    case 'READY_TO_PICKUP':
    case 'READY':
      return 'READY';
    case 'PICKED_UP':
    case 'SHIPPED':
      return 'PICKED_UP';
    case 'DELIVERED':
    case 'COMPLETED':
      return 'DELIVERED';
    case 'CANCELLED':
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
