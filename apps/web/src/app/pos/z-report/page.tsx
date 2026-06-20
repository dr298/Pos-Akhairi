'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/hooks/useAuth';
import { formatIDR } from '@/lib/format';

interface ZReport {
  date: string;
  branchId: string;
  branch: { id: string; code: string; name: string; city: string; timezone: string } | null;
  summary: {
    grossCents: number;
    discountCents: number;
    taxCents: number;
    netCents: number;
    paidOrders: number;
    voidedOrders: number;
    voidedCents: number;
    refundedOrders: number;
    refundedCents: number;
    avgTicketCents: number;
  };
  paymentBreakdown: Record<string, { count: number; amountCents: number }>;
  orderTypeBreakdown: Record<string, { count: number; revenueCents: number }>;
  channelBreakdown: Record<string, { count: number; revenueCents: number }>;
  topItems: Array<{ menuItemId: string; name: string; qty: number; revenueCents: number }>;
  categoryBreakdown: Array<{ categoryId: string; name: string; qty: number; revenueCents: number }>;
  hourly: Array<{ hour: number; orders: number; revenueCents: number }>;
  shiftReconciliation: Array<{
    shiftId: string;
    cashier: string;
    openedAt: string;
    closedAt: string | null;
    status: string;
    openingCents: number;
    closingCents: number | null;
    expectedCents: number | null;
    varianceCents: number | null;
  }>;
  voidRefundLog: Array<{
    orderId: string;
    orderNumber: string;
    status: string;
    totalCents: number;
    occurredAt: string | null;
  }>;
  dailyClose: { status: string; grossCents: number; netCents: number; closedAt: string } | null;
  generatedAt: string;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-neutral-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function breakEntries(obj: Record<string, { count: number; amountCents?: number; revenueCents?: number }>) {
  return Object.entries(obj)
    .filter(([k]) => k)
    .map(([k, v]) => ({ key: k, ...v }))
    .sort((a, b) => (b.amountCents ?? b.revenueCents ?? 0) - (a.amountCents ?? a.revenueCents ?? 0));
}

export default function ZReportPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [report, setReport] = useState<ZReport | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
      router.replace('/pos');
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, router, date]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // api.getZReport not yet typed — call fetch directly
      const res = await fetch(`/api/reports/z-report?date=${date}`, { credentials: 'include' });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }
      const json = await res.json();
      setReport(json.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    window.open(`/api/reports/z-report/export.csv?date=${date}`, '_blank');
  }

  if (!user) return null;

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-4 max-w-screen-2xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Z-Report</h1>
          <p className="text-xs sm:text-sm text-neutral-400">
            {report?.branch?.name ?? user.branch?.name ?? 'Branch'} ·{' '}
            {report?.branch?.city ?? user.branch?.city ?? ''} ·{' '}
            <span className="text-neutral-500">generated {report ? new Date(report.generatedAt).toLocaleString('id-ID') : '—'}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm text-neutral-100"
          />
          <button
            type="button"
            onClick={load}
            className="bg-neutral-800 hover:bg-neutral-700 text-neutral-100 text-sm rounded px-3 py-1"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="bg-red-600 hover:bg-red-700 text-white text-sm rounded px-3 py-1"
          >
            Export CSV
          </button>
        </div>
      </header>

      {loading && <div className="text-neutral-400 text-sm">Memuat…</div>}
      {error && <div className="text-red-400 text-sm">Error: {error}</div>}

      {report && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
            <Stat label="Gross" value={formatIDR(report.summary.grossCents)} sub={`${report.summary.paidOrders} orders`} />
            <Stat label="Discount" value={formatIDR(report.summary.discountCents)} sub="-" />
            <Stat label="Tax (PPN)" value={formatIDR(report.summary.taxCents)} />
            <Stat label="Net Sales" value={formatIDR(report.summary.netCents)} sub={`Avg ticket ${formatIDR(report.summary.avgTicketCents)}`} />
            <Stat label="Void" value={`${report.summary.voidedOrders}`} sub={formatIDR(report.summary.voidedCents)} />
            <Stat label="Refund" value={`${report.summary.refundedOrders}`} sub={formatIDR(report.summary.refundedCents)} />
            <Stat
              label="Daily Close"
              value={report.dailyClose ? report.dailyClose.status : '—'}
              sub={report.dailyClose ? formatIDR(report.dailyClose.netCents) : 'belum ditutup'}
            />
            <Stat label="Date" value={report.date} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
            {/* Payment breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Payment Methods</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase text-neutral-500">
                    <tr>
                      <th className="text-left">Method</th>
                      <th className="text-right">Count</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakEntries(report.paymentBreakdown).map((p) => (
                      <tr key={p.key} className="border-t border-neutral-800">
                        <td className="py-1.5">{p.key}</td>
                        <td className="text-right tabular-nums">{p.count}</td>
                        <td className="text-right tabular-nums">{formatIDR(p.amountCents ?? 0)}</td>
                      </tr>
                    ))}
                    {Object.keys(report.paymentBreakdown).length === 0 && (
                      <tr><td colSpan={3} className="text-center text-neutral-500 py-2">—</td></tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Order type breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Order Types</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase text-neutral-500">
                    <tr>
                      <th className="text-left">Type</th>
                      <th className="text-right">Count</th>
                      <th className="text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakEntries(report.orderTypeBreakdown).map((p) => (
                      <tr key={p.key} className="border-t border-neutral-800">
                        <td className="py-1.5">{p.key}</td>
                        <td className="text-right tabular-nums">{p.count}</td>
                        <td className="text-right tabular-nums">{formatIDR(p.revenueCents ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Channel breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Channels</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase text-neutral-500">
                    <tr>
                      <th className="text-left">Channel</th>
                      <th className="text-right">Count</th>
                      <th className="text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakEntries(report.channelBreakdown).map((p) => (
                      <tr key={p.key} className="border-t border-neutral-800">
                        <td className="py-1.5">{p.key}</td>
                        <td className="text-right tabular-nums">{p.count}</td>
                        <td className="text-right tabular-nums">{formatIDR(p.revenueCents ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Category breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Category Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase text-neutral-500">
                    <tr>
                      <th className="text-left">Category</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.categoryBreakdown.map((c) => (
                      <tr key={c.categoryId} className="border-t border-neutral-800">
                        <td className="py-1.5">{c.name}</td>
                        <td className="text-right tabular-nums">{c.qty}</td>
                        <td className="text-right tabular-nums">{formatIDR(c.revenueCents)}</td>
                      </tr>
                    ))}
                    {report.categoryBreakdown.length === 0 && (
                      <tr><td colSpan={3} className="text-center text-neutral-500 py-2">—</td></tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Hourly chart (text bars) */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Hourly Sales</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-12 sm:grid-cols-24 gap-1 items-end h-32">
                  {report.hourly.map((h) => {
                    const max = Math.max(1, ...report.hourly.map((x) => x.revenueCents));
                    const pct = (h.revenueCents / max) * 100;
                    return (
                      <div key={h.hour} className="flex flex-col items-center gap-1 min-w-0">
                        <div
                          className="w-full bg-red-600/80 rounded-t"
                          style={{ height: `${pct}%` }}
                          title={`${h.hour}:00 — ${h.orders} orders, ${formatIDR(h.revenueCents)}`}
                        />
                        <div className="text-[9px] text-neutral-500">{h.hour}</div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Top items */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Top 20 Items</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase text-neutral-500">
                    <tr>
                      <th className="text-left">#</th>
                      <th className="text-left">Item</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.topItems.map((it, i) => (
                      <tr key={it.menuItemId} className="border-t border-neutral-800">
                        <td className="py-1 text-neutral-500">{i + 1}</td>
                        <td className="py-1">{it.name}</td>
                        <td className="text-right tabular-nums">{it.qty}</td>
                        <td className="text-right tabular-nums">{formatIDR(it.revenueCents)}</td>
                      </tr>
                    ))}
                    {report.topItems.length === 0 && (
                      <tr><td colSpan={4} className="text-center text-neutral-500 py-2">—</td></tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Shift cash reconciliation */}
            <Card>
              <CardHeader>
                <CardTitle>Shift Reconciliation</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase text-neutral-500">
                    <tr>
                      <th className="text-left">Cashier</th>
                      <th className="text-left">Status</th>
                      <th className="text-right">Expected</th>
                      <th className="text-right">Actual</th>
                      <th className="text-right">Var</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.shiftReconciliation.map((s) => (
                      <tr key={s.shiftId} className="border-t border-neutral-800">
                        <td className="py-1.5">{s.cashier}</td>
                        <td><Badge tone={s.status === 'CLOSED' ? 'muted' : 'success'} className="text-[9px]">{s.status}</Badge></td>
                        <td className="text-right tabular-nums">{s.expectedCents != null ? formatIDR(s.expectedCents) : '—'}</td>
                        <td className="text-right tabular-nums">{s.closingCents != null ? formatIDR(s.closingCents) : '—'}</td>
                        <td className={`text-right tabular-nums ${(s.varianceCents ?? 0) < 0 ? 'text-red-400' : (s.varianceCents ?? 0) > 0 ? 'text-yellow-400' : 'text-neutral-400'}`}>
                          {s.varianceCents != null ? formatIDR(s.varianceCents) : '—'}
                        </td>
                      </tr>
                    ))}
                    {report.shiftReconciliation.length === 0 && (
                      <tr><td colSpan={5} className="text-center text-neutral-500 py-2">Tidak ada shift</td></tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Void/refund log */}
            <Card>
              <CardHeader>
                <CardTitle>Void & Refund Log</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase text-neutral-500">
                    <tr>
                      <th className="text-left">Order</th>
                      <th className="text-left">Status</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.voidRefundLog.map((v) => (
                      <tr key={v.orderId} className="border-t border-neutral-800">
                        <td className="py-1.5">{v.orderNumber}</td>
                        <td><Badge tone="danger" className="text-[9px]">{v.status}</Badge></td>
                        <td className="text-right tabular-nums">{formatIDR(v.totalCents)}</td>
                      </tr>
                    ))}
                    {report.voidRefundLog.length === 0 && (
                      <tr><td colSpan={3} className="text-center text-neutral-500 py-2">Tidak ada void/refund</td></tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
