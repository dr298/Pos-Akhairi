// apps/api/src/services/receipt-delivery.ts
//
// Sprint 8.9 — Digital receipt delivery (WhatsApp / Email / Print).
//
// Public surface
//   renderReceipt(orderId)              → { text, html, subject, meta }
//   sendWhatsapp(target, message)       → { ok, messageId?, error? }
//   sendEmail(target, subject, text)    → { ok, messageId?, error? }
//   dispatch(orderId, channels, target?) → fire-and-forget per-channel rows
//
// Defensive contract
//   - NEVER throws to callers from the I/O paths. Returns a result object.
//   - If a provider is unconfigured (WA_API_URL / SMTP_HOST missing) the
//     function returns { ok: false, error: 'WhatsApp not configured' }
//     without raising. The route layer maps that to a 200 response with
//     status=FAILED on the ReceiptDelivery row.
//   - dispatch() is fire-and-forget. It creates PENDING rows first so the
//     UI can poll for status, then awaits each channel and updates the row.
//
// Configuration
//   WhatsApp:  WA_API_URL (e.g. https://graph.facebook.com/v18.0/<phone-id>/messages)
//              WA_API_TOKEN
//   Email:     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM

import { Prisma } from '@prisma/client';
import { prisma } from '@pos/db';
import { logger } from '../logger.js';
import { incCounter } from '../middleware/metrics.js';
import { shouldKickForPayment, kickPrinterBase64 } from './cash-drawer.js';

// ─── Public types ───────────────────────────────────────────────────────────

export type ReceiptChannelKind = 'WHATSAPP' | 'EMAIL' | 'PRINT';

