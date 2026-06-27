'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useCart } from '@/hooks/useCart';
import type { OrderType } from '@/hooks/useCart';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { formatIDR } from '@/lib/format';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: 'DINE_IN', label: 'Dine In' },
  { value: 'TAKEOUT', label: 'Takeout' },
];

interface Props {
  onCheckout: () => void;
  canCheckout: boolean;
  checkoutDisabledReason?: string;
  busy?: boolean;
}

export function Cart({ onCheckout, canCheckout, checkoutDisabledReason, busy }: Props) {
  const cart = useCart();
  const [discountCode, setDiscountCode] = useState('');
  const [applying, setApplying] = useState(false);
  const [discountErr, setDiscountErr] = useState<string | null>(null);

  // Recompute discount if the cart subtotal changes; we keep the absolute
  // value clamped, so the discount shown stays accurate.
  useEffect(() => {
    if (cart.discount && cart.subtotalCents === 0) {
      cart.setDiscount(null);
    }
  }, [cart.subtotalCents, cart.discount, cart]);

  async function applyDiscount() {
    if (!discountCode.trim()) return;
    if (cart.subtotalCents <= 0) {
      toast.error('Tambah item dulu');
      return;
    }
    setApplying(true);
    setDiscountErr(null);
    try {
      const res = await api.validateDiscount(discountCode.trim(), cart.subtotalCents);
      const v = res.data;
      if (!v.valid) {
        setDiscountErr(v.reason || 'Kode tidak berlaku');
        cart.setDiscount(null);
        return;
      }
      cart.setDiscount({
        code: discountCode.trim(),
        discountId: v.discountId!,
        name: v.name || discountCode.trim(),
        discountCents: v.discountCents,
        baseSubtotalCents: cart.subtotalCents,
      });
      toast.success(`Diskon diterapkan: -${formatIDR(v.discountCents)}`);
    } catch (e: any) {
      setDiscountErr(e?.message || 'Gagal validasi diskon');
    } finally {
      setApplying(false);
    }
  }

  function clearDiscount() {
    cart.setDiscount(null);
    setDiscountCode('');
    setDiscountErr(null);
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-neutral-50 dark:bg-neutral-950 border-l border-neutral-200 dark:border-neutral-800">
      <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
        <div className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
          Keranjang {cart.itemCount > 0 && <span className="text-neutral-500 dark:text-neutral-400">({cart.itemCount})</span>}
        </div>
        {cart.lines.length > 0 && (
          <Button size="sm" variant="ghost" onClick={cart.clear}>
            Kosongkan
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {cart.lines.length === 0 ? (
          <div className="p-6 text-center text-sm text-neutral-500">
            Keranjang kosong. Tap menu untuk menambah.
          </div>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {cart.lines.map((l) => {
              const unit = l.basePriceCents + l.modifiers.reduce((s, m) => s + m.priceDeltaCents, 0);
              const lineTotal = unit * l.quantity;
              return (
                <li key={l.lineId} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-neutral-900 dark:text-neutral-100 truncate">{l.name}</div>
                      {l.modifiers.length > 0 && (
                        <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                          {l.modifiers.map((m) => m.nameSnapshot).join(' · ')}
                        </div>
                      )}
                      {l.notes && (
                        <div className="text-xs text-neutral-500 italic mt-0.5">"{l.notes}"</div>
                      )}
                      <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                        {formatIDR(unit)} × {l.quantity}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      {formatIDR(lineTotal)}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="inline-flex items-center rounded-md border border-neutral-300 dark:border-neutral-700 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => cart.decrementLine(l.lineId)}
                        className="h-8 w-8 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:bg-neutral-800"
                        aria-label="Kurangi"
                      >
                        −
                      </button>
                      <span className="h-8 min-w-[2.25rem] px-2 inline-flex items-center justify-center text-sm text-neutral-900 dark:text-neutral-100">
                        {l.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => cart.incrementLine(l.lineId)}
                        className="h-8 w-8 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:bg-neutral-800"
                        aria-label="Tambah"
                      >
                        +
                      </button>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => cart.removeLine(l.lineId)}
                      className="text-red-400 hover:text-red-300"
                    >
                      Hapus
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-neutral-200 dark:border-neutral-800 p-3 space-y-3 overflow-y-auto">
        <div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-1.5">Tipe Pesanan</div>
          <div className="grid grid-cols-3 gap-1">
            {ORDER_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => cart.setOrderType(t.value)}
                className={cn(
                  'h-10 rounded-md text-sm font-medium transition-colors',
                  cart.orderType === t.value
                    ? 'bg-red-600 text-neutral-900 dark:text-white'
                    : 'bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:bg-neutral-800',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {cart.orderType === 'DINE_IN' && (
          <div>
            <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block" htmlFor="table">
              Nomor Meja
            </label>
            <Input
              id="table"
              value={cart.tableNumber}
              onChange={(e) => cart.setTableNumber(e.target.value)}
              placeholder="contoh: T1, A3"
            />
          </div>
        )}
        {cart.orderType === 'TAKEOUT' && (
          <div>
            <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block" htmlFor="cust">
              Nama Pelanggan
            </label>
            <Input
              id="cust"
              value={cart.customerName}
              onChange={(e) => cart.setCustomerName(e.target.value)}
              placeholder="Opsional"
            />
          </div>
        )}

        <div>
          <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block" htmlFor="notes">
            Catatan
          </label>
          <Textarea
            id="notes"
            value={cart.notes}
            onChange={(e) => cart.setNotes(e.target.value)}
            placeholder="Opsional"
          />
        </div>

        {/* Discount code */}
        <div>
          <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block" htmlFor="discount">
            Kode Diskon
          </label>
          {cart.discount ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-700/50 bg-emerald-950/30 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-emerald-200 truncate">
                  {cart.discount.name}{' '}
                  <span className="text-emerald-400/70 text-xs">({cart.discount.code})</span>
                </div>
                <div className="text-xs text-emerald-300/80">
                  -{formatIDR(cart.discountCents)}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={clearDiscount}>
                Hapus
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                id="discount"
                value={discountCode}
                onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
                placeholder="HEMAT10"
                className="flex-1"
              />
              <Button
                size="md"
                variant="outline"
                onClick={applyDiscount}
                disabled={applying || !discountCode.trim()}
              >
                {applying ? 'Cek…' : 'Pakai'}
              </Button>
            </div>
          )}
          {discountErr && (
            <div className="text-xs text-red-400 mt-1">{discountErr}</div>
          )}
        </div>

        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-neutral-700 dark:text-neutral-300">
            <span>Subtotal</span>
            <span>{formatIDR(cart.subtotalCents)}</span>
          </div>
          {cart.discountCents > 0 && (
            <div className="flex justify-between text-emerald-400">
              <span>Diskon</span>
              <span>-{formatIDR(cart.discountCents)}</span>
            </div>
          )}
          {/* Sprint 13: hide PPN row when effective tax rate is 0.
              The backend already sends taxCents=0 in that case; we just
              don't want to show "Pajak (0.0%) Rp 0" to the cashier. */}
          {cart.taxRateBp > 0 && (
            <div className="flex justify-between text-neutral-500 dark:text-neutral-400">
              <span>Pajak ({(cart.taxRateBp / 100).toFixed(1)}%)</span>
              <span>{formatIDR(cart.taxCents)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold text-neutral-900 dark:text-neutral-100 pt-1 border-t border-neutral-200 dark:border-neutral-800">
            <span>Total</span>
            <span>{formatIDR(cart.totalCents)}</span>
          </div>
        </div>

        {checkoutDisabledReason && (
          <div className="text-xs text-amber-400 bg-amber-950/30 border border-amber-900/50 rounded-md px-2 py-1.5">
            {checkoutDisabledReason}
          </div>
        )}

        <Button
          size="xl"
          className="w-full"
          disabled={!canCheckout || busy}
          onClick={onCheckout}
        >
          {busy ? 'Memproses…' : 'Bayar'}
        </Button>
      </div>
    </div>
  );
}
