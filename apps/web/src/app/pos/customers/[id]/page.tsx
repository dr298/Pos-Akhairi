'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError, type CustomerDetail, type LoyaltyTransaction } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
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
import { formatIDR, formatNumber } from '@/lib/format';

const TX_LABELS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'muted' }> = {
  EARN: { label: 'Perolehan', tone: 'success' },
  REDEEM: { label: 'Tukar', tone: 'warning' },
  ADJUST: { label: 'Penyesuaian', tone: 'info' },
  BONUS: { label: 'Bonus', tone: 'muted' },
};

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const customerId = params?.id ?? '';
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustDelta, setAdjustDelta] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');
  const [adjustBusy, setAdjustBusy] = useState(false);

  const canManage = user?.role === 'OWNER' || user?.role === 'MANAGER';

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getCustomer(customerId, 100);
      setCustomer(res.data);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal memuat pelanggan');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleAdjust() {
    const delta = parseInt(adjustDelta, 10);
    if (!Number.isInteger(delta) || delta === 0) {
      toast.error('Delta harus bilangan bulat (positif atau negatif)');
      return;
    }
    if (!adjustNotes.trim()) {
      toast.error('Catatan wajib diisi untuk penyesuaian manual');
      return;
    }
    setAdjustBusy(true);
    try {
      const res = await api.adjustCustomerLoyalty(customerId, {
        delta,
        notes: adjustNotes.trim(),
      });
      toast.success(
        `Penyesuaian disimpan. Saldo baru: ${formatNumber(res.data.newBalance)} poin`,
      );
      setAdjustOpen(false);
      setAdjustDelta('');
      setAdjustNotes('');
      refresh();
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : e?.message || 'Gagal menyesuaikan poin';
      toast.error(msg);
    } finally {
      setAdjustBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">
        Memuat…
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex-1 p-4 sm:p-6 max-w-3xl mx-auto w-full">
        <Card>
          <CardContent>
            <p className="text-sm text-neutral-400">Pelanggan tidak ditemukan.</p>
            <Link href="/pos/customers">
              <Button variant="outline" className="mt-3">Kembali</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalSpent =
    typeof customer.totalSpentCents === 'string'
      ? Number(customer.totalSpentCents)
      : customer.totalSpentCents;

  return (
    <div className="flex-1 p-4 sm:p-6 max-w-3xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">
            {customer.name || customer.phone || customer.email || 'Pelanggan'}
          </h1>
          <p className="text-xs text-neutral-500">
            Terdaftar {new Date(customer.createdAt).toLocaleDateString('id-ID')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={customer.isActive ? 'success' : 'muted'}>
            {customer.isActive ? 'Aktif' : 'Non-aktif'}
          </Badge>
          <Link href="/pos/customers">
            <Button size="sm" variant="outline">Kembali</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Pelanggan</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <Field label="Nama">{customer.name || '—'}</Field>
          <Field label="Nomor HP">{customer.phone ? <span className="font-mono">{customer.phone}</span> : '—'}</Field>
          <Field label="Email">{customer.email || '—'}</Field>
          <Field label="Tanggal Lahir">
            {customer.birthday
              ? new Date(customer.birthday).toLocaleDateString('id-ID')
              : '—'}
          </Field>
          <Field label="Alamat" wide>{customer.address || '—'}</Field>
          <Field label="Catatan" wide>{customer.notes || '—'}</Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Loyalty</CardTitle>
              <CardDescription>Saldo poin dan statistik kunjungan.</CardDescription>
            </div>
            {canManage && (
              <Button size="sm" onClick={() => setAdjustOpen(true)}>
                Penyesuaian Manual
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label="Poin" value={formatNumber(customer.loyaltyPoints)} accent="amber" />
            <Stat label="Kunjungan" value={String(customer.visitCount)} />
            <Stat label="Total Belanja" value={formatIDR(totalSpent)} />
            <Stat
              label="Kunjungan Terakhir"
              value={
                customer.lastVisitAt
                  ? new Date(customer.lastVisitAt).toLocaleDateString('id-ID')
                  : '—'
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riwayat Poin</CardTitle>
          <CardDescription>Mutasi poin terbaru (maks. 100 entri).</CardDescription>
        </CardHeader>
        <CardContent>
          {customer.loyaltyTransactions.length === 0 ? (
            <p className="text-sm text-neutral-400">Belum ada mutasi poin.</p>
          ) : (
            <ul className="divide-y divide-neutral-800">
              {customer.loyaltyTransactions.map((tx: LoyaltyTransaction) => {
                const meta = TX_LABELS[tx.type] || { label: tx.type, tone: 'muted' as const };
                return (
                  <li key={tx.id} className="py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        <span
                          className={`text-sm font-mono ${
                            tx.pointsDelta > 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {tx.pointsDelta > 0 ? '+' : ''}
                          {tx.pointsDelta} poin
                        </span>
                      </div>
                      {tx.notes && (
                        <p className="text-xs text-neutral-500 mt-0.5 truncate">{tx.notes}</p>
                      )}
                      {tx.orderId && (
                        <p className="text-xs text-neutral-500 mt-0.5">Order: {tx.orderId}</p>
                      )}
                    </div>
                    <div className="text-right text-xs text-neutral-500 shrink-0">
                      {new Date(tx.createdAt).toLocaleString('id-ID')}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={adjustOpen} onOpenChange={(v) => !adjustBusy && setAdjustOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <div>
              <DialogTitle>Penyesuaian Poin Manual</DialogTitle>
              <CardDescription>
                Saldo saat ini: {formatNumber(customer.loyaltyPoints)} poin. Gunakan nilai
                positif untuk menambah, negatif untuk mengurangi.
              </CardDescription>
            </div>
            <DialogClose />
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div>
              <label className="text-xs text-neutral-400 mb-1 block">Delta Poin</label>
              <Input
                inputMode="numeric"
                value={adjustDelta}
                onChange={(e) => setAdjustDelta(e.target.value)}
                placeholder="contoh: 50 atau -20"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-400 mb-1 block">Catatan</label>
              <Textarea
                value={adjustNotes}
                onChange={(e) => setAdjustNotes(e.target.value)}
                placeholder="contoh: komplain pelanggan / koreksi double-count"
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)} disabled={adjustBusy}>
              Batal
            </Button>
            <Button
              onClick={handleAdjust}
              disabled={adjustBusy || !adjustDelta || !adjustNotes.trim()}
            >
              {adjustBusy ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <div className="text-xs text-neutral-500 mb-0.5">{label}</div>
      <div className="text-neutral-200">{children}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'amber';
}) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div
        className={`text-base font-semibold ${
          accent === 'amber' ? 'text-amber-300' : 'text-neutral-100'
        }`}
      >
        {value}
      </div>
    </div>
  );
}
