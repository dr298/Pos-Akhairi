'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatIDR } from '@/lib/format';
import { toast } from 'sonner';
import { api, type Order, ApiError } from '@/lib/api';

const printEnabled =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_PRINTER_ENABLED === 'true';

export default function SuccessPage() {
  const params = useParams<{ orderId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const orderId = params?.orderId ?? '';
  const orderNumber =
    searchParams.get('orderNumber') ?? '';
  const total = Number(searchParams.get('total') ?? '0');
  const given = Number(searchParams.get('given') ?? '0');
  const change = Number(searchParams.get('change') ?? '0');

  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getOrder(orderId);
        if (!cancelled) setOrder(res.data);
      } catch (e) {
        // It's fine to render with query params even if fetch fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  function handlePrint() {
    if (printEnabled) {
      // Sprint 2 will hook Web Bluetooth here.
      toast.success('Struk dikirim ke printer');
    } else {
      toast.info('Printer belum diaktifkan (Sprint 2)');
    }
  }

  return (
    <div className="flex-1 p-4 sm:p-6 flex items-start sm:items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-emerald-400">Pembayaran Berhasil</CardTitle>
            <Badge tone="success">PAID</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-neutral-800 bg-neutral-950 p-4 text-center">
            <div className="text-xs text-neutral-500">Nomor Pesanan</div>
            <div className="text-2xl font-bold tracking-wider text-neutral-100 mt-1">
              {order?.orderNumber || orderNumber || '—'}
            </div>
          </div>

          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-neutral-400">Total</span>
              <span className="text-neutral-100 font-semibold">
                {formatIDR(order?.totalCents ?? total)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">Tunai</span>
              <span className="text-neutral-100">{formatIDR(given)}</span>
            </div>
            <div className="flex justify-between text-base">
              <span className="text-neutral-200 font-semibold">Kembalian</span>
              <span className="text-emerald-400 font-semibold">{formatIDR(change)}</span>
            </div>
          </div>

          {order && order.items.length > 0 && (
            <div className="border-t border-neutral-800 pt-3">
              <div className="text-xs text-neutral-500 mb-2">Item</div>
              <ul className="space-y-1 text-sm">
                {order.items.map((it) => (
                  <li key={it.id} className="flex justify-between">
                    <span className="text-neutral-200 truncate">
                      {it.quantity}× {it.nameSnapshot}
                    </span>
                    <span className="text-neutral-300">{formatIDR(it.lineTotalCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button variant="outline" onClick={handlePrint}>
              Cetak Struk
            </Button>
            <Link href="/pos">
              <Button className="w-full" onClick={() => router.push('/pos')}>
                Pesanan Baru
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