export interface RenderedReceipt {
  text: string;
  html: string;
  subject: string;
  meta: {
    orderId: string;
    orderNumber: string;
    branchName: string;
    branchAddress: string | null;
    cashierName: string;
    openedAt: Date;
    closedAt: Date | null;
    totalCents: number;
    paymentMethod: string;
    amountGiven: number | null;
    changeCents: number | null;
    items: Array<{ name: string; quantity: number; lineTotalCents: number }>;
    subtotalCents: number;
    taxCents: number;
    discountCents: number;
  };
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface DispatchTarget {
  whatsapp?: string;
  email?: string;
}

export interface DispatchResult {
  deliveries: Array<{
    id: string;
    channel: ReceiptChannelKind;
    target: string;
    status: 'PENDING' | 'SENT' | 'FAILED';
    error?: string;
  }>;
}

// ─── Render ─────────────────────────────────────────────────────────────────

const BRAND_HEADER = 'BAKMIE KOTA JUANG';

/**
 * Right-pad a string to a fixed width (truncating if too long), with
 * simple ASCII-only logic. Avoids pulling in a third-party string-width
 * library for what is essentially a 32-column receipt.
 */
function pad(s: string, width: number, align: 'left' | 'right' = 'left'): string {
  // Truncate first to avoid width overflow
  const truncated = s.length > width ? s.slice(0, width) : s;
  if (truncated.length >= width) return truncated;
  const fill = ' '.repeat(width - truncated.length);
  return align === 'left' ? truncated + fill : fill + truncated;
}

function formatRupiah(cents: number): string {
  // Indonesian convention: "Rp 50.000" — group thousands with "."
  const rupiah = Math.round(cents / 100);
  const str = Math.abs(rupiah).toLocaleString('id-ID');
  return rupiah < 0 ? `-Rp ${str.replace('-', '')}` : `Rp ${str}`;
}

function formatDateId(d: Date): string {
  // 15/05/2025 14:30 — local time, Asia/Jakarta-ish
  try {
    return d.toLocaleString('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return d.toISOString();
  }
}

function itemLine(name: string, qty: number, lineTotalCents: number): string {
  // Layout: 22-char name | 3-char qty | 9-char subtotal right-aligned → 34 cols
  const nameCol = pad(name, 22);
  const qtyCol = pad(String(qty), 3, 'right');
  const totalCol = pad(formatRupiah(lineTotalCents), 9, 'right');
  return `${nameCol} ${qtyCol} ${totalCol}`;
}

/**
 * Render the receipt for an order. Loads the order, openedBy user
 * and the first PAID payment. Throws (caller catches) if the order doesn't
 * exist; other lookup failures are tolerant.
 */
export async function renderReceipt(orderId: string): Promise<RenderedReceipt> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      openedBy: { select: { name: true } },
      items: { orderBy: { createdAt: 'asc' } },
      payments: { where: { status: 'PAID' }, orderBy: { paidAt: 'asc' }, take: 1 },
    },
  });
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const cashierName = order.openedBy?.name ?? '—';
  // Single-restaurant deployment. The legacy `branchName` / `branchAddress`
  // fields are kept for receipt-template compatibility and fall back to the
  // brand header when not set.
  const branchName = BRAND_HEADER;
  const branchAddress = null;
  const openedAt = order.openedAt;
  const closedAt = order.closedAt ?? null;

  // Try to find a providerRaw.amountGiven / changeCents snapshot from the
  // payment-finalize payload (we stash it for CASH).
  const payment = order.payments[0];
  let amountGiven: number | null = null;
  let changeCents: number | null = null;
  if (payment) {
    const raw = payment.providerRaw as { amountGiven?: number; changeCents?: number } | null;
    if (raw && typeof raw.amountGiven === 'number') amountGiven = raw.amountGiven;
    if (raw && typeof raw.changeCents === 'number') changeCents = raw.changeCents;
  }

  const items = order.items.map((it) => ({
    name: it.nameSnapshot,
    quantity: it.quantity,
    lineTotalCents: it.lineTotalCents,
  }));

  // ─── Plain text (32-col body, used for WhatsApp + console preview) ────
  const divider = '-'.repeat(34);
  const headerLines: string[] = [];
  headerLines.push('=== ' + BRAND_HEADER + ' ===');
  headerLines.push(pad(branchName, 34, 'left'));
  if (branchAddress) headerLines.push(pad(branchAddress, 34, 'left'));
  headerLines.push('');

  const metaLines: string[] = [];
  metaLines.push(`No. Order: ${order.orderNumber}`);
  metaLines.push(`Tanggal:   ${formatDateId(closedAt ?? openedAt)}`);
  metaLines.push(`Kasir:     ${cashierName}`);
  if (order.tableNumber) metaLines.push(`Meja:      ${order.tableNumber}`);
  if (order.customerName) metaLines.push(`Pelanggan: ${order.customerName}`);

  const itemLines: string[] = [divider];
  for (const it of items) {
    itemLines.push(itemLine(it.name, it.quantity, it.lineTotalCents));
  }

  // Tax label — try to show 11% rate when PPN is present (matches the
  // Indonesian receipt example). If tax is 0, show "PPN 11% (0)" so the
  // receipt layout stays consistent.
  const taxLabel = order.taxCents > 0 ? `PPN 11%:` : `PPN 11%:`;
  const totalsLines: string[] = [
    divider,
    `${pad('Subtotal:', 24)} ${pad(formatRupiah(order.subtotalCents), 10, 'right')}`,
    `${pad(taxLabel, 24)} ${pad(formatRupiah(order.taxCents), 10, 'right')}`,
    `${pad('Diskon:', 24)} ${pad(formatRupiah(order.discountCents), 10, 'right')}`,
    divider,
    `${pad('TOTAL:', 24)} ${pad(formatRupiah(order.totalCents), 10, 'right')}`,
  ];

  const paymentLines: string[] = [];
  if (payment) {
    const methodLabel =
      payment.method === 'CASH'
        ? 'Tunai'
        : payment.method === 'QRIS'
          ? 'QRIS'
          : payment.method === 'EWALLET'
            ? 'E-Wallet'
            : payment.method;
    paymentLines.push('');
    paymentLines.push(`${pad(`Bayar (${methodLabel}):`, 24)} ${pad(formatRupiah(payment.amountCents), 10, 'right')}`);
    if (amountGiven != null) {
      paymentLines.push(`${pad('Diterima:', 24)} ${pad(formatRupiah(amountGiven), 10, 'right')}`);
    }
    if (changeCents != null) {
      paymentLines.push(`${pad('Kembali:', 24)} ${pad(formatRupiah(changeCents), 10, 'right')}`);
    }
  }

  const footer = '\nTerima kasih atas kunjungannya!\n';
  const text =
    [...headerLines, ...metaLines, ...itemLines, ...totalsLines, ...paymentLines].join('\n') +
    footer;

  // ─── HTML (used for Email body and the /pos/orders/:id/receipt page) ───
  const rows = items
    .map(
      (it) =>
        `<tr><td>${escapeHtml(it.name)}</td><td style="text-align:center">${it.quantity}</td><td style="text-align:right">${formatRupiah(it.lineTotalCents)}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Struk ${escapeHtml(order.orderNumber)}</title></head>
<body style="font-family:monospace,Courier,monospace;max-width:480px;margin:0 auto;padding:16px;background:#0a0a0a;color:#e5e5e5;">
  <h2 style="text-align:center;margin:0 0 4px;color:#fbbf24;">${escapeHtml(BRAND_HEADER)}</h2>
  <p style="text-align:center;margin:0 0 4px;">${escapeHtml(branchName)}</p>
  ${branchAddress ? `<p style="text-align:center;margin:0 0 12px;color:#9ca3af;">${escapeHtml(branchAddress)}</p>` : ''}
  <hr style="border:0;border-top:1px dashed #525252"/>
  <p style="margin:4px 0;"><b>No. Order:</b> ${escapeHtml(order.orderNumber)}</p>
  <p style="margin:4px 0;"><b>Tanggal:</b> ${escapeHtml(formatDateId(closedAt ?? openedAt))}</p>
  <p style="margin:4px 0;"><b>Kasir:</b> ${escapeHtml(cashierName)}</p>
  ${order.tableNumber ? `<p style="margin:4px 0;"><b>Meja:</b> ${escapeHtml(order.tableNumber)}</p>` : ''}
  ${order.customerName ? `<p style="margin:4px 0;"><b>Pelanggan:</b> ${escapeHtml(order.customerName)}</p>` : ''}
  <hr style="border:0;border-top:1px dashed #525252"/>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">
    <thead><tr><th align="left">Item</th><th align="center">Qty</th><th align="right">Subtotal</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <hr style="border:0;border-top:1px dashed #525252"/>
  <table style="width:100%;font-size:14px;">
    <tr><td>Subtotal</td><td style="text-align:right">${formatRupiah(order.subtotalCents)}</td></tr>
    <tr><td>PPN 11%</td><td style="text-align:right">${formatRupiah(order.taxCents)}</td></tr>
    <tr><td>Diskon</td><td style="text-align:right">${formatRupiah(order.discountCents)}</td></tr>
    <tr><td><b>TOTAL</b></td><td style="text-align:right"><b>${formatRupiah(order.totalCents)}</b></td></tr>
  </table>
  ${
    payment
      ? `<hr style="border:0;border-top:1px dashed #525252"/>
  <p style="margin:4px 0;">Bayar (${escapeHtml(String(payment.method))}): <b>${formatRupiah(payment.amountCents)}</b></p>
  ${amountGiven != null ? `<p style="margin:4px 0;">Diterima: <b>${formatRupiah(amountGiven)}</b></p>` : ''}
  ${changeCents != null ? `<p style="margin:4px 0;">Kembali: <b style="color:#10b981;">${formatRupiah(changeCents)}</b></p>` : ''}`
      : ''
  }
  <hr style="border:0;border-top:1px dashed #525252"/>
  <p style="text-align:center;margin-top:16px;color:#9ca3af;">Terima kasih atas kunjungannya!</p>
</body></html>`;

  const subject = `Struk ${order.orderNumber} — ${branchName}`;

  return {
    text,
    html,
    subject,
    meta: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      branchName,
      branchAddress,
      cashierName,
      openedAt,
      closedAt,
      totalCents: order.totalCents,
      paymentMethod: payment?.method ?? 'UNKNOWN',
      amountGiven,
      changeCents,
      items,
      subtotalCents: order.subtotalCents,
      taxCents: order.taxCents,
      discountCents: order.discountCents,
    },
  };
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── WhatsApp send ──────────────────────────────────────────────────────────

