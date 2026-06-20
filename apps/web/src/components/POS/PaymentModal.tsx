'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogClose } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { formatIDR, parseIDR } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface PaymentResult {
  orderId: string;
  orderNumber: string;
  totalCents: number;
  amountGivenCents: number;
  changeCents: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  totalCents: number;
  onConfirm: (amountGivenCents: number) => Promise<PaymentResult | null>;
  busy?: boolean;
}

const QUICK_AMOUNTS_IDR = [20000, 50000, 100000, 200000, 500000];

export function PaymentModal({ open, onOpenChange, totalCents, onConfirm, busy }: Props) {
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const amountGivenCents = useMemo(() => parseIDR(input), [input]);
  const changeCents = amountGivenCents - totalCents;
  const sufficient = amountGivenCents >= totalCents && totalCents > 0;

  useEffect(() => {
    if (open) {
      setInput('');
    }
  }, [open]);

  async function handleConfirm() {
    if (!sufficient) return;
    setSubmitting(true);
    try {
      await onConfirm(amountGivenCents);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <div>
            <DialogTitle>Pembayaran Tunai</DialogTitle>
            <p className="text-sm text-neutral-400 mt-0.5">
              Total: <span className="text-neutral-100 font-semibold">{formatIDR(totalCents)}</span>
            </p>
          </div>
          <DialogClose />
        </DialogHeader>
        <DialogBody>
          <div className="space-y-1">
            <label className="text-sm text-neutral-300" htmlFor="amount">
              Diterima (Rp)
            </label>
            <Input
              id="amount"
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
              <Button
                key={amt}
                variant="outline"
                size="sm"
                onClick={() => setInput(String(amt))}
              >
                {formatIDR(amt * 100)}
              </Button>
            ))}
            <Button variant="outline" size="sm" onClick={() => setInput(String(totalCents / 100))}>
              Pas
            </Button>
          </div>
          <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-400">Diterima</span>
              <span className="text-neutral-100">{formatIDR(amountGivenCents)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <span className="text-neutral-200">Kembalian</span>
              <span className={cn(changeCents >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {formatIDR(Math.max(0, changeCents))}
              </span>
            </div>
            {amountGivenCents > 0 && !sufficient && (
              <div className="text-xs text-red-400 pt-1">Tunai kurang</div>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!sufficient || submitting}
          >
            {submitting ? 'Memproses…' : 'Konfirmasi'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
