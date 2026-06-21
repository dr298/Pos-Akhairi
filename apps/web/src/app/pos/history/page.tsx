'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { api, type Order } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatIDR } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_TONES: Record<string, 'success' | 'warning' | 'danger' | 'muted' | 'info' | 'default'> = {
  PAID: 'success',
  OPEN: 'warning',
  VOIDED: 'danger',
  REFUNDED: 'danger',
};

const TYPE_LABEL: Record<string, string> = {
  DINE_IN: 'Dine In',
  TAKEOUT: 'Takeout',
  TAKEAWAY: 'Takeout',
};

export default function HistoryPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Order | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getOrders();
      setOrders((res.data || []).slice(0, 50));
    } catch (e: any) {
      toast.error(e?.message || 'Gagal memuat pesanan');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="flex-1 p-4 sm:p-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-neutral-100">Riwayat Pesanan</h1>
        <Button size="sm" variant="outline" onClick={refresh}>
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-neutral-400">Memuat…</div>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-sm text-neutral-400">Belum ada pesanan.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          <div className="space-y-2">
            {orders.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setSelected(o)}
                className={cn(
                  'w-full text-left rounded-lg border bg-neutral-900 hover:bg-neutral-800 transition-colors p-3',
                  selected?.id === o.id
                    ? 'border-red-500'
                    : 'border-neutral-800 hover:border-neutral-700',
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-neutral-100">
                      {o.orderNumber}
                    </div>
                    <div className="text-xs text-neutral-400">
                      {new Date(o.openedAt).toLocaleString('id-ID')}
                    </div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      {TYPE_LABEL[o.type] || o.type}
                      {o.tableNumber ? ` · Meja ${o.tableNumber}` : ''}
                      {o.customerName ? ` · ${o.customerName}` : ''}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-semibold text-neutral-100">
                      {formatIDR(o.totalCents)}
                    </div>
                    <Badge tone={STATUS_TONES[o.status] || 'muted'} className="mt-1">
                      {o.status}
                    </Badge>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="lg:sticky lg:top-20 lg:self-start">
            {selected ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{selected.orderNumber}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge tone={STATUS_TONES[selected.status] || 'muted'}>
                        {selected.status}
                      </Badge>
                      <Link href={`/pos/orders/${selected.id}`}>
                        <Button size="sm" variant="outline">Detail</Button>
                      </Link>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="text-xs text-neutral-500">
                    {new Date(selected.openedAt).toLocaleString('id-ID')}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-400">Tipe</span>
                    <span>{TYPE_LABEL[selected.type] || selected.type}</span>
                  </div>
                  {selected.tableNumber && (
                    <div className="flex justify-between">
                      <span className="text-neutral-400">Meja</span>
                      <span>{selected.tableNumber}</span>
                    </div>
                  )}
                  {selected.customerName && (
                    <div className="flex justify-between">
                      <span className="text-neutral-400">Pelanggan</span>
                      <span>{selected.customerName}</span>
                    </div>
                  )}
                  <div className="border-t border-neutral-800 pt-2 mt-2 space-y-1">
                    {selected.items.map((it) => (
                      <div key={it.id} className="flex justify-between">
                        <span className="truncate text-neutral-200">
                          {it.quantity}× {it.nameSnapshot}
                        </span>
                        <span className="text-neutral-300">
                          {formatIDR(it.lineTotalCents)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-neutral-800 pt-2 mt-2 space-y-0.5 text-xs">
                    <div className="flex justify-between text-neutral-400">
                      <span>Subtotal</span>
                      <span>{formatIDR(selected.subtotalCents)}</span>
                    </div>
                    <div className="flex justify-between text-neutral-400">
                      <span>Pajak</span>
                      <span>{formatIDR(selected.taxCents)}</span>
                    </div>
                    {selected.discountCents > 0 && (
                      <div className="flex justify-between text-neutral-400">
                        <span>Diskon</span>
                        <span>-{formatIDR(selected.discountCents)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-semibold text-neutral-100 pt-1">
                      <span>Total</span>
                      <span>{formatIDR(selected.totalCents)}</span>
                    </div>
                  </div>
                  {selected.payments && selected.payments.length > 0 && (
                    <div className="border-t border-neutral-800 pt-2 mt-2 space-y-1 text-xs">
                      {selected.payments.map((p) => (
                        <div key={p.id} className="flex justify-between text-neutral-400">
                          <span>
                            {p.provider} · {p.status}
                          </span>
                          <span>{formatIDR(p.amountCents)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent>
                  <p className="text-sm text-neutral-400">Pilih pesanan untuk detail.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
