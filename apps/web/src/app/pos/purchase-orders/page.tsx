'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  api,
  type PurchaseOrder,
  type PurchaseOrderStatus,
} from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { formatIDR } from '@/lib/format';

const STATUS_TONE: Record<
  PurchaseOrderStatus,
  'muted' | 'info' | 'success' | 'warning' | 'danger'
> = {
  DRAFT: 'muted',
  SENT: 'info',
  PARTIAL: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'danger',
};

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  PARTIAL: 'Sebagian',
  RECEIVED: 'Diterima',
  CANCELLED: 'Batal',
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
}

export default function PurchaseOrdersListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | 'ALL'>('ALL');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.listPurchaseOrders({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
      });
      setPos(r.data.purchaseOrders);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user, statusFilter]);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
      router.replace('/pos');
      return;
    }
    void load();
  }, [user, router, load]);

  if (!user) return null;

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-3 max-w-screen-2xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Purchase Order</h1>
          <p className="text-xs sm:text-sm text-neutral-400">
            Pesanan pembelian stok ke supplier — DRAFT → SENT → RECEIVED
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as PurchaseOrderStatus | 'ALL')
            }
            className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm text-neutral-100"
          >
            <option value="ALL">Semua status</option>
            <option value="DRAFT">Draft</option>
            <option value="SENT">Sent</option>
            <option value="PARTIAL">Sebagian</option>
            <option value="RECEIVED">Diterima</option>
            <option value="CANCELLED">Batal</option>
          </select>
          <Button size="sm" variant="outline" onClick={load}>
            Refresh
          </Button>
          <Link href="/pos/purchase-orders/new">
            <Button size="sm">+ Buat PO</Button>
          </Link>
        </div>
      </header>

      <div className="flex items-center gap-3 text-xs">
        <Link href="/pos/suppliers" className="text-red-400 hover:text-red-300">
          → Kelola Supplier
        </Link>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded p-3 text-red-200 text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Daftar Purchase Order ({pos.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-neutral-500">
                <tr>
                  <th className="text-left p-2">No. PO</th>
                  <th className="text-left p-2">Tanggal</th>
                  <th className="text-left p-2">Supplier</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Item</th>
                  <th className="text-right p-2">Total</th>
                  <th className="text-left p-2">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {pos.map((p) => (
                  <tr
                    key={p.id}
                    className="border-t border-neutral-800 hover:bg-neutral-900/40"
                  >
                    <td className="p-2 font-mono text-xs">{p.poNumber}</td>
                    <td className="p-2 text-xs text-neutral-400">
                      {fmtDateTime(p.createdAt)}
                    </td>
                    <td className="p-2">
                      <div className="text-sm">
                        {p.supplier?.name ?? p.supplierId}
                      </div>
                    </td>
                    <td className="p-2">
                      <Badge tone={STATUS_TONE[p.status]} className="text-[10px]">
                        {STATUS_LABEL[p.status]}
                      </Badge>
                    </td>
                    <td className="p-2 text-xs">
                      {p._count?.items ?? p.items?.length ?? '—'}
                    </td>
                    <td className="p-2 text-right font-mono text-xs">
                      {formatIDR(Number(p.totalCents))}
                    </td>
                    <td className="p-2">
                      <Link
                        href={`/pos/purchase-orders/${p.id}`}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >
                        Detail
                      </Link>
                    </td>
                  </tr>
                ))}
                {pos.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="text-center text-neutral-500 py-6">
                      Belum ada purchase order
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {loading && <div className="text-neutral-400 text-sm py-3">Memuat…</div>}
        </CardContent>
      </Card>
    </div>
  );
}
