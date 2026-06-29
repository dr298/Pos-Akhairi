'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogClose } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { formatIDR, parseIDR } from '@/lib/format';
import { cn } from '@/lib/utils';
import { api, type Order, type OrderPayment, ApiError, type PaymentProviderInfo, type PaymentMethodKind, type PaymentProviderName } from '@/lib/api';
import { useCart } from '@/hooks/useCart';
import { toast } from 'sonner';

export interface PaymentResult {
  orderId: string;
  orderNumber: string;
  totalCents: number;
  amountGivenCents: number;
  changeCents: number;
  paymentMethod: PaymentMethodKind | 'CASH';
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  totalCents: number;
  /** Cash-only path: caller creates the order and calls pay-cash. */
  onConfirmCash: (amountGivenCents: number) => Promise<PaymentResult | null>;
  /** Non-cash path: caller creates the order and calls chargePayment. */
  onConfirmNonCash: (method: PaymentMethodKind, bankAccount?: { id: string; bankName: string; accountName: string; accountNo: string }) => Promise<PaymentResult | null>;
  busy?: boolean;
}

const QUICK_AMOUNTS_IDR = [20000, 50000, 100000, 200000, 500000];

const METHOD_LABEL: Record<PaymentMethodKind, string> = {
  MANUAL_TRANSFER: 'Transfer',
  CASH: 'Tunai',
  QRIS: 'QRIS',
  VIRTUAL_ACCOUNT: 'Virtual Account',
  EWALLET: 'E-Wallet',
};

