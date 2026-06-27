'use client';

// Sprint 21 — Purchase Report (aggregate view by date range).
//
// Shows:
//   - Total PO count + total spend in the period
//   - Breakdown by status (DRAFT / SENT / PARTIAL / RECEIVED / CANCELLED)
//   - Breakdown by supplier (sorted by total spend desc)
//   - Recent 20 POs

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatIDR } from '@/lib/format';
import { toast } from 'sonner';

interface PurchaseReport {
  from: string;
  to: string;
  totalPos: number;
  totalCents: number;
  byStatus: Record<string, { count: number; totalCents: number }>;
  bySupplier: Array<{
    supplierId: string;
    supplierName: string;
    count: number;
    totalCents: number;
  }>;
  recent: Array<{
    id: string;
    poNumber: string;
    status: string;
    supplierName: string;
    totalCents: number;
    createdAt: string;
    receivedAt: string | null;
  }>;
}

const STATUS_TONE: Record<string, 'muted' | 'info' | 'warning' | 'success' | 'danger' | 'default'> = {
  DRAFT: 'muted',
  SENT: 'info',
  PARTIAL: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'danger',
};

function todayISO(): string { return new Date().toISOString().slice(0, 10); }
function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function PurchaseReportPage() {
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [data, setData] = useState<PurchaseReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/purchase-orders/report?from=${from}&to=${to}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const body = await res.json();
      setData(body.data ?? null);
    } catch (e) {
      console.error('purchase report load failed', e);
      toast.error((e as Error).message || 'Gagal memuat laporan');
    } finally {
      setLoading(false);
    }
  }

  function setPreset(days: number) {
    setFrom(daysAgoISO(days));
    setTo(todayISO());
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 max-w-5xl mx-auto w-full space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold">Purchase Report</h1>
        <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
          Rekap pembelian dalam rentang tanggal
        </p>
      </div>

      {/* Date range picker */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col">
            <label className="text-[10px] uppercase text-neutral-500 mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] uppercase text-neutral-500 mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => setPreset(6)}>7 hari</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset(29)}>30 hari</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset(89)}>90 hari</Button>
          </div>
          <Button size="sm" variant="primary" onClick={load} disabled={loading}>
            {loading ? 'Memuat…' : 'Terapkan'}
          </Button>
        </CardContent>
      </Card>

      {data && (
        <>
          {/* Top tiles */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
              <div className="text-[10px] uppercase tracking-wide text-neutral-500">Total PO</div>
              <div className="text-2xl font-semibold tabular-nums mt-0.5">{data.totalPos}</div>
            </div>
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
              <div className="text-[10px] uppercase tracking-wide text-neutral-500">Total Spend</div>
              <div className="text-2xl font-semibold tabular-nums mt-0.5">
                {formatIDR(data.totalCents)}
              </div>
            </div>
          </div>

          {/* By status */}
          {Object.keys(data.byStatus).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>By Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {Object.entries(data.byStatus).map(([status, v]) => (
                    <div
                      key={status}
                      className="rounded-md border border-neutral-200 dark:border-neutral-800 p-2"
                    >
                      <Badge tone={STATUS_TONE[status] ?? 'muted'}>{status}</Badge>
                      <div className="text-lg font-semibold tabular-nums mt-1">{v.count}</div>
                      <div className="text-[10px] text-neutral-500">{formatIDR(v.totalCents)}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* By supplier */}
          {data.bySupplier.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>By Supplier</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase text-neutral-500 border-b border-neutral-200 dark:border-neutral-800">
                        <th className="text-left py-2 pr-3">Supplier</th>
                        <th className="text-right py-2 pr-3">PO Count</th>
                        <th className="text-right py-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.bySupplier.map((s) => (
                        <tr key={s.supplierId} className="border-b border-neutral-200 dark:border-neutral-800">
                          <td className="py-2 pr-3 font-medium">{s.supplierName}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{s.count}</td>
                          <td className="py-2 text-right tabular-nums font-semibold">
                            {formatIDR(s.totalCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent POs */}
          {data.recent.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recent POs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase text-neutral-500 border-b border-neutral-200 dark:border-neutral-800">
                        <th className="text-left py-2 pr-3">PO #</th>
                        <th className="text-left py-2 pr-3">Supplier</th>
                        <th className="text-left py-2 pr-3">Status</th>
                        <th className="text-left py-2 pr-3">Created</th>
                        <th className="text-right py-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent.map((p) => (
                        <tr key={p.id} className="border-b border-neutral-200 dark:border-neutral-800">
                          <td className="py-2 pr-3 font-mono text-xs">{p.poNumber}</td>
                          <td className="py-2 pr-3">{p.supplierName}</td>
                          <td className="py-2 pr-3">
                            <Badge tone={STATUS_TONE[p.status] ?? 'muted'}>{p.status}</Badge>
                          </td>
                          <td className="py-2 pr-3 text-xs text-neutral-500">
                            {new Date(p.createdAt).toLocaleDateString('id-ID')}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {formatIDR(p.totalCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {data.totalPos === 0 && (
            <Card>
              <CardContent>
                <div className="text-sm text-neutral-500 py-4 text-center">
                  Tidak ada purchase order dalam rentang ini.
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
