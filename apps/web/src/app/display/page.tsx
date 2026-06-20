'use client';

import { useEffect, useMemo, useState } from 'react';
import { useWebSocket, type WSMessage } from '@/hooks/useWebSocket';
import { api, type Order } from '@/lib/api';
import { formatIDR } from '@/lib/format';
import { cn } from '@/lib/utils';

interface DisplayOrder {
  id: string;
  orderNumber: string;
  status: string;
  totalCents: number;
  items: { name: string; quantity: number }[];
  customerName?: string | null;
  tableNumber?: string | null;
  type: string;
  updatedAt: number;
}

const MAX_VISIBLE = 3;

export default function DisplayPage() {
  const [orders, setOrders] = useState<DisplayOrder[]>([]);
  const [active, setActive] = useState<DisplayOrder | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch recent PAID/OPEN orders
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getOrders();
        if (cancelled) return;
        const recent = (res.data || [])
          .filter((o) => o.status === 'PAID' || o.status === 'OPEN')
          .slice(0, 10)
          .map((o) => toDisplay(o));
        setOrders(recent);
        if (recent.length > 0) setActive(recent[0]);
      } catch {
        // ignore — display still works via WS
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ws = useWebSocket('/ws');

  useEffect(() => {
    return ws.on('order.paid', (msg: WSMessage) => {
      const orderId = String(msg.orderId || '');
      if (!orderId) return;
      // Refresh just that order; fall back to a full refresh if shape missing
      refreshOrder(orderId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  useEffect(() => {
    return ws.on('order.created', (msg: WSMessage) => {
      const orderId = String(msg.orderId || '');
      if (!orderId) return;
      refreshOrder(orderId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  async function refreshOrder(orderId: string) {
    try {
      const res = await api.getOrder(orderId);
      const o = res.data;
      const d = toDisplay(o);
      setOrders((prev) => {
        const filtered = prev.filter((p) => p.id !== d.id);
        return [d, ...filtered].slice(0, 10);
      });
      setActive(d);
    } catch {
      // ignore
    }
  }

  const ready = useMemo(() => orders.filter((o) => o.status === 'PAID'), [orders]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col">
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <span className="text-red-500 font-semibold">🍜 BKJ POS</span>
          <span className="text-neutral-500 text-sm">Customer Display</span>
        </div>
        <div className="text-right">
          <div className="text-2xl tabular-nums font-mono text-neutral-100">
            {now ? now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--'}
          </div>
          <div className="text-xs text-neutral-500">
            {now ? now.toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long' }) : ''}
          </div>
        </div>
        <div className="text-xs">
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-md border',
              ws.status === 'open'
                ? 'border-emerald-700/50 text-emerald-300 bg-emerald-950/30'
                : 'border-neutral-700 text-neutral-400 bg-neutral-900',
            )}
          >
            ● {ws.status === 'open' ? 'live' : ws.status}
          </span>
        </div>
      </header>

      <main className="flex-1 grid grid-rows-2 min-h-0">
        {/* Top: current order */}
        <section className="border-b border-neutral-800 p-4 sm:p-6 flex flex-col min-h-0">
          <div className="text-xs uppercase tracking-wider text-neutral-500">Pesanan Saat Ini</div>
          {active ? (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex items-baseline justify-between gap-4 mt-2">
                <div className="text-5xl sm:text-6xl font-bold tracking-wider text-neutral-100">
                  {active.orderNumber}
                </div>
                <div className="text-3xl sm:text-4xl font-bold text-emerald-400">
                  {formatIDR(active.totalCents)}
                </div>
              </div>
              <div className="text-sm text-neutral-400 mt-1">
                {active.type}
                {active.tableNumber ? ` · Meja ${active.tableNumber}` : ''}
                {active.customerName ? ` · ${active.customerName}` : ''}
              </div>
              <ul className="mt-3 space-y-1 text-2xl sm:text-3xl flex-1 overflow-y-auto">
                {active.items.map((it, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="text-neutral-200">
                      {it.quantity}× {it.name}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-neutral-500 text-xl">
              Menunggu pesanan…
            </div>
          )}
        </section>

        {/* Bottom: status / queue */}
        <section className="p-4 sm:p-6 flex flex-col min-h-0">
          <div className="text-xs uppercase tracking-wider text-neutral-500 mb-3">
            Antrean ({ready.length})
          </div>
          {ready.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="text-3xl sm:text-4xl font-bold text-emerald-400">Silakan Menunggu</div>
                <div className="text-neutral-500 mt-2">Pesananmu sedang kami siapkan</div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1 min-h-0">
              {ready.slice(0, MAX_VISIBLE).map((o) => (
                <div
                  key={o.id}
                  className={cn(
                    'rounded-lg border p-4 flex flex-col justify-between',
                    o.id === active?.id
                      ? 'border-emerald-500 bg-emerald-950/30'
                      : 'border-neutral-800 bg-neutral-900',
                  )}
                >
                  <div>
                    <div className="text-xs text-neutral-500">{o.type}</div>
                    <div className="text-2xl font-bold text-neutral-100 mt-1">
                      {o.orderNumber}
                    </div>
                    {o.tableNumber && (
                      <div className="text-sm text-neutral-400">Meja {o.tableNumber}</div>
                    )}
                    {o.customerName && (
                      <div className="text-sm text-neutral-400">{o.customerName}</div>
                    )}
                  </div>
                  <div className="text-lg font-semibold text-emerald-400 mt-2">
                    {formatIDR(o.totalCents)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function toDisplay(o: Order): DisplayOrder {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    totalCents: o.totalCents,
    items: o.items.map((it) => ({ name: it.nameSnapshot, quantity: it.quantity })),
    customerName: o.customerName,
    tableNumber: o.tableNumber,
    type: o.type,
    updatedAt: Date.now(),
  };
}
