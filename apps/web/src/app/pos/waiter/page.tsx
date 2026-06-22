'use client';

// apps/web/src/app/pos/waiter/page.tsx
//
// Sprint 9.3 — Waiter Handheld (table-first order entry).
//
// Optimized for mobile / one-handed use on a phone. Two screens:
//
//   1. Floor view — a grid of table cards, color-coded by status
//      (AVAILABLE / OCCUPIED / RESERVED / CLEANING). Tap a card to drill in.
//   2. Session view — once a table is OPEN (or when a table already has an
//      open session), shows the order, lets the waiter add items from the
//      menu, and provides a "Tutup Meja" (close) action.
//
// All order-mutation calls reuse the existing /api/orders endpoint so we
// don't introduce a parallel order pipeline. The /api/tables/:id/open
// call creates a fresh OPEN Order for a fresh session.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import {
  api,
  ApiError,
  type RestaurantTable,
  type TableSession,
  type Order,
} from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { formatIDR } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<
  string,
  'success' | 'muted' | 'warning' | 'danger' | 'info' | 'default'
> = {
  AVAILABLE: 'success',
  OCCUPIED: 'warning',
  RESERVED: 'info',
  CLEANING: 'muted',
};

const STATUS_BG: Record<string, string> = {
  AVAILABLE: 'bg-emerald-900/40 border-emerald-700/60 hover:bg-emerald-900/60',
  OCCUPIED: 'bg-amber-900/40 border-amber-700/60 hover:bg-amber-900/60',
  RESERVED: 'bg-blue-900/40 border-blue-700/60 hover:bg-blue-900/60',
  CLEANING: 'bg-neutral-100 dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-700',
};

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: 'Kosong',
  OCCUPIED: 'Terisi',
  RESERVED: 'Dipesan',
  CLEANING: 'Dibersihkan',
};

function shortTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortDuration(fromIso: string): string {
  const ms = Date.now() - new Date(fromIso).getTime();
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}j ${m % 60}m`;
}

export default function WaiterPage() {
  return (
    <Suspense fallback={
      <div className="flex-1 p-6 text-neutral-500 dark:text-neutral-400 text-sm">Memuat…</div>
    }>
      <WaiterPageContent />
    </Suspense>
  );
}

function WaiterPageContent() {
  const { user } = useAuth();
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'CLEANING'>('ALL');
  const [activeTable, setActiveTable] = useState<RestaurantTable | null>(null);
  const [openDialog, setOpenDialog] = useState<RestaurantTable | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listTables();
      setTables(res.data || []);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal memuat meja');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Polling so the floor view stays fresh (waiter might sit at the table
  // for a few minutes — refresh every 15s).
  useEffect(() => {
    const id = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return tables;
    return tables.filter((t) => t.status === filter);
  }, [tables, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: tables.length, AVAILABLE: 0, OCCUPIED: 0, CLEANING: 0, RESERVED: 0 };
    for (const t of tables) c[t.status] = (c[t.status] || 0) + 1;
    return c;
  }, [tables]);

  async function handleOpenSubmit(payload: { partySize: number; serverUserId?: string; customerName?: string; notes?: string }) {
    if (!openDialog) return;
    try {
      const res = await api.openTable(openDialog.id, payload);
      toast.success(`Meja ${openDialog.number} dibuka`);
      setOpenDialog(null);
      setActiveTable(res.data.table);
      // The activeTable state now has the freshly created order; UI will
      // show the session view.
      void refresh();
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : e?.message || 'Gagal membuka meja';
      toast.error(msg);
    }
  }

  async function handleClose(table: RestaurantTable) {
    if (!window.confirm(`Tutup meja ${table.number}?`)) return;
    try {
      await api.closeTable(table.id);
      toast.success(`Meja ${table.number} ditutup`);
      setActiveTable(null);
      void refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Gagal menutup meja');
    }
  }

  if (!user) {
    return <div className="flex-1 p-6 text-neutral-500 dark:text-neutral-400 text-sm">Memuat sesi…</div>;
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="p-3 sm:p-4 max-w-3xl mx-auto w-full space-y-3 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Waiter Handheld</h1>
            <p className="text-xs text-neutral-500">
              Kelola meja &amp; buat pesanan. Tap meja untuk lihat detail.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="h-9 px-3 text-xs text-neutral-700 dark:text-neutral-300 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md hover:bg-neutral-100 dark:bg-neutral-800"
            aria-label="Refresh"
          >
            ↻ Refresh
          </button>
        </div>

        {/* Status filter chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1">
          {(['ALL', 'AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING'] as const).map((s) => {
            const active = filter === s;
            const n = counts[s] ?? 0;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                className={cn(
                  'h-9 px-3 text-xs rounded-md border shrink-0',
                  active
                    ? 'bg-red-600 text-neutral-900 dark:text-white border-red-600'
                    : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:bg-neutral-800',
                )}
              >
                {s === 'ALL' ? 'Semua' : STATUS_LABEL[s]} <span className="opacity-70">({n})</span>
              </button>
            );
          })}
        </div>

        {/* Table grid */}
        {loading ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400 py-8 text-center">Memuat meja…</div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent>
              <div className="text-sm text-neutral-500 dark:text-neutral-400 py-6 text-center">
                {tables.length === 0
                  ? 'Belum ada meja. Manager bisa menambahkannya dari menu pengaturan.'
                  : 'Tidak ada meja dengan status ini.'}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  if (t.status === 'AVAILABLE') {
                    setOpenDialog(t);
                  } else {
                    setActiveTable(t);
                  }
                }}
                className={cn(
                  'relative rounded-lg border p-3 text-left transition-colors min-h-[88px]',
                  STATUS_BG[t.status] ?? 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800',
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="text-base font-semibold text-neutral-900 dark:text-neutral-100">#{t.number}</div>
                  <Badge tone={STATUS_TONE[t.status] ?? 'default'} className="text-[10px]">
                    {STATUS_LABEL[t.status] ?? t.status}
                  </Badge>
                </div>
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">
                  {t.area ? `${t.area} · ` : ''}Kapasitas {t.capacity}
                </div>
                {t.currentSession ? (
                  <div className="text-[10px] text-neutral-500 mt-1">
                    {t.currentSession.partySize} org · {shortDuration(t.currentSession.openedAt)}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>

      {openDialog ? (
        <OpenTableDialog
          table={openDialog}
          onCancel={() => setOpenDialog(null)}
          onSubmit={handleOpenSubmit}
        />
      ) : null}

      {activeTable ? (
        <SessionSheet
          table={activeTable}
          onClose={() => {
            setActiveTable(null);
            void refresh();
          }}
          onCloseTable={() => handleClose(activeTable)}
          onUpdated={() => void refresh()}
        />
      ) : null}
    </div>
  );
}

// ─── Open table dialog ─────────────────────────────────────────────────────

function OpenTableDialog({
  table,
  onCancel,
  onSubmit,
}: {
  table: RestaurantTable;
  onCancel: () => void;
  onSubmit: (p: { partySize: number; serverUserId?: string; customerName?: string; notes?: string }) => void;
}) {
  const [partySize, setPartySize] = useState(2);
  const [customerName, setCustomerName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="fixed inset-0 z-40 bg-white dark:bg-black/60 flex items-end sm:items-center justify-center p-3">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg w-full max-w-md p-4 space-y-3">
        <div>
          <div className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Buka Meja #{table.number}</div>
          <div className="text-xs text-neutral-500">Kapasitas {table.capacity}</div>
        </div>
        <div>
          <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Jumlah tamu</label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPartySize((n) => Math.max(1, n - 1))}
              className="h-9 w-9 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-lg"
            >
              −
            </button>
            <input
              type="number"
              min={1}
              max={50}
              value={partySize}
              onChange={(e) => setPartySize(Math.max(1, Math.min(50, parseInt(e.target.value || '1', 10))))}
              className="h-9 w-16 text-center bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded border border-neutral-300 dark:border-neutral-700"
            />
            <button
              type="button"
              onClick={() => setPartySize((n) => Math.min(50, n + 1))}
              className="h-9 w-9 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-lg"
            >
              +
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Nama tamu (opsional)</label>
          <Input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="cth: Budi"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Catatan (opsional)</label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="cth: alergi seafood"
          />
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onCancel}>Batal</Button>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              try {
                onSubmit({
                  partySize,
                  customerName: customerName.trim() || undefined,
                  notes: notes.trim() || undefined,
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            Buka Meja
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Session sheet (bottom sheet on mobile) ────────────────────────────────

function SessionSheet({
  table,
  onClose,
  onCloseTable,
  onUpdated,
}: {
  table: RestaurantTable;
  onClose: () => void;
  onCloseTable: () => void;
  onUpdated: () => void;
}) {
  const [order, setOrder] = useState<Order | null>(table.currentOrder ?? null);
  const [busy, setBusy] = useState(false);
  const session = table.currentSession;

  const refreshOrder = useCallback(async () => {
    if (!table.currentOrder?.id) {
      setOrder(null);
      return;
    }
    try {
      const res = await api.getOrder(table.currentOrder.id);
      setOrder(res.data);
    } catch (e: any) {
      toast.error('Gagal memuat order: ' + (e?.message || 'unknown'));
    }
  }, [table.currentOrder?.id]);

  useEffect(() => {
    void refreshOrder();
  }, [refreshOrder]);

  if (!session) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 bg-white dark:bg-black/70 flex items-stretch sm:items-center sm:justify-center">
      <div className="bg-neutral-50 dark:bg-neutral-950 border-l border-neutral-200 dark:border-neutral-800 w-full sm:max-w-md sm:w-full flex flex-col h-full">
        {/* Header */}
        <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 flex items-start justify-between gap-2">
          <div>
            <div className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Meja #{table.number}</div>
            <div className="text-xs text-neutral-500">
              {session.partySize} tamu · buka {shortTime(session.openedAt)} ({shortDuration(session.openedAt)})
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
            aria-label="Tutup panel"
          >
            ✕
          </button>
        </div>

        {/* Order summary */}
        <div className="p-3 flex-1 overflow-y-auto">
          {order ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="text-xs text-neutral-500 dark:text-neutral-400">Order #{order.orderNumber}</div>
                <Badge tone="warning">OPEN</Badge>
              </div>
              {order.items.length === 0 ? (
                <div className="text-xs text-neutral-500 py-3">
                  Belum ada item. Buka halaman order untuk menambah pesanan.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {order.items.map((it) => (
                    <li
                      key={it.id}
                      className="flex items-center justify-between text-sm py-1.5 border-b border-neutral-900"
                    >
                      <span className="text-neutral-800 dark:text-neutral-200 truncate">
                        {it.quantity}× {it.nameSnapshot}
                        {it.notes ? (
                          <span className="text-[10px] text-neutral-500 ml-1">({it.notes})</span>
                        ) : null}
                      </span>
                      <span className="text-neutral-500 dark:text-neutral-400 ml-2 shrink-0">
                        {formatIDR(it.lineTotalCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center justify-between text-sm font-semibold pt-2 border-t border-neutral-200 dark:border-neutral-800">
                <span>Subtotal</span>
                <span className="text-neutral-700 dark:text-neutral-300">{formatIDR(order.subtotalCents)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                <span>PPN</span>
                <span>{formatIDR(order.taxCents)}</span>
              </div>
              <div className="flex items-center justify-between text-base font-semibold pt-1 border-t border-neutral-200 dark:border-neutral-800">
                <span>Total</span>
                <span className="text-red-400">{formatIDR(order.totalCents)}</span>
              </div>
            </div>
          ) : (
            <div className="text-xs text-neutral-500">Order belum dibuat (sesi tanpa order).</div>
          )}
        </div>

        {/* Actions */}
        <div className="p-3 border-t border-neutral-200 dark:border-neutral-800 space-y-2">
          {order ? (
            <Link
              href={`/pos/orders/${order.id}`}
              className="block w-full h-11 text-sm font-semibold bg-red-600 text-neutral-900 dark:text-white rounded-md hover:bg-red-500 inline-flex items-center justify-center"
            >
              ➕ Tambah Item / Bayar
            </Link>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                onUpdated();
                void refreshOrder();
              }}
              className="h-10 text-sm bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-700"
            >
              ↻ Refresh
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onCloseTable}
              className="h-10 text-sm bg-amber-600 text-neutral-900 dark:text-white rounded-md hover:bg-amber-500 disabled:opacity-50"
            >
              Tutup Meja
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
