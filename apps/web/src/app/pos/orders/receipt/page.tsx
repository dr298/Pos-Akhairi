'use client';

// Sprint 21 — Receipt Delivery Log
// /pos/orders/receipt shows all receipt delivery attempts (WHATSAPP /
// EMAIL / PRINT) across all orders, newest first. Manager/Owner only.
// Inspired by Odoo's "Sales > Receipts" overview.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatIDR } from '@/lib/format';
import { cn } from '@/lib/utils';

type DeliveryChannel = 'WHATSAPP' | 'EMAIL' | 'PRINT';
type DeliveryStatus = 'PENDING' | 'SENT' | 'FAILED';

interface ReceiptLogRow {
  id: string;
  orderId: string;
  channel: DeliveryChannel;
  target: string;
  status: DeliveryStatus;
  sentAt: string | null;
  failureReason: string | null;
  createdAt: string;
  order?: {
    id: string;
    orderNumber: string;
    status: string;
    totalCents: number;
    openedAt: string;
  } | null;
}

const CHANNEL_LABEL: Record<DeliveryChannel, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
  PRINT: 'Cetak',
};

const CHANNEL_TONE: Record<DeliveryChannel, 'success' | 'info' | 'muted' | 'default'> = {
  WHATSAPP: 'success',
  EMAIL: 'info',
  PRINT: 'muted',
};

const STATUS_TONE: Record<DeliveryStatus, 'success' | 'warning' | 'danger' | 'muted'> = {
  PENDING: 'warning',
  SENT: 'success',
  FAILED: 'danger',
};

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  PENDING: 'Tertunda',
  SENT: 'Terkirim',
  FAILED: 'Gagal',
};

export default function ReceiptLogPage() {
  const [rows, setRows] = useState<ReceiptLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState<DeliveryChannel | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<DeliveryStatus | 'ALL'>('ALL');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/receipts?limit=200', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRows((json.data ?? []) as ReceiptLogRow[]);
    } catch (e) {
      console.error('receipt log load failed', e);
    } finally {
      setLoading(false);
    }
  }

  const filtered = rows.filter((r) => {
    if (channelFilter !== 'ALL' && r.channel !== channelFilter) return false;
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    return true;
  });

  // Summary
  const counts = {
    total: rows.length,
    sent: rows.filter((r) => r.status === 'SENT').length,
    failed: rows.filter((r) => r.status === 'FAILED').length,
    pending: rows.filter((r) => r.status === 'PENDING').length,
  };

  return (
    <div className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Receipt Log</h1>
          <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
            Riwayat pengiriman struk ke pelanggan
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? 'Memuat…' : 'Refresh'}
        </Button>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">Total</div>
          <div className="text-2xl font-semibold tabular-nums mt-0.5">{counts.total}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">Terkirim</div>
          <div className="text-2xl font-semibold tabular-nums mt-0.5 text-emerald-500">{counts.sent}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">Tertunda</div>
          <div className="text-2xl font-semibold tabular-nums mt-0.5 text-amber-500">{counts.pending}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">Gagal</div>
          <div className="text-2xl font-semibold tabular-nums mt-0.5 text-red-500">{counts.failed}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterGroup
          label="Channel"
          value={channelFilter}
          onChange={(v) => setChannelFilter(v as DeliveryChannel | 'ALL')}
          options={[
            { value: 'ALL', label: 'Semua' },
            { value: 'WHATSAPP', label: 'WhatsApp' },
            { value: 'EMAIL', label: 'Email' },
            { value: 'PRINT', label: 'Cetak' },
          ]}
        />
        <FilterGroup
          label="Status"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as DeliveryStatus | 'ALL')}
          options={[
            { value: 'ALL', label: 'Semua' },
            { value: 'SENT', label: 'Terkirim' },
            { value: 'PENDING', label: 'Tertunda' },
            { value: 'FAILED', label: 'Gagal' },
          ]}
        />
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Delivery Attempts</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-neutral-500 py-4 text-center">Memuat…</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-neutral-500 py-4 text-center">
              {rows.length === 0 ? 'Belum ada pengiriman struk.' : 'Tidak ada hasil untuk filter ini.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase text-neutral-500 border-b border-neutral-200 dark:border-neutral-800">
                    <th className="text-left py-2 pr-3">Order</th>
                    <th className="text-left py-2 pr-3">Channel</th>
                    <th className="text-left py-2 pr-3">Target</th>
                    <th className="text-left py-2 pr-3">Status</th>
                    <th className="text-left py-2 pr-3">Waktu</th>
                    <th className="text-right py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                    >
                      <td className="py-2 pr-3 font-mono text-xs">
                        {r.order ? (
                          <Link
                            href={`/pos/orders/${r.order.id}`}
                            className="text-red-500 hover:underline"
                          >
                            {r.order.orderNumber}
                          </Link>
                        ) : (
                          <span className="text-neutral-500">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={CHANNEL_TONE[r.channel]}>{CHANNEL_LABEL[r.channel]}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-xs text-neutral-600 dark:text-neutral-300 max-w-[200px] truncate">
                        {r.target || <span className="text-neutral-400">—</span>}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                        {r.failureReason && (
                          <div className="text-[10px] text-red-500 mt-0.5 max-w-[200px] truncate">
                            {r.failureReason}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs text-neutral-500">
                        {r.sentAt
                          ? new Date(r.sentAt).toLocaleString('id-ID')
                          : new Date(r.createdAt).toLocaleString('id-ID')}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {r.order ? formatIDR(r.order.totalCents) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-neutral-500">{label}:</span>
      <div className="inline-flex rounded-md border border-neutral-200 dark:border-neutral-800 overflow-hidden">
        {options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'px-2.5 py-1 text-xs',
              i > 0 && 'border-l border-neutral-200 dark:border-neutral-800',
              value === o.value
                ? 'bg-red-600 text-white'
                : 'bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
