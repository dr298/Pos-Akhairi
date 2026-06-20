'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  api,
  type ChannelOrder,
  type ChannelOrderDetail,
  type ChannelOrderStatus,
} from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { formatIDR } from '@/lib/format';

const STATUSES: { value: ChannelOrderStatus; label: string; tone: string }[] = [
  { value: 'PENDING', label: 'Pending', tone: 'bg-amber-900 text-amber-300' },
  { value: 'ACCEPTED', label: 'Accepted', tone: 'bg-sky-900 text-sky-300' },
  { value: 'PREPARING', label: 'Preparing', tone: 'bg-indigo-900 text-indigo-300' },
  { value: 'READY', label: 'Ready', tone: 'bg-emerald-900 text-emerald-300' },
  { value: 'PICKED_UP', label: 'Picked up', tone: 'bg-cyan-900 text-cyan-300' },
  { value: 'DELIVERED', label: 'Delivered', tone: 'bg-emerald-900 text-emerald-300' },
  { value: 'CANCELLED', label: 'Cancelled', tone: 'bg-rose-900 text-rose-300' },
  { value: 'REJECTED', label: 'Rejected', tone: 'bg-rose-900 text-rose-300' },
];

export default function DeliveryInboxPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [orders, setOrders] = useState<ChannelOrder[]>([]);
  const [filter, setFilter] = useState<ChannelOrderStatus | 'ALL'>('PENDING');
  const [channelFilter, setChannelFilter] = useState<'ALL' | 'GOFOOD' | 'GRABFOOD' | 'SHOPEEFOOD'>('ALL');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ChannelOrder | null>(null);
  const [detail, setDetail] = useState<ChannelOrderDetail | null>(null);

  useEffect(() => {
    if (!user) return;
    void refresh();
  }, [user, filter, channelFilter]);

  const ws = useWebSocket();
  useEffect(() => {
    const unsub = ws.subscribe((msg) => {
      if (msg.type === 'order.created' || msg.type === 'order.paid') {
        // refresh on any order event
        void refresh();
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.listChannelOrders({
        status: filter === 'ALL' ? undefined : (filter as ChannelOrderStatus),
        channel: channelFilter === 'ALL' ? undefined : channelFilter,
        limit: 100,
      });
      setOrders(r.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(o: ChannelOrder) {
    setSelected(o);
    try {
      const r = await api.getChannelOrder(o.id);
      setDetail(r.data);
    } catch (e) {
      console.error(e);
    }
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Delivery Inbox</h1>
          <p className="text-sm text-slate-400">GoFood · GrabFood · ShopeeFood orders</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.push('/pos/channels')}>
            ⚙️ Channels
          </Button>
          <Button variant="secondary" onClick={() => router.push('/pos')}>
            ← Back
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        <FilterChip
          label="All"
          active={filter === 'ALL'}
          onClick={() => setFilter('ALL')}
        />
        {STATUSES.map((s) => (
          <FilterChip
            key={s.value}
            label={s.label}
            active={filter === s.value}
            onClick={() => setFilter(s.value)}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterChip label="All channels" active={channelFilter === 'ALL'} onClick={() => setChannelFilter('ALL')} />
        <FilterChip label="GoFood" active={channelFilter === 'GOFOOD'} onClick={() => setChannelFilter('GOFOOD')} />
        <FilterChip label="GrabFood" active={channelFilter === 'GRABFOOD'} onClick={() => setChannelFilter('GRABFOOD')} />
        <FilterChip label="ShopeeFood" active={channelFilter === 'SHOPEEFOOD'} onClick={() => setChannelFilter('SHOPEEFOOD')} />
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : orders.length === 0 ? (
        <div className="text-slate-500 text-center py-12">No orders in this filter.</div>
      ) : (
        <div className="grid gap-3">
          {orders.map((o) => (
            <OrderRow key={o.id} order={o} onOpen={() => openDetail(o)} />
          ))}
        </div>
      )}

      {selected && detail && (
        <OrderDetailDialog
          detail={detail}
          onClose={() => {
            setSelected(null);
            setDetail(null);
            void refresh();
          }}
          onAction={async (action, payload) => {
            if (action === 'accept') {
              await api.acceptChannelOrder(detail.id, payload.prepMinutes ?? 15);
            } else if (action === 'reject') {
              await api.rejectChannelOrder(detail.id, payload.reason ?? 'rejected');
            } else if (action === 'status') {
              if (!payload.status) return;
              await api.updateChannelOrderStatus(detail.id, payload.status, payload.note);
            }
            const r = await api.getChannelOrder(detail.id);
            setDetail(r.data);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded text-xs font-medium ${
        active ? 'bg-sky-700 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  );
}

function statusTone(s: ChannelOrderStatus): string {
  return STATUSES.find((x) => x.value === s)?.tone ?? 'bg-slate-800 text-slate-300';
}

function OrderRow({ order, onOpen }: { order: ChannelOrder; onOpen: () => void }) {
  const itemsCount = (order.itemsJson || []).reduce((s, i) => s + i.quantity, 0);
  return (
    <button
      onClick={onOpen}
      className="text-left w-full bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg p-4 transition"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono text-sky-300">{order.channel}</span>
            <span className="text-slate-500">·</span>
            <span className="font-mono">{order.externalRef ?? order.externalId}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${statusTone(order.status)}`}>
              {order.status}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {order.customerName || '—'} · {itemsCount} item{itemsCount === 1 ? '' : 's'} ·{' '}
            {new Date(order.receivedAt).toLocaleTimeString()}
          </div>
        </div>
        <div className="text-right">
          <div className="text-base font-semibold">{formatIDR(order.totalCents)}</div>
          {order.commissionCents > 0 && (
            <div className="text-xs text-rose-400">−{formatIDR(order.commissionCents)} commission</div>
          )}
        </div>
      </div>
    </button>
  );
}

function OrderDetailDialog({
  detail,
  onClose,
  onAction,
}: {
  detail: ChannelOrderDetail;
  onClose: () => void;
  onAction: (
    action: 'accept' | 'reject' | 'status',
    payload: { prepMinutes?: number; reason?: string; status?: ChannelOrderStatus; note?: string },
  ) => Promise<void>;
}) {
  const [prepMinutes, setPrepMinutes] = useState(15);
  const [rejectReason, setRejectReason] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [busy, setBusy] = useState(false);

  const items = detail.itemsJson || [];

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>
              {detail.channel} · {detail.externalRef ?? detail.externalId}
            </CardTitle>
            <p className="text-xs text-slate-400 mt-1">
              Received {new Date(detail.receivedAt).toLocaleString()}
            </p>
          </div>
          <span className={`text-xs px-2 py-1 rounded ${statusTone(detail.status)}`}>
            {detail.status}
          </span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Customer" value={detail.customerName} />
            <Field label="Phone" value={detail.customerPhone} />
            <Field label="Address" value={detail.deliveryAddress} full />
            <Field label="Notes" value={detail.deliveryNotes} full />
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Items</h3>
            <ul className="text-sm divide-y divide-slate-800">
              {items.map((it, i) => (
                <li key={i} className="py-2 flex justify-between">
                  <span>
                    {it.quantity}× {it.name}
                    {it.notes && <span className="text-slate-500 text-xs ml-2">({it.notes})</span>}
                  </span>
                  <span className="text-slate-300">{formatIDR(it.priceCents * it.quantity)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm border-t border-slate-800 pt-3">
            <span>Subtotal</span>
            <span className="text-right">{formatIDR(detail.subtotalCents)}</span>
            <span>Delivery fee</span>
            <span className="text-right">{formatIDR(detail.deliveryFeeCents)}</span>
            <span>Service fee</span>
            <span className="text-right">{formatIDR(detail.serviceFeeCents)}</span>
            {detail.discountCents > 0 && (
              <>
                <span>Discount</span>
                <span className="text-right text-emerald-400">−{formatIDR(detail.discountCents)}</span>
              </>
            )}
            {detail.commissionCents > 0 && (
              <>
                <span>Commission</span>
                <span className="text-right text-rose-400">−{formatIDR(detail.commissionCents)}</span>
              </>
            )}
            <span className="font-semibold">Total</span>
            <span className="text-right font-semibold">{formatIDR(detail.totalCents)}</span>
          </div>

          {detail.status === 'PENDING' && (
            <div className="border-t border-slate-800 pt-3 space-y-3">
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={prepMinutes}
                  onChange={(e) => setPrepMinutes(Number(e.target.value))}
                  className="w-24"
                />
                <span className="text-xs text-slate-400 self-center">min prep</span>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onAction('accept', { prepMinutes });
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Accept & Create Order
                </Button>
              </div>
              <div className="flex gap-2">
                <Textarea
                  rows={1}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Reject reason (e.g. out of stock)"
                />
                <Button
                  variant="danger"
                  disabled={busy || !rejectReason}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onAction('reject', { reason: rejectReason });
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Reject
                </Button>
              </div>
            </div>
          )}

          {['ACCEPTED', 'PREPARING', 'READY'].includes(detail.status) && (
            <div className="border-t border-slate-800 pt-3 space-y-2">
              <h3 className="text-sm font-semibold">Update status</h3>
              <div className="flex gap-2">
                {detail.status === 'ACCEPTED' && (
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onAction('status', { status: 'PREPARING' });
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Start preparing
                  </Button>
                )}
                {detail.status === 'PREPARING' && (
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onAction('status', { status: 'READY' });
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Mark ready
                  </Button>
                )}
                {(userIsManager(detail.status) || detail.status === 'PREPARING') && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onAction('status', { status: 'PICKED_UP' });
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Mark picked up
                  </Button>
                )}
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={async () => {
                    if (!statusNote) {
                      setStatusNote('cancelled by merchant');
                    }
                    setBusy(true);
                    try {
                      await onAction('status', { status: 'CANCELLED', note: statusNote });
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Cancel
                </Button>
              </div>
              <Textarea
                rows={1}
                value={statusNote}
                onChange={(e) => setStatusNote(e.target.value)}
                placeholder="Note (optional)"
              />
            </div>
          )}

          {detail.events && detail.events.length > 0 && (
            <div className="border-t border-slate-800 pt-3">
              <h3 className="text-sm font-semibold mb-2">Timeline</h3>
              <ol className="text-xs text-slate-400 space-y-1">
                {detail.events.map((e) => (
                  <li key={e.id}>
                    <span className="font-mono">{new Date(e.createdAt).toLocaleTimeString()}</span>{' '}
                    · <span className="text-slate-300">{e.status}</span> ({e.actor})
                    {e.note && <span className="italic"> — {e.note}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, full }: { label: string; value: string | null; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-slate-200">{value || '—'}</div>
    </div>
  );
}

function userIsManager(_s: string) {
  // Heuristic — actual role is checked by API
  return true;
}
