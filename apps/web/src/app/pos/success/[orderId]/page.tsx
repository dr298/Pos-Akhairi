'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatIDR } from '@/lib/format';
import { toast } from 'sonner';
import { api, type Order, type OrderItem, ApiError } from '@/lib/api';
import {
  connectPrinter,
  isWebBluetoothSupported,
  writeBytes,
  type ConnectedPrinter,
} from '@/lib/bluetooth-printer';
import { buildReceipt } from '@/lib/escpos';
import { useAuth } from '@/hooks/useAuth';

const printerEnabled =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_PRINTER_ENABLED === 'true';

export default function SuccessPage() {
  const params = useParams<{ orderId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const orderId = params?.orderId ?? '';
  const orderNumber = searchParams.get('orderNumber') ?? '';
  const total = Number(searchParams.get('total') ?? '0');
  const given = Number(searchParams.get('given') ?? '0');
  const change = Number(searchParams.get('change') ?? '0');
  const method = searchParams.get('method') ?? 'CASH';
  const { user } = useAuth();

  const [order, setOrder] = useState<Order | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printer, setPrinter] = useState<ConnectedPrinter | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

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

  // Auto-disconnect on unmount.
  useEffect(() => {
    return () => {
      if (printer) {
        try {
          printer.disconnect();
        } catch {
          // ignore
        }
      }
    };
  }, [printer]);

  async function handleBluetoothPrint() {
    if (!printerEnabled) {
      toast.info('Printer Bluetooth belum diaktifkan (set NEXT_PUBLIC_PRINTER_ENABLED=true).');
      handleBrowserPrint();
      return;
    }
    if (!isWebBluetoothSupported()) {
      toast.error('Browser tidak mendukung Web Bluetooth. Pakai print biasa.');
      handleBrowserPrint();
      return;
    }
    setPrinting(true);
    try {
      let conn = printer;
      if (!conn) {
        conn = await connectPrinter();
        setPrinter(conn);
      }
      const data = buildReceipt({
        header: 'BKJ POS',
        orderNumber: order?.orderNumber || orderNumber || '—',
        orderType: order?.type,
        tableNumber: order?.tableNumber,
        customerName: order?.customerName,
        cashierName: user?.name,
        items: (order?.items || []).map((it: OrderItem) => ({
          quantity: it.quantity,
          name: it.nameSnapshot,
          priceCents: it.lineTotalCents,
        })),
        subtotalCents: order?.subtotalCents ?? 0,
        taxCents: order?.taxCents ?? 0,
        discountCents: order?.discountCents ?? 0,
        totalCents: order?.totalCents ?? total,
        amountGivenCents: method === 'CASH' ? given : undefined,
        changeCents: method === 'CASH' ? change : undefined,
        paymentMethod: method,
        footer: 'Terima kasih!',
      });
      await writeBytes(conn.characteristic, data);
      toast.success('Struk dicetak ke printer Bluetooth');
    } catch (e: any) {
      if (e?.name === 'NotFoundError') {
        toast.error('Pemilihan printer dibatalkan');
      } else {
        toast.error(e?.message || 'Gagal mencetak ke printer');
      }
    } finally {
      setPrinting(false);
    }
  }

  function handleBrowserPrint() {
    window.print();
  }

  return (
    <div className="flex-1 p-4 sm:p-6 flex items-start sm:items-center justify-center print:p-0 print:justify-start print:block">
      <Card className="w-full max-w-md print:hidden">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-emerald-400">Pembayaran Berhasil</CardTitle>
            <Badge tone="success">{order?.status || 'PAID'}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-4 text-center">
            <div className="text-xs text-neutral-500">Nomor Pesanan</div>
            <div className="text-2xl font-bold tracking-wider text-neutral-900 dark:text-neutral-100 mt-1">
              {order?.orderNumber || orderNumber || '—'}
            </div>
          </div>

          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-neutral-500 dark:text-neutral-400">Metode</span>
              <span className="text-neutral-900 dark:text-neutral-100">{method}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500 dark:text-neutral-400">Total</span>
              <span className="text-neutral-900 dark:text-neutral-100 font-semibold">
                {formatIDR(order?.totalCents ?? total)}
              </span>
            </div>
            {method === 'CASH' && (
              <>
                <div className="flex justify-between">
                  <span className="text-neutral-500 dark:text-neutral-400">Tunai</span>
                  <span className="text-neutral-900 dark:text-neutral-100">{formatIDR(given)}</span>
                </div>
                <div className="flex justify-between text-base">
                  <span className="text-neutral-800 dark:text-neutral-200 font-semibold">Kembalian</span>
                  <span className="text-emerald-400 font-semibold">{formatIDR(change)}</span>
                </div>
              </>
            )}
          </div>

          {order && order.items.length > 0 && (
            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
              <div className="text-xs text-neutral-500 mb-2">Item</div>
              <ul className="space-y-1 text-sm">
                {order.items.map((it) => (
                  <li key={it.id} className="flex justify-between">
                    <span className="text-neutral-800 dark:text-neutral-200 truncate">
                      {it.quantity}× {it.nameSnapshot}
                    </span>
                    <span className="text-neutral-700 dark:text-neutral-300">{formatIDR(it.lineTotalCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button
              variant="outline"
              onClick={handleBluetoothPrint}
              disabled={printing}
            >
              {printing ? 'Mencetak…' : 'Cetak Struk'}
            </Button>
            <Link href="/pos">
              <Button className="w-full" onClick={() => router.push('/pos')}>
                Pesanan Baru
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-2">
            <Button variant="ghost" onClick={handleBrowserPrint}>
              Print via Browser
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Print-only receipt */}
      <div ref={receiptRef} className="hidden print:block w-full max-w-xs mx-auto p-4 text-black">
        <div className="text-center font-bold text-lg">BKJ POS</div>
        <div className="text-center text-sm">No. {order?.orderNumber || orderNumber}</div>
        <div className="text-center text-xs">
          {new Date().toLocaleString('id-ID')}
        </div>
        <hr className="my-2 border-black" />
        {(order?.items || []).map((it) => (
          <div key={it.id} className="text-sm flex justify-between">
            <span>
              {it.quantity}× {it.nameSnapshot}
            </span>
            <span>{formatIDR(it.lineTotalCents)}</span>
          </div>
        ))}
        <hr className="my-2 border-black" />
        <div className="text-sm flex justify-between">
          <span>Subtotal</span>
          <span>{formatIDR(order?.subtotalCents ?? 0)}</span>
        </div>
        {order && order.discountCents > 0 && (
          <div className="text-sm flex justify-between">
            <span>Diskon</span>
            <span>-{formatIDR(order.discountCents)}</span>
          </div>
        )}
        <div className="text-sm flex justify-between">
          <span>Pajak</span>
          <span>{formatIDR(order?.taxCents ?? 0)}</span>
        </div>
        <div className="text-base font-bold flex justify-between">
          <span>Total</span>
          <span>{formatIDR(order?.totalCents ?? total)}</span>
        </div>
        {method === 'CASH' && (
          <>
            <div className="text-sm flex justify-between">
              <span>Tunai</span>
              <span>{formatIDR(given)}</span>
            </div>
            <div className="text-sm flex justify-between">
              <span>Kembali</span>
              <span>{formatIDR(change)}</span>
            </div>
          </>
        )}
        <hr className="my-2 border-black" />
        <div className="text-center text-xs">Terima kasih!</div>
      </div>
    </div>
  );
}
