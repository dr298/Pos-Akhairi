'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { api, type Order, ApiError } from '@/lib/api';
import { formatIDR } from '@/lib/format';

type ReceiptChannel = 'WHATSAPP' | 'EMAIL' | 'PRINT';

interface ReceiptDeliveryRow {
  id: string;
  orderId: string;
  channel: ReceiptChannel;
  target: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  sentAt: string | null;
  failureReason: string | null;
  createdAt: string;
}

const STATUS_TONES: Record<string, 'success' | 'warning' | 'danger' | 'muted' | 'info' | 'default'> = {
  SENT: 'success',
  PENDING: 'warning',
  FAILED: 'danger',
};

const CHANNEL_LABEL: Record<ReceiptChannel, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
  PRINT: 'Cetak',
};

export default function OrderReceiptPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const orderId = params?.id ?? '';

  const [order, setOrder] = useState<Order | null>(null);
  const [deliveries, setDeliveries] = useState<ReceiptDeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<ReceiptChannel | null>(null);
  const [waTarget, setWaTarget] = useState('');
  const [emailTarget, setEmailTarget] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ord, del] = await Promise.all([
        api.getOrder(orderId).catch(() => null),
        api.listReceipts(orderId).catch(() => ({ data: [] as ReceiptDeliveryRow[] })),
      ]);
      setOrder(ord?.data ?? null);
      const list = (del?.data ?? []) as ReceiptDeliveryRow[];
      setDeliveries(list);
      // Pre-fill targets with the latest successful target per channel,
      // so re-sending is one click.
      const lastWa = list.find((d) => d.channel === 'WHATSAPP' && d.target);
      const lastEmail = list.find((d) => d.channel === 'EMAIL' && d.target);
      if (lastWa && !waTarget) setWaTarget(lastWa.target);
      if (lastEmail && !emailTarget) setEmailTarget(lastEmail.target);
    } finally {
      setLoading(false);
    }
  }, [orderId, waTarget, emailTarget]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function handleSend(channel: ReceiptChannel) {
    if (!order) return;
    let target: string | undefined;
    if (channel === 'WHATSAPP') {
      target = waTarget.trim() || undefined;
      if (!target) {
        toast.error('Nomor WhatsApp wajib diisi');
        return;
      }
    } else if (channel === 'EMAIL') {
      target = emailTarget.trim() || undefined;
      if (!target) {
        toast.error('Alamat email wajib diisi');
        return;
      }
    } else {
      toast.info('Cetak lewat menu struk utama ya.');
      return;
    }
    setSending(channel);
    try {
      await api.sendReceipt({
        orderId: order.id,
        channels: [channel],
        target:
          channel === 'WHATSAPP'
            ? { whatsapp: target }
            : { email: target },
      });
      toast.success(`Struk dikirim via ${CHANNEL_LABEL[channel]}`);
      await refresh();
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : e?.message || 'Gagal mengirim struk';
      toast.error(msg);
    } finally {
      setSending(null);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 dark:text-neutral-400 text-sm">
        Memuat struk…
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex-1 p-4 sm:p-6 max-w-3xl mx-auto w-full">
        <Card>
          <CardContent>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Pesanan tidak ditemukan.</p>
            <Link href="/pos/history">
              <Button variant="outline" className="mt-3">Kembali</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 sm:p-6 max-w-3xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Struk Digital</h1>
          <p className="text-xs text-neutral-500">
            {order.orderNumber} · {new Date(order.openedAt).toLocaleString('id-ID')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={order.status === 'PAID' ? 'success' : 'muted'}>{order.status}</Badge>
          <Button size="sm" variant="outline" onClick={() => router.push(`/pos/orders/${orderId}`)}>
            Detail
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ringkasan Pesanan</CardTitle>
          <CardDescription>Total yang akan dikirim ke pelanggan.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <ul className="divide-y divide-neutral-800">
            {order.items.map((it) => (
              <li key={it.id} className="flex justify-between py-1.5">
                <span className="text-neutral-800 dark:text-neutral-200 truncate">
                  {it.quantity}× {it.nameSnapshot}
                </span>
                <span className="text-neutral-700 dark:text-neutral-300">{formatIDR(it.lineTotalCents)}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-neutral-200 dark:border-neutral-800 pt-2 space-y-0.5 text-xs">
            <div className="flex justify-between text-neutral-500 dark:text-neutral-400">
              <span>Subtotal</span>
              <span>{formatIDR(order.subtotalCents)}</span>
            </div>
            <div className="flex justify-between text-neutral-500 dark:text-neutral-400">
              <span>Pajak</span>
              <span>{formatIDR(order.taxCents)}</span>
            </div>
            {order.discountCents > 0 && (
              <div className="flex justify-between text-emerald-400">
                <span>Diskon</span>
                <span>-{formatIDR(order.discountCents)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-semibold text-neutral-900 dark:text-neutral-100 pt-1">
              <span>Total</span>
              <span>{formatIDR(order.totalCents)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kirim Struk</CardTitle>
          <CardDescription>
            WhatsApp butuh <code className="text-neutral-700 dark:text-neutral-300">WA_API_URL</code> + <code className="text-neutral-700 dark:text-neutral-300">WA_API_TOKEN</code>.
            Email butuh <code className="text-neutral-700 dark:text-neutral-300">SMTP_HOST</code>. Kalau belum di-set, struk tetap tercatat
            dengan status FAILED.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="space-y-1">
            <label className="text-xs text-neutral-500 dark:text-neutral-400">Nomor WhatsApp (E.164, contoh +628123…)</label>
            <div className="flex gap-2">
              <input
                value={waTarget}
                onChange={(e) => setWaTarget(e.target.value)}
                placeholder="+6281234567890"
                className="flex-1 h-9 rounded-md bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 px-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <Button
                size="sm"
                onClick={() => handleSend('WHATSAPP')}
                disabled={sending !== null}
              >
                {sending === 'WHATSAPP' ? 'Mengirim…' : 'Kirim via WhatsApp'}
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-500 dark:text-neutral-400">Alamat Email</label>
            <div className="flex gap-2">
              <input
                value={emailTarget}
                onChange={(e) => setEmailTarget(e.target.value)}
                placeholder="pelanggan@email.com"
                type="email"
                className="flex-1 h-9 rounded-md bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 px-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleSend('EMAIL')}
                disabled={sending !== null}
              >
                {sending === 'EMAIL' ? 'Mengirim…' : 'Kirim via Email'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riwayat Pengiriman</CardTitle>
          <CardDescription>Semua percobaan kirim struk untuk pesanan ini.</CardDescription>
        </CardHeader>
        <CardContent>
          {deliveries.length === 0 ? (
            <p className="text-sm text-neutral-500">Belum ada percobaan kirim.</p>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-neutral-500 border-b border-neutral-200 dark:border-neutral-800">
                  <tr>
                    <th className="px-2 py-2 font-medium">Waktu</th>
                    <th className="px-2 py-2 font-medium">Channel</th>
                    <th className="px-2 py-2 font-medium">Tujuan</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.id} className="border-b border-neutral-900 last:border-0">
                      <td className="px-2 py-2 text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                        {new Date(d.createdAt).toLocaleString('id-ID')}
                      </td>
                      <td className="px-2 py-2 text-neutral-800 dark:text-neutral-200">{CHANNEL_LABEL[d.channel]}</td>
                      <td className="px-2 py-2 text-neutral-700 dark:text-neutral-300 font-mono text-xs break-all">
                        {d.target || <span className="text-neutral-600">—</span>}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-col gap-0.5">
                          <Badge tone={STATUS_TONES[d.status] || 'muted'}>{d.status}</Badge>
                          {d.status === 'FAILED' && d.failureReason && (
                            <span className="text-[10px] text-red-400/80">{d.failureReason}</span>
                          )}
                        </div>
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
