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
import { usePrinter } from '@/contexts/PrinterContext';

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
  // Sprint 15 — fetch business identity for receipt header / footer.
  const [business, setBusiness] = useState<{
    name: string;
    address: string;
    footer: string;
  } | null>(null);
  // Sprint 19 — paper width from PRINTER_PAPER_WIDTH setting. Default
  // 80mm until the settings fetch returns.
  const [paperWidthMm, setPaperWidthMm] = useState<58 | 80>(80);
  // Sprint 14 — use the shared printer context so the connection persists
  // across /pos → /pos/success navigation.
  const printerCtx = usePrinter();
  const printer = printerCtx.connection;
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
      // Sprint 15 — load business identity. Failure is non-fatal; the
      // receipt falls back to the hardcoded defaults.
      try {
        const b = await api.getBusiness();
        if (!cancelled) setBusiness(b.data);
      } catch (e) {
        // ignore
      }
      // Sprint 19 — load paper width for the receipt layout. Same
      // source-of-truth as /pos/settings (PRINTER_PAPER_WIDTH).
      try {
        const s = await api.listSettings();
        const pw = s.data?.settings?.find((x: any) => x.key === 'PRINTER_PAPER_WIDTH');
        if (!cancelled && pw && (pw.value === '58' || pw.value === '80')) {
          setPaperWidthMm(pw.value === '58' ? 58 : 80);
        }
      } catch (e) {
        // ignore — keep default 80
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  async function handleBluetoothPrint() {
    if (!printerEnabled) {
      toast.error(
        'Printer Bluetooth belum diaktifkan. Set NEXT_PUBLIC_PRINTER_ENABLED=true di .env lalu rebuild pos-web.',
      );
      return;
    }
    if (!isWebBluetoothSupported()) {
      toast.error('Browser tidak mendukung Web Bluetooth. Pakai print biasa.');
      handleBrowserPrint();
      return;
    }
    setPrinting(true);
    try {
      // Sprint 14 — defer to the shared context so the connection sticks
      // around for the next order (no re-prompting the cashier).
      let conn = printerCtx.connection;
      if (!conn) {
        await printerCtx.connect();
        conn = printerCtx.connection;
      }
      if (!conn) {
        // user cancelled picker or other failure
        setPrinting(false);
        return;
      }
      const data = buildReceipt({
        header: business?.name || 'BKJ POS',
        subheader: business?.address || undefined,
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
        footer: business?.footer || 'Terima kasih!',
        paperWidthMm, // Sprint 19 — 58 or 80 from /pos/settings
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
      <div
        ref={receiptRef}
        className={`hidden print:block w-full mx-auto p-4 text-black ${
          paperWidthMm === 58 ? 'max-w-[14.5rem]' : 'max-w-xs'
        }`}
      >
        <div className="text-center font-bold text-lg">{business?.name || 'BKJ POS'}</div>
        {business?.address && (
          <div className="text-center text-[10px] text-zinc-500 mt-0.5">{business.address}</div>
        )}
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
        {(order?.taxCents ?? 0) > 0 && (
        <div className="text-sm flex justify-between">
          <span>Pajak</span>
          <span>{formatIDR(order?.taxCents ?? 0)}</span>
        </div>
        )}
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
        <div className="text-center text-xs">{business?.footer || 'Terima kasih!'}</div>
      </div>
    </div>
  );
}
