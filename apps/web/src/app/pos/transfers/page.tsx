'use client';

// apps/web/src/app/pos/transfers/page.tsx
//
// Sprint audit — Transfer Kas (Inter-account cash transfer log).
// OWNER/MANAGER can record a cash movement (e.g. dari brankas → ke bank,
// atau dari register ke brankas). Entries are append-only; stored in
// settings as CASH_TRANSFERS_LOG (JSON array).
//
// CASHIER is rejected by the API; the UI hides the form for them, and
// if the API is hit anyway it returns 403.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { formatIDR } from '@/lib/format';

interface CashTransfer {
  id: string;
  at: string;
  byName: string;
  fromAccount: string;
  toAccount: string;
  amountCents: number;
  notes: string;
}

const PRESET_ACCOUNTS = [
  'Brankas (Safe)',
  'Register 1',
  'Register 2',
  'Bank BCA',
  'Bank Mandiri',
  'Bank BNI',
  'Bank BRI',
  'E-Wallet (QRIS)',
];

export default function TransfersPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [entries, setEntries] = useState<CashTransfer[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // Form state
  const [fromAccount, setFromAccount] = useState(PRESET_ACCOUNTS[0]);
  const [toAccount, setToAccount] = useState(PRESET_ACCOUNTS[3]);
  const [amount, setAmount] = useState(''); // IDR, user input
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Auth gate
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
      toast.error('Akses ditolak', {
        description: 'Hanya OWNER / MANAGER yang boleh melihat Transfer Kas.',
      });
      router.replace('/pos');
    }
  }, [user, loading, router]);

  const load = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await api.getCashTransfers();
      setEntries(res.data.entries);
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message);
      else toast.error('Gagal load transfer log');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (user && (user.role === 'OWNER' || user.role === 'MANAGER')) void load();
  }, [user, load]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const amountNumber = Number(amount.replace(/[^0-9]/g, ''));
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      toast.error('Nominal tidak valid');
      return;
    }
    if (fromAccount === toAccount) {
      toast.error('From dan To harus berbeda');
      return;
    }
    if (notes.length > 200) {
      toast.error('Catatan max 200 karakter');
      return;
    }
    setSubmitting(true);
    try {
      await api.createCashTransfer({
        fromAccount,
        toAccount,
        amountCents: amountNumber * 100, // IDR → cents
        notes,
      });
      toast.success('Transfer tercatat');
      setAmount('');
      setNotes('');
      await load();
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message);
      else toast.error('Gagal simpan transfer');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !user) {
    return <div className="p-6 text-sm text-neutral-500">Loading…</div>;
  }
  if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
    return null;
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6 max-w-4xl mx-auto">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Transfer Kas</h1>
        <p className="text-sm text-neutral-500">
          Catat perpindahan kas antar rekening/brankas (mis. setoran ke bank, withdrawal ke brankas).
          Append-only — tidak bisa diedit setelah tercatat.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Catat Transfer Baru</CardTitle>
          <CardDescription>OWNER / MANAGER only. Audit trail otomatis.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="fromAccount" className="text-sm font-medium">
                Dari
              </label>
              <select
                id="fromAccount"
                value={fromAccount}
                onChange={(e) => setFromAccount(e.target.value)}
                className="w-full h-9 px-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              >
                {PRESET_ACCOUNTS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="toAccount" className="text-sm font-medium">
                Ke
              </label>
              <select
                id="toAccount"
                value={toAccount}
                onChange={(e) => setToAccount(e.target.value)}
                className="w-full h-9 px-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              >
                {PRESET_ACCOUNTS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="amount" className="text-sm font-medium">
                Nominal (Rp)
              </label>
              <Input
                id="amount"
                type="text"
                inputMode="numeric"
                placeholder="500000"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
                required
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="notes" className="text-sm font-medium">
                Catatan (opsional)
              </label>
              <Input
                id="notes"
                type="text"
                placeholder="Setoran harian ke BCA, dll."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={200}
              />
            </div>

            <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
              <Button type="submit" disabled={submitting} data-testid="transfer-submit">
                {submitting ? 'Menyimpan…' : 'Catat Transfer'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat Transfer</CardTitle>
          <CardDescription>
            {entries.length === 0
              ? 'Belum ada transfer tercatat.'
              : `${entries.length} entri — terbaru dulu.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingList ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-neutral-500">Belum ada entri. Catat transfer pertama di atas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-neutral-200 dark:border-neutral-700">
                    <th className="py-2 pr-4 font-medium">Waktu</th>
                    <th className="py-2 pr-4 font-medium">Oleh</th>
                    <th className="py-2 pr-4 font-medium">Dari</th>
                    <th className="py-2 pr-4 font-medium">Ke</th>
                    <th className="py-2 pr-4 font-medium text-right">Nominal</th>
                    <th className="py-2 pr-4 font-medium">Catatan</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr
                      key={e.id}
                      className="border-b border-neutral-100 dark:border-neutral-800 last:border-0"
                    >
                      <td className="py-2 pr-4 whitespace-nowrap text-neutral-600 dark:text-neutral-400">
                        {new Date(e.at).toLocaleString('id-ID', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </td>
                      <td className="py-2 pr-4">{e.byName}</td>
                      <td className="py-2 pr-4">
                        <Badge tone="muted">{e.fromAccount}</Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <Badge tone="muted">{e.toAccount}</Badge>
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {formatIDR(e.amountCents)}
                      </td>
                      <td className="py-2 pr-4 text-neutral-600 dark:text-neutral-400">
                        {e.notes || '—'}
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