export function PaymentModal({ open, onOpenChange, totalCents, onConfirmCash, onConfirmNonCash, busy }: Props) {
  const [tab, setTab] = useState<PaymentMethodKind>('CASH');
  const [providers, setProviders] = useState<PaymentProviderInfo[]>([]);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
    const [pollError, setPollError] = useState<string | null>(null);
  const [bankAccounts, setBankAccounts] = useState<Array<{id: string; bankName: string; accountName: string; accountNo: string}>>([]);
  const [selectedBankAccount, setSelectedBankAccount] = useState('');

  // The non-cash flow has a separate "awaiting payment" sub-state, owned by
  // the parent. We expose the same modal throughout and only close once the
  // parent tells us the order is PAID.

  useEffect(() => {
    if (!open) return;
    setInput('');
    setPollError(null);
    setTab('CASH');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getPaymentProviders();
        if (!cancelled) setProviders(res.data);
      } catch {
        // Fall back to default set so the UI still works
        if (!cancelled) {
          setProviders([
            { name: 'CASH', methods: ['CASH'] },
            { name: 'MANUAL_TRANSFER', methods: ['MANUAL_TRANSFER'] },
            { name: 'MIDTRANS', methods: ['QRIS', 'VIRTUAL_ACCOUNT', 'EWALLET'] },
          ]);
        }
      }
    })();
    // Load bank accounts for MANUAL_TRANSFER
    (async () => {
      try {
        const res = await api.listActiveBankAccounts();
        if (!cancelled) setBankAccounts(res.data.accounts);
      } catch {
        // Ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const availableMethods = useMemo(() => {
    const set = new Set<PaymentMethodKind>(['CASH']);
    for (const p of providers) {
      for (const m of p.methods) {
        // Map VIRTUAL_ACCOUNT alias to EWALLET if not present
        set.add(m);
      }
    }
    return Array.from(set);
  }, [providers]);

  const amountGivenCents = useMemo(() => parseIDR(input), [input]);
  const changeCents = amountGivenCents - totalCents;
  const sufficient = amountGivenCents >= totalCents && totalCents > 0;

  async function handleConfirm() {
    if (tab === 'CASH') {
      if (!sufficient) return;
      setSubmitting(true);
      try {
        await onConfirmCash(amountGivenCents);
      } finally {
        setSubmitting(false);
      }
    } else if (tab === 'MANUAL_TRANSFER') {
      if (!selectedBankAccount) return;
      setSubmitting(true);
      try {
        const acc = bankAccounts.find((a) => a.id === selectedBankAccount);
        await onConfirmNonCash('MANUAL_TRANSFER', acc);
      } finally {
        setSubmitting(false);
      }
    } else {
      setSubmitting(true);
      try {
        await onConfirmNonCash(tab);
      } finally {
        setSubmitting(false);
      }
    }
  }

  const isSubmitting = submitting || busy;

  return (
    <Dialog open={open} onOpenChange={(v) => !isSubmitting && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <div>
            <DialogTitle>Pembayaran</DialogTitle>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
              Total: <span className="text-neutral-900 dark:text-neutral-100 font-semibold">{formatIDR(totalCents)}</span>
            </p>
          </div>
          <DialogClose />
        </DialogHeader>
        <DialogBody>
          <Tabs value={tab} onValueChange={(v) => !isSubmitting && setTab(v as PaymentMethodKind)}>
            <TabsList className="w-full grid grid-cols-5">
              {availableMethods.map((m) => (
                <TabsTrigger key={m} value={m} className="text-xs px-2">
                  {METHOD_LABEL[m] || m}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="CASH" className="space-y-3">
              <div>
                <label className="text-sm text-neutral-700 dark:text-neutral-300 mb-1 block" htmlFor="cash-amt">
                  Diterima (Rp)
                </label>
                <Input
                  id="cash-amt"
                  autoFocus
                  inputMode="numeric"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="contoh: 50.000"
                  className="h-12 text-base"
                />
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {QUICK_AMOUNTS_IDR.map((amt) => (
                  <Button key={amt} variant="outline" size="sm" onClick={() => setInput(String(amt))}>
                    {formatIDR(amt * 100)}
                  </Button>
                ))}
                <Button variant="outline" size="sm" onClick={() => setInput(String(totalCents / 100))}>
                  Pas
                </Button>
              </div>
              <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500 dark:text-neutral-400">Diterima</span>
                  <span className="text-neutral-900 dark:text-neutral-100">{formatIDR(amountGivenCents)}</span>
                </div>
                <div className="flex justify-between text-base font-semibold">
                  <span className="text-neutral-800 dark:text-neutral-200">Kembalian</span>
                  <span className={cn(changeCents >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {formatIDR(Math.max(0, changeCents))}
                  </span>
                </div>
                {amountGivenCents > 0 && !sufficient && (
                  <div className="text-xs text-red-400 pt-1">Tunai kurang</div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="QRIS" className="space-y-2">
              <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 space-y-2 text-sm">
                <p className="text-neutral-700 dark:text-neutral-300">
                  QRIS via Midtrans — setelah klik <strong>Konfirmasi</strong>, order dibuat
                  dan QRIS akan ditampilkan di halaman sukses. Pembayaran terdeteksi
                  otomatis via webhook.
                </p>
                <p className="text-neutral-500 text-xs">
                  Pastikan shift aktif dan terminal online.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="VIRTUAL_ACCOUNT" className="space-y-2">
              <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 space-y-2 text-sm">
                <p className="text-neutral-700 dark:text-neutral-300">
                  Virtual Account — nomor VA akan diterbitkan setelah konfirmasi.
                  Order otomatis terbayar saat pembayaran masuk.
                </p>
                <p className="text-neutral-500 text-xs">Provider: Midtrans / Xendit</p>
              </div>
            </TabsContent>

            <TabsContent value="EWALLET" className="space-y-2">
              <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 space-y-2 text-sm">
                <p className="text-neutral-700 dark:text-neutral-300">
                  E-Wallet (GoPay / OVO / Dana) — pembayaran lewat Snap/Invoice
                  Midtrans atau Xendit.
                </p>
                <p className="text-neutral-500 text-xs">
                  Customer menyelesaikan pembayaran di halaman provider.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="MANUAL_TRANSFER" className="space-y-3">
              <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 space-y-2 text-sm">
                <p className="text-neutral-700 dark:text-neutral-300">
                  Transfer Manual — pilih rekening tujuan transfer di bawah.
                  Customer melakukan transfer ke rekening yang dipilih, lalu konfirmasi ke kasir.
                </p>
                <p className="text-neutral-500 text-xs">
                  Setelah konfirmasi, order akan ditandai sebagai PAID.
                </p>
              </div>
              <div>
                <label className="text-[10px] uppercase text-neutral-500 mb-1 block">Rekening Tujuan</label>
                <select
                  id="bank-account-select"
                  className="w-full border rounded px-2 py-2 text-sm dark:bg-neutral-800 dark:border-neutral-700"
                  value={selectedBankAccount}
                  onChange={(e) => setSelectedBankAccount(e.target.value)}
                >
                  <option value="" disabled>Pilih rekening...</option>
                  {bankAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.bankName} — {acc.accountNo} ({acc.accountName})
                    </option>
                  ))}
                </select>
              </div>
            </TabsContent>
          </Tabs>

          {pollError && (
            <div className="text-xs text-amber-400 bg-amber-950/30 border border-amber-900/50 rounded-md px-2 py-1.5">
              {pollError}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Batal
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isSubmitting || (tab === 'CASH' && !sufficient) || (tab === 'MANUAL_TRANSFER' && !selectedBankAccount)}
          >
            {isSubmitting ? 'Memproses…' : tab === 'CASH' ? 'Konfirmasi Tunai' : 'Buat Pembayaran'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Awaiting-payment panel ─────────────────────────────────────────────────
// Re-used by the parent pos page while polling for non-cash payments. Kept in
// this file so the modal/panel share the same provider info.

export interface AwaitingPaymentProps {
  open: boolean;
  onCancel: () => Promise<void> | void;
  onPaid: () => void;
  order: Order | null;
  totalCents: number;
  provider: PaymentProviderName;
  method: PaymentMethodKind;
  externalId: string;
  paymentUrl?: string;
  qrString?: string;
  vaNumber?: string;
  pollStatus: 'polling' | 'paid' | 'expired' | 'cancelled' | 'error';
  elapsedSeconds: number;
}

export function AwaitingPaymentPanel({
  open,
  onCancel,
  onPaid,
  order,
  totalCents,
  method,
  paymentUrl,
  qrString,
  vaNumber,
  pollStatus,
  elapsedSeconds,
}: AwaitingPaymentProps) {
  // Auto-close on paid
  useEffect(() => {
    if (pollStatus === 'paid') onPaid();
  }, [pollStatus, onPaid]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-white dark:bg-black/70 backdrop-blur-sm">
      <div className="relative z-10 w-full sm:max-w-md rounded-t-2xl sm:rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Menunggu Pembayaran</h2>
          <Badge tone={pollStatus === 'polling' ? 'info' : pollStatus === 'paid' ? 'success' : 'danger'}>
            {pollStatus === 'polling'
              ? `Menunggu… ${elapsedSeconds}s`
              : pollStatus === 'paid'
                ? 'PAID'
                : pollStatus.toUpperCase()}
          </Badge>
        </div>
        <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-neutral-500 dark:text-neutral-400">Order</span>
            <span className="text-neutral-900 dark:text-neutral-100 font-semibold">
              {order?.orderNumber || '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500 dark:text-neutral-400">Metode</span>
            <span className="text-neutral-900 dark:text-neutral-100">{METHOD_LABEL[method]}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500 dark:text-neutral-400">Total</span>
            <span className="text-emerald-400 font-semibold">{formatIDR(totalCents)}</span>
          </div>
        </div>

        {vaNumber && (
          <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 text-center space-y-1">
            <div className="text-xs text-neutral-500">Nomor Virtual Account</div>
            <div className="text-2xl font-mono font-semibold tracking-wider text-neutral-900 dark:text-neutral-100">
              {vaNumber}
            </div>
            <div className="text-xs text-neutral-500">Salin nomor dan bayar lewat m-banking</div>
          </div>
        )}

        {qrString && !paymentUrl && (
          <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 text-center space-y-2">
            <div className="text-xs text-neutral-500">QRIS</div>
            <pre className="text-[10px] text-neutral-500 dark:text-neutral-400 break-all whitespace-pre-wrap max-h-32 overflow-y-auto">
              {qrString}
            </pre>
            <div className="text-xs text-neutral-500">Scan dengan e-wallet / m-banking</div>
          </div>
        )}

        {paymentUrl && (
          <a
            href={paymentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-sm text-red-400 underline"
          >
            Buka halaman pembayaran di tab baru
          </a>
        )}

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={pollStatus !== 'polling'}
            onClick={onCancel}
          >
            Batalkan
          </Button>
        </div>

        <p className="text-[10px] text-neutral-500 text-center">
          Pembayaran akan terdeteksi otomatis. Tidak perlu refresh.
        </p>
      </div>
    </div>
  );
}

// ─── Cart wrapper that adds discount + total in cents ───────────────────────

export function useCheckoutHandlers() {
  // Helper exported for the parent page — extracts the discountCode from the
  // cart for createOrder.
  const cart = useCart();
  return cart;
}

// Internal: re-export the underlying Order type so callers can type-narrow.
export type { Order, OrderPayment };
