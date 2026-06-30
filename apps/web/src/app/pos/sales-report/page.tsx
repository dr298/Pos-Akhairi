'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatIDR } from '@/lib/format';
import { toast } from 'sonner';

interface SaleItem {
  tanggal: string;
  kategori: string;
  menu: string;
  qty: number;
  hargaSatuan: number;
  total: number;
  hppPerPcs: number;
  totalHpp: number;
  profit: number;
}

interface SalesSummary {
  totalOrders: number;
  totalQty: number;
  totalRevenue: number;
  totalHpp: number;
  totalProfit: number;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function SalesReportPage() {
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [items, setItems] = useState<SaleItem[]>([]);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      // Get sales data from range endpoint
      const rangeRes = await fetch(`/api/reports/range?from=${from}&to=${to}`, {
        credentials: 'include',
      });
      if (!rangeRes.ok) throw new Error('Failed to load sales data');
      const rangeData = await rangeRes.json();
      
      // Get item breakdown
      const itemsRes = await fetch(`/api/reports/items?from=${from}&to=${to}`, {
        credentials: 'include',
      });
      if (!itemsRes.ok) throw new Error('Failed to load items');
      const itemsData = await itemsRes.json();

      // Process data
      const processedItems: SaleItem[] = [];
      let totalQty = 0;
      let totalRevenue = 0;
      let totalHpp = 0;

      for (const item of itemsData.data?.items || []) {
        const qty = item.qty || 0;
        const revenueCents = item.revenueCents || 0;
        const hppPerPcs = item.hppPerPcs || 0;
        const totalHppCents = hppPerPcs * qty;
        const profitCents = revenueCents - totalHppCents;

        totalQty += qty;
        totalRevenue += revenueCents;
        totalHpp += totalHppCents;

        processedItems.push({
          tanggal: from + ' - ' + to,
          kategori: item.category || '-',
          menu: item.name || '-',
          qty,
          hargaSatuan: revenueCents / (qty || 1),
          total: revenueCents,
          hppPerPcs,
          totalHpp: totalHppCents,
          profit: profitCents,
        });
      }

      setItems(processedItems);
      setSummary({
        totalOrders: rangeData.data?.totalOrders || 0,
        totalQty,
        totalRevenue,
        totalHpp,
        totalProfit: totalRevenue - totalHpp,
      });
    } catch (e) {
      console.error('Sales report load failed', e);
      toast.error((e as Error).message || 'Gagal memuat laporan penjualan');
    } finally {
      setLoading(false);
    }
  }

  function setPreset(days: number) {
    setFrom(daysAgoISO(days));
    setTo(todayISO());
  }

  async function exportToExcel() {
    try {
      const res = await fetch(`/api/reports/sales-export?from=${from}&to=${to}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Export failed');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sales-${from}-to-${to}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Export berhasil');
    } catch (e) {
      console.error('Export failed', e);
      toast.error((e as Error).message || 'Gagal export');
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 max-w-5xl mx-auto w-full space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold">Laporan Penjualan</h1>
        <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
          Total order, revenue, HPP, dan profit dalam rentang tanggal
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
              className="border rounded px-2 py-1 text-sm dark:bg-neutral-800 dark:border-neutral-700"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] uppercase text-neutral-500 mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border rounded px-2 py-1 text-sm dark:bg-neutral-800 dark:border-neutral-700"
            />
          </div>
          <Button onClick={load} disabled={loading} size="sm">
            {loading ? 'Memuat...' : 'Terapkan'}
          </Button>
          <Button onClick={exportToExcel} variant="outline" size="sm">
            Export Excel
          </Button>
          <div className="flex gap-1 ml-auto">
            <Button onClick={() => setPreset(7)} variant="outline" size="sm">7 hari</Button>
            <Button onClick={() => setPreset(30)} variant="outline" size="sm">30 hari</Button>
            <Button onClick={() => setPreset(90)} variant="outline" size="sm">90 hari</Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Card>
            <CardContent className="pt-4">
              <div className="text-[10px] uppercase text-neutral-500">Total Order</div>
              <div className="text-lg font-semibold">{summary.totalOrders}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-[10px] uppercase text-neutral-500">Total Mangkok</div>
              <div className="text-lg font-semibold">{summary.totalQty}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-[10px] uppercase text-neutral-500">Gross Revenue</div>
              <div className="text-lg font-semibold">{formatIDR(summary.totalRevenue)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-[10px] uppercase text-neutral-500">Total HPP</div>
              <div className="text-lg font-semibold text-red-600">{formatIDR(summary.totalHpp)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-[10px] uppercase text-neutral-500">Nett Profit</div>
              <div className="text-lg font-semibold text-green-600">{formatIDR(summary.totalProfit)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Items table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Detail Penjualan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b dark:border-neutral-700">
                  <th className="text-left py-2 px-2">Kategori</th>
                  <th className="text-left py-2 px-2">Menu</th>
                  <th className="text-right py-2 px-2">Qty</th>
                  <th className="text-right py-2 px-2">Harga</th>
                  <th className="text-right py-2 px-2">Total</th>
                  <th className="text-right py-2 px-2">HPP/pcs</th>
                  <th className="text-right py-2 px-2">Total HPP</th>
                  <th className="text-right py-2 px-2">Profit</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className="border-b dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                    <td className="py-2 px-2">{item.kategori}</td>
                    <td className="py-2 px-2">{item.menu}</td>
                    <td className="py-2 px-2 text-right">{item.qty}</td>
                    <td className="py-2 px-2 text-right">{formatIDR(item.hargaSatuan)}</td>
                    <td className="py-2 px-2 text-right">{formatIDR(item.total)}</td>
                    <td className="py-2 px-2 text-right">{formatIDR(item.hppPerPcs)}</td>
                    <td className="py-2 px-2 text-right text-red-600">{formatIDR(item.totalHpp)}</td>
                    <td className="py-2 px-2 text-right text-green-600">{formatIDR(item.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
