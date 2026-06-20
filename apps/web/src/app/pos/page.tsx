'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useCart } from '@/hooks/useCart';
import { api, type Order, type Shift, ApiError, type PaymentMethodKind, type PaymentProviderName } from '@/lib/api';
import { MenuGrid } from '@/components/POS/MenuGrid';
import { Cart } from '@/components/POS/Cart';
import { PaymentModal, AwaitingPaymentPanel, type PaymentResult } from '@/components/POS/PaymentModal';
import { Badge } from '@/components/ui/Badge';
import { formatIDR } from '@/lib/format';
import { useWebSocket } from '@/hooks/useWebSocket';

interface NonCashState {
  orderId: string;
  orderNumber: string;
  totalCents: number;
  method: PaymentMethodKind;
  provider: PaymentProviderName;
  externalId: string;
  paymentUrl?: string;
  qrString?: string;
  vaNumber?: string;
}

type PollStatus = 'polling' | 'paid' | 'expired' | 'cancelled' | 'error';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

export default function PosPage() {
  const router = useRouter();
  const cart = useCart();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [shift, setShift] = useState<Shift | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [nonCash, setNonCash] = useState<NonCashState | null>(null);
  const [pollStatus, setPollStatus] = useState<PollStatus>('polling');
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number>(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ws = useWebSocket('/ws');
  useEffect(() => {
    return ws.on('order.paid', (msg) => {
      // Refresh shift summary when an order is finalized elsewhere.
      if (msg.orderId && !nonCash) {
        refreshShift();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, nonCash]);

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

  function stopPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (tickTimerRef.current) {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
  }

  function startPolling(orderId: string) {
    stopPolling();
    startedAtRef.current = Date.now();
    setElapsed(0);
    setPollStatus('polling');
    tickTimerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await api.getOrder(orderId);
        if (res.data.status === 'PAID') {
          setPollStatus('paid');
          stopPolling();
          return;
        }
        if (res.data.status === 'VOIDED' || res.data.status === 'REFUNDED' || res.data.status === 'CANCELLED') {
          setPollStatus('cancelled');
          stopPolling();
          return;
        }
        if (Date.now() - startedAtRef.current > POLL_TIMEOUT_MS) {
          setPollStatus('expired');
          stopPolling();
        }
      } catch (e) {
        // network blip; keep polling
      }
    }, POLL_INTERVAL_MS);
  }

  async function createOrder(): Promise<Order> {
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
      discountCode: cart.discount?.code ?? null,
    });
    return orderRes.data;
  }

  async function handlePaymentConfirmCash(amountGivenCents: number): Promise<PaymentResult | null> {
    setPaying(true);
    try {
      const order = await createOrder();
      const payRes = await api.payCash(order.id, amountGivenCents);
      const payment = payRes.data.payment;
      const changeCents = payRes.data.changeCents ?? 0;

      setPaymentOpen(false);
      cart.clear();
      router.push(
        `/pos/success/${order.id}?orderNumber=${encodeURIComponent(order.orderNumber)}&total=${order.totalCents}&given=${amountGivenCents}&change=${changeCents}&method=CASH`,
      );
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        totalCents: order.totalCents,
        amountGivenCents,
        changeCents,
        paymentMethod: 'CASH',
      };
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : e?.message || 'Gagal memproses pesanan';
      toast.error(msg);
      return null;
    } finally {
      setPaying(false);
    }
  }

  async function handlePaymentConfirmNonCash(method: PaymentMethodKind): Promise<PaymentResult | null> {
    setPaying(true);
    try {
      const order = await createOrder();
      const provider: PaymentProviderName = method === 'VIRTUAL_ACCOUNT' ? 'XENDIT' : 'MIDTRANS';
      const charge = await api.chargePayment({
        provider,
        orderId: order.id,
        method,
        amount: order.totalCents,
        customer: cart.customerName ? { name: cart.customerName } : undefined,
      });
      const externalId = charge.data.result.externalId;
      setNonCash({
        orderId: order.id,
        orderNumber: order.orderNumber,
        totalCents: order.totalCents,
        method,
        provider,
        externalId,
        paymentUrl: charge.data.result.paymentUrl,
        qrString: charge.data.result.qrString,
        vaNumber: charge.data.result.vaNumber,
      });
      setPaymentOpen(false);
      startPolling(order.id);

      // Open payment URL in a new tab if the provider returned one.
      if (charge.data.result.paymentUrl) {
        try {
          window.open(charge.data.result.paymentUrl, '_blank', 'noopener,noreferrer');
        } catch {
          // some browsers block; the user can click the link in the panel
        }
      }
      return null;
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : e?.message || 'Gagal membuat pembayaran';
      toast.error(msg);
      return null;
    } finally {
      setPaying(false);
    }
  }

  async function handleCancelNonCash() {
    if (!nonCash) return;
    try {
      if (nonCash.provider === 'MIDTRANS') {
        await api.cancelMidtransPayment(nonCash.externalId);
      } else if (nonCash.provider === 'XENDIT') {
        await api.cancelXenditPayment(nonCash.externalId);
      }
      toast.info('Pembayaran dibatalkan');
    } catch (e: any) {
      // even if cancel fails on provider side, we close locally
      toast.warning(e?.message || 'Gagal membatalkan di provider');
    } finally {
      stopPolling();
      setNonCash(null);
      setPollStatus('polling');
    }
  }

  function handleNonCashPaid() {
    if (!nonCash) return;
    cart.clear();
    const params = new URLSearchParams({
      orderNumber: nonCash.orderNumber,
      total: String(nonCash.totalCents),
      method: nonCash.method,
    });
    router.push(`/pos/success/${nonCash.orderId}?${params.toString()}`);
  }

  useEffect(() => {
    return () => stopPolling();
  }, []);

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
            {ws.status === 'open' && <Badge tone="info">WS live</Badge>}
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
        onConfirmCash={handlePaymentConfirmCash}
        onConfirmNonCash={handlePaymentConfirmNonCash}
        busy={paying}
      />
      <AwaitingPaymentPanel
        open={nonCash !== null}
        onCancel={handleCancelNonCash}
        onPaid={handleNonCashPaid}
        order={null}
        totalCents={nonCash?.totalCents ?? 0}
        provider={nonCash?.provider ?? 'MIDTRANS'}
        method={nonCash?.method ?? 'QRIS'}
        externalId={nonCash?.externalId ?? ''}
        paymentUrl={nonCash?.paymentUrl}
        qrString={nonCash?.qrString}
        vaNumber={nonCash?.vaNumber}
        pollStatus={pollStatus}
        elapsedSeconds={elapsed}
      />
    </div>
  );
}
