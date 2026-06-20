'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { api, type Order, ApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogClose } from '@/components/ui/Dialog';
import { formatIDR } from '@/lib/format';

const STATUS_TONES: Record<string, 'success' | 'warning' | 'danger' | 'muted' | 'info' | 'default'> = {
  PAID: 'success',
  OPEN: 'warning',
  VOIDED: 'danger',
  REFUNDED: 'danger',
  CANCELLED: 'danger',
};

const TYPE_LABEL: Record<string, string> = {
  DINE_IN: 'Dine In',
  TAKEOUT: 'Takeout',
  TAKEAWAY: 'Takeout',
  DELIVERY: 'Delivery',
};

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const orderId = params?.id ?? '';
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [voidOpen, setVoidOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<'CASH' | 'ORIGINAL'>('CASH');
  const [busy, setBusy] = useState(false);
  const [lowStock, setLowStock] = useState<Array<{ name: string; currentStock: number; minStock: number }>>([]);

  const canManage = user?.role === 'OWNER' || user?.role === 'MANAGER';

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getOrder(orderId);
      setOrder(res.data);
      // Pull low-stock alerts from localStorage if present
      try {
        const raw = window.localStorage.getItem(`order:${orderId}:lowstock`);
        if (raw) setLowStock(JSON.parse(raw));
      } catch {
        // ignore
      }
    } catch (e: any) {
      toast.error(e?.message || 'Gagal memuat pesanan');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleVoid() {
    if (!order || !reason.trim()) {
      toast.error('Alasan wajib diisi');
      return;
    }
    setBusy(true);
    try {
      await api.voidOrder(order.id, reason.trim());
      toast.success('Pesanan di-void');
      setVoidOpen(false);
      setReason('');
      refresh();
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : e?.message || 'Gagal void';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleRefund() {
    if (!order || !reason.trim()) {
      toast.error('Alasan wajib diisi');
      return;
    }
    setBusy(true);
    try {
      await api.refundOrder(order.id, reason.trim(), refundMethod);
      toast.success('Pesanan di-refund');
      setRefundOpen(false);
      setReason('');
      refresh();
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : e?.message || 'Gagal refund';
      if (e instanceof ApiError && e.status === 403) {
        toast.error('Refund butuh role Manager/Owner');
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">
        Memuat…
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex-1 p-4 sm:p-6 max-w-3xl mx-auto w-full">
        <Card>
          <CardContent>
            <p className="text-sm text-neutral-400">Pesanan tidak ditemukan.</p>
            <Link href="/pos/history">
              <Button variant="outline" className="mt-3">Kembali</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 sm:p-6 max-w-3xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">{order.orderNumber}</h1>
          <p className="text-xs text-neutral-500">
            {new Date(order.openedAt).toLocaleString('id-ID')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONES[order.status] || 'muted'}>{order.status}</Badge>
          <Link href="/pos/history">
            <Button size="sm" variant="outline">Kembali</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detail Pesanan</CardTitle>
          <CardDescription>
            {TYPE_LABEL[order.type] || order.type}
            {order.tableNumber ? ` · Meja ${order.tableNumber}` : ''}
            {order.customerName ? ` · ${order.customerName}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ul className="divide-y divide-neutral-800">
            {order.items.map((it) => (
              <li key={it.id} className="flex justify-between py-1.5">
                <span className="text-neutral-200 truncate">
                  {it.quantity}× {it.nameSnapshot}
                </span>
                <span className="text-neutral-300">{formatIDR(it.lineTotalCents)}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-neutral-800 pt-2 space-y-0.5 text-xs">
            <div className="flex justify-between text-neutral-400">
              <span>Subtotal</span>
              <span>{formatIDR(order.subtotalCents)}</span>
            </div>
            <div className="flex justify-between text-neutral-400">
              <span>Pajak</span>
              <span>{formatIDR(order.taxCents)}</span>
            </div>
            {order.discountCents > 0 && (
              <div className="flex justify-between text-emerald-400">
                <span>Diskon</span>
                <span>-{formatIDR(order.discountCents)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-semibold text-neutral-100 pt-1">
              <span>Total</span>
              <span>{formatIDR(order.totalCents)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {order.payments && order.payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pembayaran</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {order.payments.map((p) => (
              <div key={p.id} className="flex justify-between border-b border-neutral-800 last:border-0 py-1.5">
                <span className="text-neutral-300">
                  {p.provider} · {p.method} · {p.status}
                </span>
                <span className={p.amountCents < 0 ? 'text-red-400' : 'text-neutral-100'}>
                  {formatIDR(Math.abs(p.amountCents))}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {lowStock.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-amber-400">Peringatan Stok</CardTitle>
            <CardDescription>Item berikut di bawah reorder point.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {lowStock.map((l) => (
              <div key={l.name} className="flex justify-between">
                <span className="text-neutral-200">{l.name}</span>
                <span className="text-amber-300">
                  {l.currentStock} / {l.minStock}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aksi</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {order.status === 'OPEN' && (
              <Button variant="danger" onClick={() => setVoidOpen(true)}>
                Void Pesanan
              </Button>
            )}
            {order.status === 'PAID' && (
              <Button variant="danger" onClick={() => setRefundOpen(true)}>
                Refund Pesanan
              </Button>
            )}
            {order.status !== 'OPEN' && order.status !== 'PAID' && (
              <p className="text-sm text-neutral-500">Tidak ada aksi untuk status {order.status}.</p>
            )}
          </CardContent>
        </Card>
      )}

      {!canManage && (order.status === 'OPEN' || order.status === 'PAID') && (
        <div className="text-xs text-neutral-500 bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2">
          Void & refund butuh role Manager/Owner.
        </div>
      )}

      <Dialog open={voidOpen} onOpenChange={(v) => !busy && setVoidOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <div>
              <DialogTitle>Void Pesanan</DialogTitle>
              <CardDescription>Pesanan OPEN akan dibatalkan.</CardDescription>
            </div>
            <DialogClose />
          </DialogHeader>
          <DialogBody>
            <label className="text-sm text-neutral-300 block mb-1">Alasan</label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="contoh: pelanggan berubah pikiran"
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidOpen(false)} disabled={busy}>Batal</Button>
            <Button variant="danger" onClick={handleVoid} disabled={busy || !reason.trim()}>
              {busy ? 'Memproses…' : 'Void'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={refundOpen} onOpenChange={(v) => !busy && setRefundOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <div>
              <DialogTitle>Refund Pesanan</DialogTitle>
              <CardDescription>Stok akan dikembalikan untuk metode CASH/ORIGINAL.</CardDescription>
            </div>
            <DialogClose />
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div>
              <label className="text-sm text-neutral-300 block mb-1">Alasan</label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="contoh: komplain pelanggan"
              />
            </div>
            <div>
              <label className="text-sm text-neutral-300 block mb-1">Metode Refund</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRefundMethod('CASH')}
                  className={`h-10 rounded-md text-sm font-medium border ${
                    refundMethod === 'CASH'
                      ? 'bg-red-600 text-white border-red-600'
                      : 'bg-neutral-900 border-neutral-700 text-neutral-200'
                  }`}
                >
                  Tunai
                </button>
                <button
                  type="button"
                  onClick={() => setRefundMethod('ORIGINAL')}
                  className={`h-10 rounded-md text-sm font-medium border ${
                    refundMethod === 'ORIGINAL'
                      ? 'bg-red-600 text-white border-red-600'
                      : 'bg-neutral-900 border-neutral-700 text-neutral-200'
                  }`}
                >
                  Asal Pembayaran
                </button>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundOpen(false)} disabled={busy}>Batal</Button>
            <Button variant="danger" onClick={handleRefund} disabled={busy || !reason.trim()}>
              {busy ? 'Memproses…' : 'Refund'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
