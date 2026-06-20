'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useCart } from '@/hooks/useCart';
import { api, type Order, type Shift, ApiError } from '@/lib/api';
import { MenuGrid } from '@/components/POS/MenuGrid';
import { Cart } from '@/components/POS/Cart';
import { PaymentModal, type PaymentResult } from '@/components/POS/PaymentModal';
import { Badge } from '@/components/ui/Badge';
import { formatIDR } from '@/lib/format';

export default function PosPage() {
  const router = useRouter();
  const cart = useCart();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [shift, setShift] = useState<Shift | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);

  const refreshShift = useCallback(async () => {
    setShiftLoading(true);
    try {
      const res = await api.getCurrentShift();
      setShift(res.data);
    } catch (e) {
      // ignore — orders can still be taken without an open shift (unusual)
    } finally {
      setShiftLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshShift();
  }, [refreshShift]);

  const disabledReason = useMemo(() => {
    if (cart.lines.length === 0) return 'Keranjang kosong';
    if (cart.orderType === 'DINE_IN' && !cart.tableNumber.trim()) {
      return 'Nomor meja wajib untuk Dine In';
    }
    if (cart.totalCents <= 0) return 'Total tidak valid';
    return undefined;
  }, [cart.lines.length, cart.orderType, cart.tableNumber, cart.totalCents]);

  const canCheckout = !disabledReason;

  const handleAdd = useCallback(
    (item: any, mods: any[], notes?: string) => {
      cart.addItem(item, { modifiers: mods, notes });
    },
    [cart],
  );

  async function handlePaymentConfirm(amountGivenCents: number): Promise<PaymentResult | null> {
    setPaying(true);
    try {
      // 1) Create order
      const orderRes = await api.createOrder({
        orderType: cart.orderType,
        items: cart.lines.map((l) => ({
          menuItemId: l.menuItemId,
          quantity: l.quantity,
          modifiers: l.modifiers.map((m) => ({ modifierId: m.modifierId })),
          notes: l.notes,
        })),
        tableNumber: cart.orderType === 'DINE_IN' ? cart.tableNumber.trim() || null : null,
        customerName:
          cart.orderType === 'TAKEOUT' || cart.orderType === 'DELIVERY'
            ? cart.customerName.trim() || null
            : null,
        notes: cart.notes.trim() || null,
      });
      const order: Order = orderRes.data;

      // 2) Pay cash
      const payRes = await api.payCash(order.id, amountGivenCents);
      const payment = payRes.data.payment;
      const changeCents = payment.providerRaw?.changeCents ?? 0;

      setPaymentOpen(false);
      cart.clear();
      // Refresh shift summary on next page
      router.push(
        `/pos/success/${order.id}?orderNumber=${encodeURIComponent(order.orderNumber)}&total=${order.totalCents}&given=${amountGivenCents}&change=${changeCents}`,
      );
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        totalCents: order.totalCents,
        amountGivenCents,
        changeCents,
      };
    } catch (e: any) {
      const msg =
        e instanceof ApiError ? e.message : e?.message || 'Gagal memproses pesanan';
      toast.error(msg);
      return null;
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_360px] xl:grid-cols-[1fr_400px] min-h-0">
      <div className="p-3 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-neutral-100">Menu</h1>
            {shiftLoading ? (
              <Badge tone="muted">Cek shift…</Badge>
            ) : shift ? (
              <Badge tone="success">Shift aktif</Badge>
            ) : (
              <Badge tone="warning">Belum ada shift</Badge>
            )}
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <MenuGrid onAdd={handleAdd} />
        </div>
      </div>
      <div className="min-h-[60vh] lg:min-h-0">
        <Cart
          onCheckout={() => setPaymentOpen(true)}
          canCheckout={canCheckout}
          checkoutDisabledReason={disabledReason}
          busy={paying}
        />
      </div>
      <PaymentModal
        open={paymentOpen}
        onOpenChange={(v) => !paying && setPaymentOpen(v)}
        totalCents={cart.totalCents}
        onConfirm={handlePaymentConfirm}
        busy={paying}
      />
    </div>
  );
}