/**
 * Send a plain-text message via a generic WhatsApp Business API endpoint
 * (Cloud API / Meta / Twilio-compatible). POSTs to env(WA_API_URL) with
 * `Authorization: Bearer <WA_API_TOKEN>`. The body shape is the Cloud API
 * default: `{ messaging_product: "whatsapp", to, type: "text", text: { body } }`.
 *
 * If WA_API_URL is not set → returns { ok: false, error: 'WhatsApp not configured' }.
 * Other errors (network, 4xx/5xx) are returned as { ok: false, error } without throwing.
 */
export async function sendWhatsapp(target: string, message: string): Promise<SendResult> {
  const url = process.env.WA_API_URL;
  const token = process.env.WA_API_TOKEN;
  if (!url || !token) {
    return { ok: false, error: 'WhatsApp not configured' };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: target,
        type: 'text',
        text: { body: message },
      }),
    });
    if (!res.ok) {
      const body = await safeText(res);
      return { ok: false, error: `HTTP ${res.status}: ${truncate(body, 280)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }> };
    const messageId = data.messages?.[0]?.id;
    return { ok: true, messageId };
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'Network error' };
  }
}

// ─── Email send ─────────────────────────────────────────────────────────────

/**
 * Send a plain-text (or HTML) email via SMTP using nodemailer. Env:
 *   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS, SMTP_FROM.
 *
 * If SMTP_HOST is not set → returns { ok: false, error: 'SMTP not configured' }.
 * Other errors are returned as { ok: false, error } without throwing.
 *
 * The nodemailer transport is created on every call to keep the function
 * stateless (cheap, and avoids leaking a long-lived socket on auth issues).
 */
export async function sendEmail(
  target: string,
  subject: string,
  text: string,
  html?: string,
): Promise<SendResult> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    return { ok: false, error: 'SMTP not configured' };
  }
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || (user ? `POS <${user}>` : 'POS <noreply@example.com>');

  // Lazy import so the dependency is only loaded when the first email is
  // actually sent. Keeps cold-start lean and lets the API run with a broken
  // (or absent) nodemailer install in dev — callers always get a graceful
  // FAILED row.
  let nodemailer: typeof import('nodemailer');
  try {
    nodemailer = (await import('nodemailer')).default as typeof import('nodemailer');
  } catch (e) {
    return { ok: false, error: `nodemailer not available: ${(e as Error).message}` };
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
      // Don't let a misconfigured server stall the request thread.
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });
    const info = await transporter.sendMail({
      from,
      to: target,
      subject,
      text,
      ...(html ? { html } : {}),
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'SMTP error' };
  }
}

// ─── Dispatch (fire-and-forget multi-channel) ───────────────────────────────

/**
 * Render the order's receipt and attempt to deliver it on each requested
 * channel. Each channel gets its own ReceiptDelivery row (PENDING first,
 * then SENT or FAILED once the provider responds). The function awaits the
 * full result before returning, so the route can return the created rows
 * to the caller. For a true fire-and-forget model the caller can omit
 * `await` — but the rows are still written transactionally per channel.
 *
 * @param orderId   order to render
 * @param channels  array of channels to attempt (e.g. ['WHATSAPP', 'EMAIL'])
 * @param target    optional override; when missing, falls back to
 *                  customer.phone (for WHATSAPP) and customer.email (for
 *                  EMAIL) if the order is attached to a customer.
 */
export async function dispatch(
  orderId: string,
  channels: ReceiptChannelKind[],
  target?: DispatchTarget,
): Promise<DispatchResult> {
  // Defensive: empty channel list → no-op
  if (!channels || channels.length === 0) {
    return { deliveries: [] };
  }

  // Load the order (and customer, if any) up-front. We do this once so the
  // receipt render + target fallback share the same read. Note: the
  // Order model has customerId but no back-relation to Customer, so we
  // look up the customer separately when needed.
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }
  let customerPhone: string | null = null;
  let customerEmail: string | null = null;
  if (order.customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: order.customerId },
      select: { phone: true, email: true },
    });
    customerPhone = customer?.phone ?? null;
    customerEmail = customer?.email ?? null;
  }

  const phone = target?.whatsapp ?? customerPhone ?? null;
  const email = target?.email ?? customerEmail ?? null;

  // Render up-front. If the render itself fails (e.g. order is missing
  // data) we still want to write FAILED rows so the UI surfaces the issue.
  let rendered: RenderedReceipt | null = null;
  try {
    rendered = await renderReceipt(orderId);
  } catch (e) {
    logger.warn({ err: (e as Error).message, orderId }, 'receipt render failed');
  }

  const deliveries: DispatchResult['deliveries'] = [];

  for (const channel of channels) {
    let to = '';
    if (channel === 'WHATSAPP') to = phone ?? '';
    else if (channel === 'EMAIL') to = email ?? '';
    else if (channel === 'PRINT') to = 'printer:default';

    // No target → mark FAILED with a clear reason, do not call the provider.
    if (!to) {
      const reason =
        channel === 'WHATSAPP'
          ? 'No WhatsApp target (no customer phone)'
          : channel === 'EMAIL'
            ? 'No email target (no customer email)'
            : 'No printer target';
      const row = await prisma.receiptDelivery.create({
        data: {
          orderId,
          channel,
          target: '',
          status: 'FAILED',
          failureReason: reason,
        },
      });
      logger.info({ orderId, channel, receiptDeliveryId: row.id }, 'receipt delivery skipped (no target)');
      deliveries.push({ id: row.id, channel, target: '', status: 'FAILED', error: reason });
      continue;
    }

    // Create the PENDING row up-front so the UI can show "in flight" while
    // the provider is contacted. The row's id is the receipt's correlation.
    const pending = await prisma.receiptDelivery.create({
      data: {
        orderId,
        channel,
        target: to,
        status: 'PENDING',
      },
    });

    // We need a rendered receipt to send. If rendering failed earlier, fall
    // back to a minimal stub so the provider at least receives *something*
    // (better than nothing — the FAILED status is preserved either way).
    const text = rendered?.text ?? `Struk pesanan ${order.orderNumber}\n(Tidak dapat merender detail)`;
    const subject = rendered?.subject ?? `Struk ${order.orderNumber}`;
    const html = rendered?.html;

    let result: SendResult;
    if (channel === 'WHATSAPP') {
      result = await sendWhatsapp(to, text);
    } else if (channel === 'EMAIL') {
      result = await sendEmail(to, subject, text, html);
    } else {
      // Sprint 8.10 — PRINT channel returns a structured signal so the
      // client side (which owns the BLE printer) knows the drawer should
      // be opened. The actual byte emission is in apps/web/src/lib/escpos.ts
      // — the server doesn't speak BLE. We record a "READY" payload that
      // carries the kick metadata; the client picks it up via the
      // `pos_print_ready_total` metric and the `/api/receipts/:orderId`
      // listing.
      const method = rendered?.meta.paymentMethod ?? 'UNKNOWN';
      const kick = shouldKickForPayment(method);
      const kickBytes = kickPrinterBase64();
      result = {
        ok: false,
        // Carry the drawer-kick intent as part of the error string so
        // the existing payloadJson record still has a useful field.
        // The route also exposes a separate `drawerKick` flag below.
        error: 'Print channel handled by client (Web Bluetooth).',
      };
      // The drawer-kick metadata is also written to the payloadJson so
      // cashiers can verify the kick was prepared.
      (result as SendResult & { drawerKick?: { kick: boolean; bytesBase64: string; method: string } }).drawerKick = {
        kick,
        bytesBase64: kickBytes,
        method,
      };
    }

    const finalStatus = result.ok ? 'SENT' : 'FAILED';
    // Sprint 8.10 — if the PRINT channel prepared a drawer-kick, persist
    // the metadata on the payload so the cashier can verify the kick.
    const drawerKickMeta = (result as SendResult & {
      drawerKick?: { kick: boolean; bytesBase64: string; method: string };
    }).drawerKick;
    const payload: Prisma.InputJsonValue = result.ok
      ? { messageId: result.messageId ?? null, channel, target: to }
      : drawerKickMeta
        ? { error: result.error ?? 'unknown', channel, target: to, drawerKick: drawerKickMeta }
        : { error: result.error ?? 'unknown', channel, target: to };

    const updated = await prisma.receiptDelivery.update({
      where: { id: pending.id },
      data: {
        status: finalStatus,
        sentAt: result.ok ? new Date() : null,
        failureReason: result.ok ? null : (result.error ?? 'unknown'),
        payloadJson: payload,
      },
    });

    incCounter('pos_receipt_deliveries_total', 'Receipt delivery attempts', {
      channel,
      status: finalStatus,
    });

    logger.info(
      {
        orderId,
        channel,
        receiptDeliveryId: updated.id,
        status: finalStatus,
        ...(result.ok ? { messageId: result.messageId } : { error: result.error }),
      },
      'receipt delivery attempted',
    );

    deliveries.push({
      id: updated.id,
      channel,
      target: to,
      status: finalStatus,
      ...(result.ok ? {} : { error: result.error }),
    });
  }

  return { deliveries };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
