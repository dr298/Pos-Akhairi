'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  api,
  type PurchaseOrderDetail,
  type PurchaseOrderItem,
} from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { formatIDR } from '@/lib/format';

const STATUS_TONE = {
  DRAFT: 'muted',
  SENT: 'info',
  PARTIAL: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'danger',
} as const;

const STATUS_LABEL = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  PARTIAL: 'Diterima Sebagian',
  RECEIVED: 'Diterima',
  CANCELLED: 'Batal',
} as const;

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
}

export default function PurchaseOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const id = params.id as string;
  const [po, setPo] = useState<PurchaseOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  // Receive-overrides: poItemId -> qty
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.getPurchaseOrder(id);
      setPo(r.data.purchaseOrder);
      // Default receive qty = qtyOrdered (full receive)
      const defaults: Record<string, string> = {};
      for (const it of r.data.purchaseOrder.items) {
        defaults[it.id] = String(it.qtyOrdered);
      }
      setReceiveQty(defaults);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
      router.replace('/pos');
      return;
    }
    void load();
  }, [user, router, load]);

  const call = async (fn: () => Promise<unknown>, label: string) => {
    setAction(label);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAction(null);
    }
  };

  if (!user) return null;
  if (loading && !po) {
    return <div className="p-6 text-neutral-500 dark:text-neutral-400 text-sm">Memuat…</div>;
  }
  if (!po) {
    return (
      <div className="p-6 space-y-3">
        <div className="text-red-300 text-sm">PO tidak ditemukan</div>
        <Link href="/pos/purchase-orders" className="text-red-400 text-xs">
          ← Kembali
        </Link>
      </div>
    );
  }

  const isOwner = user.role === 'OWNER';
  const canSend = po.status === 'DRAFT';
  const canReceive = po.status === 'SENT' || po.status === 'PARTIAL';
  const canCancel = isOwner && (po.status === 'DRAFT' || po.status === 'SENT');

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 md:p-6 space-y-3 max-w-screen-2xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-semibold font-mono">{po.poNumber}</h1>
            <Badge tone={STATUS_TONE[po.status]} className="text-[10px]">
              {STATUS_LABEL[po.status]}
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
            {po.supplier?.name} • {po.items.length} item • Total{' '}
            <span className="font-mono">{formatIDR(Number(po.totalCents))}</span>
          </p>
        </div>
        <Link href="/pos/purchase-orders" className="text-xs text-red-400 hover:text-red-300">
          ← Kembali
        </Link>
      </header>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded p-3 text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader>
            <CardTitle>Supplier</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="font-medium">{po.supplier?.name}</div>
            {po.supplier?.contactName && (
              <div className="text-xs text-neutral-500 dark:text-neutral-400">{po.supplier.contactName}</div>
            )}
            {po.supplier?.phone && (
              <div className="text-xs text-neutral-500 dark:text-neutral-400">{po.supplier.phone}</div>
            )}
            {po.supplier?.email && (
              <div className="text-xs text-neutral-500 dark:text-neutral-400">{po.supplier.email}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Jadwal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            <div>
              <span className="text-neutral-500">Dibuat:</span> {fmtDateTime(po.createdAt)}
            </div>
            <div>
              <span className="text-neutral-500">Oleh:</span> {po.createdBy?.name ?? '—'}
            </div>
            <div>
              <span className="text-neutral-500">Estimasi tiba:</span>{' '}
              {po.expectedAt ? fmtDateTime(po.expectedAt) : '—'}
            </div>
            <div>
              <span className="text-neutral-500">Diterima:</span>{' '}
              {po.receivedAt ? fmtDateTime(po.receivedAt) : '—'}
            </div>
            <div>
              <span className="text-neutral-500">Dibatalkan:</span>{' '}
              {po.cancelledAt ? fmtDateTime(po.cancelledAt) : '—'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Catatan</CardTitle>
          </CardHeader>
          <CardContent className="text-xs whitespace-pre-wrap">
            {po.notes || <span className="text-neutral-500">—</span>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Item ({po.items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-neutral-500">
                <tr>
                  <th className="text-left p-2">SKU / Nama</th>
                  <th className="text-right p-2 w-24">Qty Order</th>
                  <th className="text-right p-2 w-24">Qty Diterima</th>
                  <th className="text-right p-2 w-28">Harga</th>
                  <th className="text-right p-2 w-32">Subtotal</th>
                  {canReceive && <th className="text-right p-2 w-32">Terima</th>}
                  <th className="text-left p-2">Catatan</th>
                </tr>
              </thead>
              <tbody>
                {po.items.map((it) => (
                  <POItemRow
                    key={it.id}
                    item={it}
                    canReceive={canReceive}
                    receiveValue={receiveQty[it.id] ?? ''}
                    onReceiveChange={(v) =>
                      setReceiveQty((prev) => ({ ...prev, [it.id]: v }))
                    }
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-neutral-300 dark:border-neutral-700">
                  <td colSpan={canReceive ? 4 : 3} className="p-2 text-right font-semibold">
                    Subtotal
                  </td>
                  <td className="p-2 text-right font-mono">
                    {formatIDR(Number(po.subtotalCents))}
                  </td>
                  {canReceive && <td />}
                  <td />
                </tr>
                <tr>
                  <td colSpan={canReceive ? 4 : 3} className="p-2 text-right font-semibold">
                    Total
                  </td>
                  <td className="p-2 text-right font-mono font-semibold">
                    {formatIDR(Number(po.totalCents))}
                  </td>
                  {canReceive && <td />}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Aksi</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {canSend && (
              <Button
                size="sm"
                onClick={() => {
                  if (!confirm('Kirim PO ini ke supplier? Status akan menjadi SENT.')) return;
                  void call(() => api.sendPurchaseOrder(po.id), 'Mengirim PO…');
                }}
                disabled={action !== null}
              >
                Kirim ke Supplier
              </Button>
            )}
            {canReceive && (
              <Button
                size="sm"
                onClick={() => {
                  // Build overrides (only send items where qty differs from current)
                  const items = po.items
                    .map((it) => ({
                      poItemId: it.id,
                      qtyReceived: Number(receiveQty[it.id] ?? it.qtyReceived),
                    }))
                    .filter(
                      (x) =>
                        Number.isFinite(x.qtyReceived) &&
                        x.qtyReceived > (po.items.find((i) => i.id === x.poItemId)?.qtyReceived ?? 0),
                    );
                  if (items.length === 0) {
                    setError('Tidak ada item yang perlu diterima');
                    return;
                  }
                  if (
                    !confirm(
                      `Catat penerimaan untuk ${items.length} item? Stok akan ditambah dan log inventory akan dibuat.`,
                    )
                  )
                    return;
                  void call(() => api.receivePurchaseOrder(po.id, items), 'Mencatat penerimaan…');
                }}
                disabled={action !== null}
              >
                Catat Penerimaan
              </Button>
            )}
            {canCancel && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  if (!confirm('Batalkan PO ini? Tindakan ini tidak dapat dibatalkan.')) return;
                  void call(() => api.cancelPurchaseOrder(po.id), 'Membatalkan PO…');
                }}
                disabled={action !== null}
              >
                Batalkan PO
              </Button>
            )}
            {!canSend && !canReceive && !canCancel && (
              <span className="text-neutral-500 text-sm">
                PO ini tidak memiliki aksi yang tersedia.
              </span>
            )}
            {action && <span className="text-xs text-neutral-500 dark:text-neutral-400 self-center">{action}</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function POItemRow({
  item,
  canReceive,
  receiveValue,
  onReceiveChange,
}: {
  item: PurchaseOrderItem;
  canReceive: boolean;
  receiveValue: string;
  onReceiveChange: (v: string) => void;
}) {
  const inv = item.inventoryItem;
  const qty = Number(item.qtyOrdered);
  const received = item.qtyReceived;
  const lineCents = Math.round(qty * item.unitCostCents);
  return (
    <tr className="border-t border-neutral-200 dark:border-neutral-800">
      <td className="p-2">
        <div className="font-medium text-sm">{inv?.name ?? item.inventoryItemId}</div>
        <div className="text-[10px] text-neutral-500">
          {inv?.sku ?? '?'} • {inv?.unit ?? ''}
        </div>
      </td>
      <td className="p-2 text-right font-mono text-xs">{qty}</td>
      <td className="p-2 text-right font-mono text-xs">
        <span className={received >= qty ? 'text-emerald-400' : received > 0 ? 'text-amber-400' : ''}>
          {received}
        </span>
      </td>
      <td className="p-2 text-right font-mono text-xs">
        {formatIDR(item.unitCostCents)}
      </td>
      <td className="p-2 text-right font-mono text-xs">{formatIDR(lineCents)}</td>
      {canReceive && (
        <td className="p-2 text-right">
          <input
            type="number"
            min={received}
            max={qty}
            step="any"
            value={receiveValue}
            onChange={(e) => onReceiveChange(e.target.value)}
            className="w-24 h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-right text-sm"
          />
        </td>
      )}
      <td className="p-2 text-xs text-neutral-500 dark:text-neutral-400">
        {item.notes || <span className="text-neutral-600">—</span>}
      </td>
    </tr>
  );
}
