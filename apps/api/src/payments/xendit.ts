import type {
  PaymentProvider,
  PaymentRequest,
  PaymentResult,
  PaymentResultStatus,
} from './types.js';

/**
 * Xendit Invoice provider.
 *
 * Production requires real XENDIT_SECRET_KEY in .env. The dummy key
 * below will cause the upstream API to reject the request (401), but
 * the code path — request shape, webhook verification, status mapping,
 * invoice expire — is complete and tested.
 *
 * Docs:
 *   - Create invoice: https://developers.xendit.co/api-reference/#create-invoice
 *   - Get invoice:    https://developers.xendit.co/api-reference/#get-invoice-by-id
 *   - Expire invoice: https://developers.xendit.co/api-reference/#expire-invoice
 *   - Webhook verify: header x-callback-token must equal secret
 *
 * Xendit uses the same base URL for sandbox and production; keys gate
 * access. The "development" key prefix (xnd_development_) only works
 * against sandbox.
 */

const BASE = 'https://api.xendit.co';

function secretKey(): string {
  return process.env.XENDIT_SECRET_KEY || '';
}

function basicAuthHeader(): string {
  // Xendit uses HTTP Basic with secret_key as username, empty password.
  return 'Basic ' + Buffer.from(secretKey() + ':').toString('base64');
}

export type XenditInvoice = {
  id: string;
  external_id: string;
  user_id?: string;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'INACTIVE' | 'SETTLED';
  amount: number;
  payer_email?: string;
  description?: string;
  invoice_url: string;
  expiry_date?: string;
  created?: string;
  updated?: string;
  currency?: string;
  payment_method?: string;
  payment_channel?: string;
  paid_at?: string;
};

function getWebOrigin(): string {
  if (!process.env.WEB_ORIGIN) {
    throw new Error('WEB_ORIGIN environment variable is required for payment provider redirects');
  }
  return process.env.WEB_ORIGIN;
}

export function mapXenditStatus(s: XenditInvoice['status']): PaymentResultStatus {
  if (s === 'PAID' || s === 'SETTLED') return 'PAID';
  if (s === 'EXPIRED' || s === 'INACTIVE') return 'EXPIRED';
  return 'PENDING';
}

export const xenditProvider: PaymentProvider = {
  name: 'XENDIT',
  async charge(req: PaymentRequest): Promise<PaymentResult> {
    const body = {
      external_id: req.orderId,
      amount: req.amount,
      payer_email: req.customerEmail || 'customer@example.com',
      description: `POS order ${req.orderId}`,
      // success/failure redirect URLs intentionally omitted — Xendit shows
      // its own hosted payment result page. POS-side polling detects PAID
      // on the cashier's screen. Customer-facing redirect pages can be
      // added later when needed (e.g. for online ordering).
    };
    const res = await fetch(`${BASE}/v2/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: basicAuthHeader(),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Xendit create invoice failed: ${res.status} ${text.slice(0, 300)}`);
    }
    const inv = (await res.json()) as XenditInvoice;
    return {
      status: 'PENDING',
      externalId: inv.id,
      paymentUrl: inv.invoice_url,
      expiresAt: inv.expiry_date ? new Date(inv.expiry_date) : undefined,
      raw: inv,
    };
  },
  async getStatus(externalId: string): Promise<PaymentResult> {
    const res = await fetch(`${BASE}/v2/invoices/${encodeURIComponent(externalId)}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: basicAuthHeader(),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Xendit getStatus failed: ${res.status} ${text.slice(0, 300)}`);
    }
    const inv = (await res.json()) as XenditInvoice;
    return {
      status: mapXenditStatus(inv.status),
      externalId: inv.id,
      paymentUrl: inv.invoice_url,
      raw: inv,
    };
  },
  async cancel(externalId: string): Promise<{ ok: boolean }> {
    const res = await fetch(`${BASE}/invoices/${encodeURIComponent(externalId)}/expire`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: basicAuthHeader(),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 404) return { ok: true };
      throw new Error(`Xendit expire failed: ${res.status} ${text.slice(0, 300)}`);
    }
    return { ok: true };
  },
};

/**
 * Verify a Xendit webhook by comparing the x-callback-token header
 * against the configured secret. Constant-time comparison.
 */
export async function verifyXenditWebhook(providedToken: string | null | undefined): Promise<boolean> {
  const crypto = await import('node:crypto');
  const expected = process.env.XENDIT_WEBHOOK_SECRET || '';
  if (!expected || !providedToken) return false;
  const a = Buffer.from(providedToken);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
