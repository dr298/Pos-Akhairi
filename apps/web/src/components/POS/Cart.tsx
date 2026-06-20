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

const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: 'DINE_IN', label: 'Dine In' },
  { value: 'TAKEOUT', label: 'Takeout' },
  { value: 'DELIVERY', label: 'Delivery' },
];

interface Props {
  onCheckout: () => void;
  canCheckout: boolean;
  checkoutDisabledReason?: string;
  busy?: boolean;
}

export function Cart({ onCheckout, canCheckout, checkoutDisabledReason, busy }: Props) {
  const cart = useCart();
  const [showAllControls, setShowAllControls] = useState(true);

  return (
    <div className="flex h-full flex-col bg-neutral-950 border-l border-neutral-800">
      <div className="px-3 py-2 border-b border-neutral-800 flex items-center justify-between">
        <div className="text-sm font-semibold text-neutral-200">
          Keranjang {cart.itemCount > 0 && <span className="text-neutral-400">({cart.itemCount})</span>}
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
                      <div className="text-sm text-neutral-100 truncate">{l.name}</div>
                      {l.modifiers.length > 0 && (
                        <div className="text-xs text-neutral-400 mt-0.5">
                          {l.modifiers.map((m) => m.nameSnapshot).join(' · ')}
                        </div>
                      )}
                      {l.notes && (
                        <div className="text-xs text-neutral-500 italic mt-0.5">"{l.notes}"</div>
                      )}
                      <div className="text-xs text-neutral-400 mt-1">
                        {formatIDR(unit)} × {l.quantity}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-neutral-100">
                      {formatIDR(lineTotal)}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="inline-flex items-center rounded-md border border-neutral-700 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => cart.decrementLine(l.lineId)}
                        className="h-8 w-8 text-neutral-200 hover:bg-neutral-800"
                        aria-label="Kurangi"
                      >
                        −
                      </button>
                      <span className="h-8 min-w-[2.25rem] px-2 inline-flex items-center justify-center text-sm text-neutral-100">
                        {l.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => cart.incrementLine(l.lineId)}
                        className="h-8 w-8 text-neutral-200 hover:bg-neutral-800"
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

      <div className="border-t border-neutral-800 p-3 space-y-3">
        <div>
          <div className="text-xs text-neutral-400 mb-1.5">Tipe Pesanan</div>
          <div className="grid grid-cols-3 gap-1">
            {ORDER_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => cart.setOrderType(t.value)}
                className={cn(
                  'h-10 rounded-md text-sm font-medium transition-colors',
                  cart.orderType === t.value
                    ? 'bg-red-600 text-white'
                    : 'bg-neutral-900 border border-neutral-700 text-neutral-200 hover:bg-neutral-800',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {cart.orderType === 'DINE_IN' && (
          <div>
            <label className="text-xs text-neutral-400 mb-1 block" htmlFor="table">
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
        {(cart.orderType === 'TAKEOUT' || cart.orderType === 'DELIVERY') && (
          <div>
            <label className="text-xs text-neutral-400 mb-1 block" htmlFor="cust">
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
          <label className="text-xs text-neutral-400 mb-1 block" htmlFor="notes">
            Catatan
          </label>
          <Textarea
            id="notes"
            value={cart.notes}
            onChange={(e) => cart.setNotes(e.target.value)}
            placeholder="Opsional"
          />
        </div>

        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-neutral-300">
            <span>Subtotal</span>
            <span>{formatIDR(cart.subtotalCents)}</span>
          </div>
          <div className="flex justify-between text-neutral-400">
            <span>Pajak ({(cart.taxRateBp / 100).toFixed(1)}%)</span>
            <span>{formatIDR(cart.taxCents)}</span>
          </div>
          <div className="flex justify-between text-base font-semibold text-neutral-100 pt-1 border-t border-neutral-800">
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
          {busy ? 'Memproses…' : 'Bayar Tunai'}
        </Button>
      </div>
    </div>
  );
}
