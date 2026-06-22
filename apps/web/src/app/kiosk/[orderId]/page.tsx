'use client';

// apps/web/src/app/kiosk/[orderId]/page.tsx
//
// Sprint 9.1 — Kiosk order status tracker.
//
// Public (no auth), polls every 5s. Shows the customer the live
// status of their kiosk order so they can wait nearby. Status flow:
//   OPEN          — order created at kiosk, cashier hasn't started
//   SENT_TO_KDS   — cashier sent to kitchen
//   IN_PROGRESS   — kitchen is cooking
//   READY         — ready for pickup
//   SERVED        — served to customer
//   PAID          — paid
//   CANCELLED     — cancelled
//   VOIDED / REFUNDED

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface KioskOrderStatus {
  id: string;
  orderNumber: string;
  status: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  openedAt: string;
  closedAt: string | null;
  items: Array<{ id: string; nameSnapshot: string; quantity: number; lineTotalCents: number }>;
}

const POLL_MS = 5000;

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Menunggu Kasir',
  SENT_TO_KDS: 'Diteruskan ke Dapur',
  IN_PROGRESS: 'Sedang Dimasak',
  READY: 'Siap Disajikan',
  SERVED: 'Sudah Disajikan',
  PAID: 'Selesai',
  CANCELLED: 'Dibatalkan',
  VOIDED: 'Dibatalkan',
  REFUNDED: 'Dikembalikan',
};

const STATUS_TONE: Record<string, string> = {
  OPEN: 'bg-amber-500/15 text-amber-300 border-amber-700/50',
  SENT_TO_KDS: 'bg-blue-500/15 text-blue-300 border-blue-700/50',
  IN_PROGRESS: 'bg-orange-500/15 text-orange-300 border-orange-700/50',
  READY: 'bg-emerald-500/20 text-emerald-300 border-emerald-700/50',
  SERVED: 'bg-emerald-500/20 text-emerald-300 border-emerald-700/50',
  PAID: 'bg-emerald-500/20 text-emerald-300 border-emerald-700/50',
  CANCELLED: 'bg-rose-500/20 text-rose-300 border-rose-700/50',
  VOIDED: 'bg-rose-500/20 text-rose-300 border-rose-700/50',
  REFUNDED: 'bg-rose-500/20 text-rose-300 border-rose-700/50',
};

function formatIDR(cents: number): string {
  return 'Rp ' + (cents / 100).toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

export default function KioskOrderStatusPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center text-neutral-500 dark:text-neutral-400 text-lg">
        Memuat…
      </main>
    }>
      <KioskOrderStatusContent />
    </Suspense>
  );
}

function KioskOrderStatusContent() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params?.orderId ?? '';
  const [order, setOrder] = useState<KioskOrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!orderId) return;
    try {
      const r = await fetch(
        `/api/kiosk/order/${encodeURIComponent(orderId)}`,
        { credentials: 'include' },
      );
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setError(data.message || 'Pesanan tidak ditemukan');
        return;
      }
      const data = await r.json();
      setOrder(data.data);
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'Gagal memuat pesanan');
    }
  }, [orderId]);

  useEffect(() => {
    setNow(new Date());
    void load();
    timerRef.current = setInterval(() => {
      setNow(new Date());
      void load();
    }, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load]);

  if (error && !order) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <div className="text-6xl mb-3">⚠️</div>
          <p className="text-lg text-neutral-700 dark:text-neutral-300">{error}</p>
          <button
            type="button"
            onClick={() => router.push('/kiosk')}
            className="mt-6 h-12 px-6 rounded-xl bg-red-600 hover:bg-red-500 text-neutral-900 dark:text-white font-semibold"
          >
            Kembali ke Menu
          </button>
        </div>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="min-h-screen flex items-center justify-center text-neutral-500 dark:text-neutral-400 text-lg">
        Memuat pesanan…
      </main>
    );
  }

  const isReady = order.status === 'READY' || order.status === 'SERVED' || order.status === 'PAID';
  const isClosed = order.status === 'CANCELLED' || order.status === 'VOIDED' || order.status === 'REFUNDED';

  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 p-4 sm:p-6 flex flex-col">
      <header className="max-w-xl w-full mx-auto">
        <button
          type="button"
          onClick={() => router.push('/kiosk')}
          className="h-10 px-4 rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-sm"
        >
          ← Menu Utama
        </button>
        <div className="mt-4 text-center">
          <div className="text-sm text-neutral-500">Nomor Pesanan</div>
          <div className="text-5xl sm:text-6xl font-bold tracking-widest text-red-500 mt-1">
            {order.orderNumber}
          </div>
        </div>
        <div className="mt-4 flex justify-center">
          <span
            className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold border ${
              STATUS_TONE[order.status] ?? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-neutral-300 dark:border-neutral-700'
            }`}
          >
            {STATUS_LABEL[order.status] ?? order.status}
          </span>
        </div>
        {isReady ? (
          <div className="mt-4 mx-auto max-w-md bg-emerald-500/10 border border-emerald-700/50 rounded-2xl p-4 text-center">
            <div className="text-3xl">🎉</div>
            <div className="font-semibold text-emerald-300 mt-1">
              Pesanan Anda sudah siap!
            </div>
            <div className="text-xs text-emerald-200/70 mt-1">
              Silakan ambil di konter / sesuai instruksi kasir
            </div>
          </div>
        ) : isClosed ? (
          <div className="mt-4 mx-auto max-w-md bg-rose-500/10 border border-rose-700/50 rounded-2xl p-4 text-center">
            <div className="font-semibold text-rose-300">Pesanan ditutup</div>
            <div className="text-xs text-rose-200/70 mt-1">
              Hubungi kasir jika ada pertanyaan
            </div>
          </div>
        ) : null}
      </header>

      <section className="max-w-xl w-full mx-auto mt-6 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-4">
        <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 mb-2">Detail Pesanan</h2>
        <ul className="divide-y divide-neutral-800">
          {order.items.map((it) => (
            <li key={it.id} className="py-2 flex justify-between gap-3">
              <span className="min-w-0">
                <span className="text-neutral-500 mr-1">{it.quantity}×</span>
                {it.nameSnapshot}
              </span>
              <span className="text-neutral-700 dark:text-neutral-300 whitespace-nowrap">
                {formatIDR(it.lineTotalCents)}
              </span>
            </li>
          ))}
        </ul>
        <div className="border-t border-neutral-200 dark:border-neutral-800 mt-2 pt-3 space-y-1 text-sm">
          <div className="flex justify-between text-neutral-500 dark:text-neutral-400">
            <span>Subtotal</span>
            <span>{formatIDR(order.subtotalCents)}</span>
          </div>
          {order.taxCents > 0 ? (
            <div className="flex justify-between text-neutral-500 dark:text-neutral-400">
              <span>PPN</span>
              <span>{formatIDR(order.taxCents)}</span>
            </div>
          ) : null}
          <div className="flex justify-between font-bold text-lg pt-1">
            <span>Total</span>
            <span className="text-red-500">{formatIDR(order.totalCents)}</span>
          </div>
        </div>
      </section>

      <footer className="max-w-xl w-full mx-auto mt-6 text-center text-xs text-neutral-500">
        Status diperbarui otomatis setiap {POLL_MS / 1000} detik ·{' '}
        {now ? `terakhir cek ${now.toLocaleTimeString('id-ID')}` : ''}
      </footer>
    </main>
  );
}
