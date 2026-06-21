// Tiny event bus for broadcasting order events to all connected WebSocket
// clients. In-process; if we later run multiple API instances, swap for Redis
// pub/sub or a shared broker.

import type { WSContext } from '../lib/ws.js';

export interface OrderEvent {
  type:
    | 'order.created'
    | 'order.paid'
    | 'order.voided'
    | 'order.refunded'
    | 'day.closed'
    | 'table.opened'
    | 'table.closed'
    | 'table.transferred';
  orderId?: string;
  orderNumber?: string;
  totalCents?: number;
  status?: string;
  dailyCloseId?: string;
  businessDate?: string;
  totals?: Record<string, number | string>;
  // Sprint 9.3 — table events
  tableId?: string;
  tableNumber?: string;
  sessionId?: string;
  fromTableId?: string;
  toTableId?: string;
  fromNumber?: string;
  toNumber?: string;
  at: number;
}

class WSBus {
  private clients = new Set<WSContext>();

  add(ctx: WSContext) {
    this.clients.add(ctx);
  }

  remove(ctx: WSContext) {
    this.clients.delete(ctx);
  }

  size(): number {
    return this.clients.size;
  }

  broadcast(event: OrderEvent) {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      try {
        client.send(payload);
      } catch {
        // ignore
      }
    }
  }
}

export const wsBus = new WSBus();
