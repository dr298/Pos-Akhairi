'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError, type Shift } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@/components/ui/Dialog';
import { formatIDR } from '@/lib/format';

type ShiftWithDetails = Shift & {
  orders?: Array<{
    id: string;
    orderNumber: string;
    status: string;
    type: string;
    totalCents: number;
    openedAt: string;
    closedAt: string | null;
    items: Array<{ id: string; name: string; quantity: number; totalCents: number }>;
    payments: Array<{ id: string; method: string; amountCents: number; createdAt: string }>;
  }>;
};

const STATUS_OPTIONS: Array<{ value: ''; label: 'Semua' } | { value: 'OPEN' | 'CLOSED'; label: 'Buka' | 'Tutup' }> = [
  { value: '', label: 'Semua' },
  { value: 'OPEN', label: 'Buka' },
  { value: 'CLOSED', label: 'Tutup' },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
function durationMin(open: string, close: string | null | undefined): number {
  if (!close) return 0;
  return Math.max(0, Math.round((new Date(close).getTime() - new Date(open).getTime()) / 60000));
}
function durLabel(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}j ${m}m` : `${h}j`;
}

export default function ShiftHistoryPage() {
  const { user } = useAuth();
  const isCashier = user?.role === 'CASHIER';

  // Filters
  const [from, setFrom] = useState(daysAgoISO(7));
  const [to, setTo] = useState(todayISO());
  const [status, setStatus] = useState<'' | 'OPEN' | 'CLOSED'>('');

  // Data
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detail
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ShiftWithDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listShifts({
        from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
        status: status || undefined,
      });
      setShifts(res.data ?? []);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message || 'Gagal memuat data';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [from, to, status]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Filter cashier view to own shifts only
  const visibleShifts = useMemo(() => {
    if (isCashier && user) {
      return shifts.filter((s) => s.userId === user.id);
    }
    return shifts;
  }, [shifts, isCashier, user]);

  // Summary stats
  const stats = useMemo(() => {
    const closed = visibleShifts.filter((s) => s.status === 'CLOSED');
    const open = visibleShifts.filter((s) => s.status === 'OPEN');
    const totalVariance = closed.reduce((acc, s) => acc + (s.varianceCents ?? 0), 0);
    const totalRevenue = closed.reduce((acc, s) => {
      // We don't have order count here — would need /api/shifts/:id
      // Skip; use opening/closing totals as proxy
      return acc + ((s.closingCents ?? 0) - (s.openingCents ?? 0));
    }, 0);
    return { closed: closed.length, open: open.length, totalVariance, totalRevenue };
  }, [visibleShifts]);

  async function openDetail(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await api.getShift(id);
      setDetail(res.data);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Gagal memuat detail shift';
      toast.error(msg);
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
  }

  function quickRange(days: number) {
    setFrom(daysAgoISO(days));
    setTo(todayISO());
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 max-w-6xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Histori Sesi Kasir</h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            Daftar sesi buka/tutup shift kasir. Klik baris untuk lihat detail.
          </p>
        </div>
        <div className="flex gap-1.5 text-xs">
          <Button size="sm" variant="ghost" onClick={() => quickRange(0)}>Hari ini</Button>
          <Button size="sm" variant="ghost" onClick={() => quickRange(7)}>7 hari</Button>
          <Button size="sm" variant="ghost" onClick={() => quickRange(30)}>30 hari</Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">Total sesi</div>
          <div className="text-lg font-semibold tabular-nums mt-0.5">{visibleShifts.length}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">Tutup</div>
          <div className="text-lg font-semibold tabular-nums mt-0.5 text-emerald-400">{stats.closed}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">Masih buka</div>
          <div className="text-lg font-semibold tabular-nums mt-0.5 text-amber-400">{stats.open}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">Total selisih kas</div>
          <div
            className={`text-lg font-semibold tabular-nums mt-0.5 ${
              stats.totalVariance === 0
                ? 'text-neutral-800 dark:text-neutral-200'
                : stats.totalVariance > 0
                ? 'text-emerald-400'
                : 'text-red-400'
            }`}
          >
            {stats.totalVariance === 0
              ? 'Selaras'
              : `${stats.totalVariance > 0 ? '+' : ''}${formatIDR(stats.totalVariance)}`}
          </div>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block" htmlFor="from">Dari</label>
              <Input
                id="from"
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block" htmlFor="to">Sampai</label>
              <Input
                id="to"
                type="date"
                value={to}
                min={from}
                max={todayISO()}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block" htmlFor="status">Status</label>
              <select
                id="status"
                value={status}
                onChange={(e) => setStatus(e.target.value as '' | 'OPEN' | 'CLOSED')}
                className="w-full h-9 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm text-neutral-900 dark:text-neutral-100 px-2"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <Button size="sm" onClick={refresh} disabled={loading}>
              {loading ? 'Memuat…' : 'Refresh'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* List */}
      <Card>
        <CardHeader>
          <CardTitle>Sesi shift</CardTitle>
          <CardDescription>
            {isCashier ? 'Hanya sesi shift milik Anda.' : 'Semua sesi shift di cabang ini.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
              {error}
            </div>
          )}
          {loading ? (
            <div className="py-12 text-center text-sm text-neutral-500">Memuat sesi shift…</div>
          ) : visibleShifts.length === 0 ? (
            <div className="py-12 text-center text-sm text-neutral-500">
              Tidak ada sesi shift pada rentang tanggal ini.
            </div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-neutral-500 border-b border-neutral-200 dark:border-neutral-800">
                    <th className="px-3 py-2 font-medium">Kasir</th>
                    <th className="px-3 py-2 font-medium">Buka</th>
                    <th className="px-3 py-2 font-medium">Tutup</th>
                    <th className="px-3 py-2 font-medium text-right">Modal</th>
                    <th className="px-3 py-2 font-medium text-right">Kas akhir</th>
                    <th className="px-3 py-2 font-medium text-right">Selisih</th>
                    <th className="px-3 py-2 font-medium text-right">Durasi</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleShifts.map((s) => {
                    const dur = durationMin(s.openedAt, s.closedAt);
                    const v = s.varianceCents ?? 0;
                    return (
                      <tr
                        key={s.id}
                        onClick={() => openDetail(s.id)}
                        className="border-b border-neutral-200 dark:border-neutral-800/60 hover:bg-neutral-100 dark:bg-neutral-800/40 cursor-pointer"
                      >
                        <td className="px-3 py-2 text-neutral-800 dark:text-neutral-200">
                          <div className="font-medium">{s.user?.name ?? s.userId.slice(0, 8)}</div>
                          <div className="text-[10px] text-neutral-500">{s.user?.email}</div>
                        </td>
                        <td className="px-3 py-2 text-neutral-700 dark:text-neutral-300 whitespace-nowrap">{fmtDateTime(s.openedAt)}</td>
                        <td className="px-3 py-2 text-neutral-700 dark:text-neutral-300 whitespace-nowrap">
                          {s.closedAt ? fmtDateTime(s.closedAt) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                          {formatIDR(s.openingCents)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                          {s.closingCents != null ? formatIDR(s.closingCents) : '—'}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums font-medium ${
                            s.status === 'OPEN'
                              ? 'text-neutral-500'
                              : v === 0
                              ? 'text-neutral-700 dark:text-neutral-300'
                              : v > 0
                              ? 'text-emerald-400'
                              : 'text-red-400'
                          }`}
                        >
                          {s.status === 'OPEN'
                            ? '—'
                            : v === 0
                            ? 'Selaras'
                            : `${v > 0 ? '+' : ''}${formatIDR(v)}`}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                          {s.closedAt ? durLabel(dur) : '…'}
                        </td>
                        <td className="px-3 py-2">
                          {s.status === 'OPEN' ? (
                            <Badge tone="warning">Buka</Badge>
                          ) : (
                            <Badge tone="muted">Tutup</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!selectedId} onOpenChange={(v) => !v && closeDetail()}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div>
              <DialogTitle>Detail Sesi Shift</DialogTitle>
              {detail && (
                <CardDescription>
                  {detail.user?.name ?? detail.userId.slice(0, 8)} · {fmtDate(detail.openedAt)}
                </CardDescription>
              )}
            </div>
            <DialogClose />
          </DialogHeader>
          <DialogBody className="overflow-y-auto flex-1">
            {detailLoading ? (
              <div className="py-8 text-center text-sm text-neutral-500">Memuat detail…</div>
            ) : detail ? (
              <div className="space-y-4">
                {/* Summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-2.5">
                    <div className="text-[10px] uppercase tracking-wide text-neutral-500">Modal</div>
                    <div className="text-sm font-semibold tabular-nums mt-0.5">{formatIDR(detail.openingCents)}</div>
                  </div>
                  <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-2.5">
                    <div className="text-[10px] uppercase tracking-wide text-neutral-500">Kas akhir</div>
                    <div className="text-sm font-semibold tabular-nums mt-0.5">
                      {detail.closingCents != null ? formatIDR(detail.closingCents) : '—'}
                    </div>
                  </div>
                  <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-2.5">
                    <div className="text-[10px] uppercase tracking-wide text-neutral-500">Ekspektasi</div>
                    <div className="text-sm font-semibold tabular-nums mt-0.5">
                      {detail.expectedCents != null ? formatIDR(detail.expectedCents) : '—'}
                    </div>
                  </div>
                  <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-2.5">
                    <div className="text-[10px] uppercase tracking-wide text-neutral-500">Selisih</div>
                    <div
                      className={`text-sm font-semibold tabular-nums mt-0.5 ${
                        (detail.varianceCents ?? 0) === 0
                          ? 'text-neutral-800 dark:text-neutral-200'
                          : (detail.varianceCents ?? 0) > 0
                          ? 'text-emerald-400'
                          : 'text-red-400'
                      }`}
                    >
                      {detail.varianceCents == null
                        ? '—'
                        : detail.varianceCents === 0
                        ? 'Selaras'
                        : `${detail.varianceCents > 0 ? '+' : ''}${formatIDR(detail.varianceCents)}`}
                    </div>
                  </div>
                </div>

                {/* Time + status */}
                <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-neutral-500 dark:text-neutral-400">Dibuka</span>
                    <span className="text-neutral-800 dark:text-neutral-200">{fmtDateTime(detail.openedAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500 dark:text-neutral-400">Ditutup</span>
                    <span className="text-neutral-800 dark:text-neutral-200">{detail.closedAt ? fmtDateTime(detail.closedAt) : '— (masih buka)'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500 dark:text-neutral-400">Durasi</span>
                    <span className="text-neutral-800 dark:text-neutral-200">
                      {detail.closedAt
                        ? durLabel(durationMin(detail.openedAt, detail.closedAt))
                        : '—'}
                    </span>
                  </div>
                  {detail.notes && (
                    <div className="flex justify-between gap-3 pt-1 border-t border-neutral-200 dark:border-neutral-800">
                      <span className="text-neutral-500 dark:text-neutral-400">Catatan</span>
                      <span className="text-neutral-800 dark:text-neutral-200 text-right">{detail.notes}</span>
                    </div>
                  )}
                </div>

                {/* Orders */}
                <div>
                  <div className="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                    Order ({detail.orders?.length ?? 0})
                  </div>
                  {!detail.orders || detail.orders.length === 0 ? (
                    <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 text-xs text-neutral-500 text-center">
                      Belum ada order pada sesi ini.
                    </div>
                  ) : (
                    <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
                      <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-[10px] uppercase tracking-wide text-neutral-500 border-b border-neutral-200 dark:border-neutral-800">
                            <th className="px-2 py-1.5 font-medium">No</th>
                            <th className="px-2 py-1.5 font-medium">Tipe</th>
                            <th className="px-2 py-1.5 font-medium">Status</th>
                            <th className="px-2 py-1.5 font-medium">Item</th>
                            <th className="px-2 py-1.5 font-medium text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.orders.map((o) => (
                            <tr key={o.id} className="border-b border-neutral-200 dark:border-neutral-800/40 last:border-0">
                              <td className="px-2 py-1.5 text-neutral-800 dark:text-neutral-200 font-medium">{o.orderNumber}</td>
                              <td className="px-2 py-1.5 text-neutral-500 dark:text-neutral-400">{o.type}</td>
                              <td className="px-2 py-1.5">
                                <Badge tone={o.status === 'PAID' ? 'success' : o.status === 'VOIDED' ? 'danger' : 'muted'}>
                                  {o.status}
                                </Badge>
                              </td>
                              <td className="px-2 py-1.5 text-neutral-500 dark:text-neutral-400">
                                {o.items?.length ?? 0} item
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-neutral-800 dark:text-neutral-200">
                                {formatIDR(o.totalCents)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-red-400">Gagal memuat detail.</div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={closeDetail}>Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
