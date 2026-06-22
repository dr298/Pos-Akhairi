'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { api, type Shift, ApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { formatIDR, parseIDR } from '@/lib/format';

export default function ShiftPage() {
  const { user } = useAuth();
  const [shift, setShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingInput, setOpeningInput] = useState('');
  const [closingInput, setClosingInput] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const [orderCount, setOrderCount] = useState(0);
  const [orderRevenue, setOrderRevenue] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getCurrentShift();
      setShift(res.data);
      if (res.data) {
        // summarize orders for the current shift
        try {
          const orders = await api.getOrders();
          const mine = orders.data.filter((o) => o.shiftId === res.data!.id && o.status === 'PAID');
          setOrderCount(mine.length);
          setOrderRevenue(mine.reduce((s, o) => s + o.totalCents, 0));
        } catch {
          setOrderCount(0);
          setOrderRevenue(0);
        }
      }
    } catch (e: any) {
      toast.error(e?.message || 'Gagal memuat shift');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleOpen() {
    const cents = parseIDR(openingInput);
    if (cents < 0) {
      toast.error('Modal awal tidak valid');
      return;
    }
    setOpening(true);
    try {
      const res = await api.openShift(cents);
      setShift(res.data);
      setOpeningInput('');
      toast.success('Shift dibuka');
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : e?.message || 'Gagal membuka shift';
      toast.error(msg);
    } finally {
      setOpening(false);
    }
  }

  async function handleClose() {
    if (!shift) return;
    const cents = parseIDR(closingInput);
    if (cents < 0) {
      toast.error('Kas akhir tidak valid');
      return;
    }
    setClosing(true);
    try {
      const res = await api.closeShift(shift.id, cents, closeNotes.trim() || undefined);
      setShift(res.data);
      setClosingInput('');
      setCloseNotes('');
      const v = res.data.varianceCents ?? 0;
      if (v === 0) toast.success('Shift ditutup. Selaras.');
      else if (v > 0) toast.success(`Shift ditutup. Lebih ${formatIDR(v)}`);
      else toast.success(`Shift ditutup. Kurang ${formatIDR(Math.abs(v))}`);
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : e?.message || 'Gagal menutup shift';
      if (e instanceof ApiError && e.status === 403) {
        toast.error('Tutup shift butuh role Manager/Owner. Minta manager menutup shift.');
      } else {
        toast.error(msg);
      }
    } finally {
      setClosing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 dark:text-neutral-400 text-sm">
        Memuat…
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 sm:p-6 max-w-2xl mx-auto w-full space-y-4">
      <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Manajemen Shift</h1>

      {!shift ? (
        <Card>
          <CardHeader>
            <CardTitle>Belum ada shift</CardTitle>
            <CardDescription>
              Buka shift baru untuk mulai menerima pesanan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-sm text-neutral-700 dark:text-neutral-300 mb-1 block" htmlFor="open-cash">
                Modal awal (Rp)
              </label>
              <Input
                id="open-cash"
                inputMode="numeric"
                value={openingInput}
                onChange={(e) => setOpeningInput(e.target.value)}
                placeholder="contoh: 200.000"
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={handleOpen} disabled={opening}>
                {opening ? 'Membuka…' : 'Buka Shift'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Shift Aktif</CardTitle>
                <Badge tone="success">{shift.status}</Badge>
              </div>
              <CardDescription>
                Dibuka {new Date(shift.openedAt).toLocaleString('id-ID')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-neutral-500 dark:text-neutral-400">Kasir</span>
                <span className="text-neutral-900 dark:text-neutral-100">{user?.name ?? shift.user?.name ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500 dark:text-neutral-400">Modal awal</span>
                <span className="text-neutral-900 dark:text-neutral-100">{formatIDR(shift.openingCents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500 dark:text-neutral-400">Pesanan terbayar</span>
                <span className="text-neutral-900 dark:text-neutral-100">{orderCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500 dark:text-neutral-400">Pendapatan</span>
                <span className="text-emerald-400 font-semibold">{formatIDR(orderRevenue)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tutup Shift</CardTitle>
              <CardDescription>
                Hitung kas akhir dan tutup shift. Variance otomatis ditampilkan.
                {user?.role === 'CASHIER' && (
                  <span className="block mt-1 text-amber-400">
                    Tutup shift butuh Manager/Owner.
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-sm text-neutral-700 dark:text-neutral-300 mb-1 block" htmlFor="close-cash">
                  Kas akhir (Rp)
                </label>
                <Input
                  id="close-cash"
                  inputMode="numeric"
                  value={closingInput}
                  onChange={(e) => setClosingInput(e.target.value)}
                  placeholder="contoh: 200.000"
                />
              </div>
              <div>
                <label className="text-sm text-neutral-700 dark:text-neutral-300 mb-1 block" htmlFor="close-notes">
                  Catatan (opsional)
                </label>
                <Textarea
                  id="close-notes"
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  placeholder="Catatan tutup shift"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={handleClose}
                  disabled={closing}
                  variant="danger"
                >
                  {closing ? 'Menutup…' : 'Tutup Shift'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
