'use client';

// Sprint 21 — Profit & Loss page.
//
// Date-range P&L summary sourced from GET /api/reports/pnl.
// Numbers come back as integer cents; we format as IDR.

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatIDR } from '@/lib/format';
import { toast } from 'sonner';

interface PnLResponse {
  from: string;
  to: string;
  paidOrderCount: number;
  revenue: {
    gross: number;
    discount: number;
    net: number;
    tax: number;
    total: number;
  };
  cogsCents: number;
  grossProfitCents: number;
  grossMarginPct: number;
  opex: {
    shrinkage: number;
    waste: number;
    purchaseOrders: number;
    refunds: number;
    total: number;
  };
  netProfitCents: number;
  netMarginPct: number;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function PnLPage() {
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [data, setData] = useState<PnLResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/pnl?from=${from}&to=${to}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const body = await res.json();
      setData(body.data ?? null);
    } catch (e) {
      console.error('pnl load failed', e);
      toast.error((e as Error).message || 'Gagal memuat P&L');
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
        <h1 className="text-xl sm:text-2xl font-semibold">Profit &amp; Loss</h1>
        <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
          Laba rugi dalam rentang tanggal
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
            <Button size="sm" variant="outline" onClick={() => setPreset(0)}>Hari ini</Button>
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
          {/* Top line — net profit hero */}
          <Card>
            <CardContent className="pt-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-neutral-500">
                  Net Profit · {data.from} → {data.to}
                </div>
                <div
                  className={
                    'text-3xl sm:text-4xl font-bold tabular-nums mt-1 ' +
                    (data.netProfitCents >= 0 ? 'text-emerald-500' : 'text-red-500')
                  }
                >
                  {formatIDR(data.netProfitCents)}
                </div>
                <div className="text-xs text-neutral-500 mt-1">
                  Net margin {data.netMarginPct}% · {data.paidOrderCount} paid order
                </div>
              </div>
              <div className="text-right min-w-0">
                <Badge tone={data.grossProfitCents >= 0 ? 'success' : 'danger'}>
                  Gross {formatIDR(data.grossProfitCents)} · {data.grossMarginPct}%
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Revenue / COGS / OpEx columns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Card>
              <CardHeader>
                <CardTitle>Revenue</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <Row label="Gross" value={formatIDR(data.revenue.gross)} />
                <Row label="Discount" value={`-${formatIDR(data.revenue.discount)}`} negative />
                <Row label="PPN" value={formatIDR(data.revenue.tax)} muted />
                <div className="h-px bg-neutral-200 dark:bg-neutral-800 my-2" />
                <Row label="Net" value={formatIDR(data.revenue.net)} bold />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>COGS (HPP)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <p className="text-[10px] text-neutral-500">
                  Biaya bahan baku dari order yang sudah dibayar. Dihitung dari OrderItem.hppCentsUsed.
                </p>
                <Row label="COGS" value={formatIDR(data.cogsCents)} />
                <div className="h-px bg-neutral-200 dark:bg-neutral-800 my-2" />
                <Row
                  label="Gross Profit"
                  value={formatIDR(data.grossProfitCents)}
                  tone={data.grossProfitCents >= 0 ? 'pos' : 'neg'}
                  bold
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Operating Expenses</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <Row label="Shrinkage (opname loss)" value={formatIDR(data.opex.shrinkage)} />
                <Row label="Waste" value={formatIDR(data.opex.waste)} />
                <Row label="Purchase Orders" value={formatIDR(data.opex.purchaseOrders)} />
                <Row label="Refunds" value={formatIDR(data.opex.refunds)} />
                <div className="h-px bg-neutral-200 dark:bg-neutral-800 my-2" />
                <Row label="Total OpEx" value={formatIDR(data.opex.total)} bold />
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {!data && !loading && (
        <Card>
          <CardContent>
            <div className="text-sm text-neutral-500 py-4 text-center">
              Pilih rentang tanggal, lalu klik Terapkan.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  negative,
  muted,
  tone,
}: {
  label: string;
  value: string;
  bold?: boolean;
  negative?: boolean;
  muted?: boolean;
  tone?: 'pos' | 'neg';
}) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className={`min-w-0 truncate ${muted ? 'text-xs text-neutral-500' : 'text-sm'}`}>{label}</span>
      <span
        className={
          'whitespace-nowrap shrink-0 ' +
          (bold ? 'font-semibold ' : '') +
          (negative ? 'text-red-500' : tone === 'pos' ? 'text-emerald-500' : tone === 'neg' ? 'text-red-500' : '')
        }
      >
        {value}
      </span>
    </div>
  );
}
