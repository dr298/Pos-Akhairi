import type {
  PaymentProvider,
  PaymentRequest,
  PaymentResult,
  PaymentResultStatus,
} from './types.js';
import { getPaymentSetting } from '../services/settings.js';

/**
 * Midtrans Snap provider.
 *
 * Production requires real MIDTRANS_SERVER_KEY / MIDTRANS_CLIENT_KEY in
 * .env. The dummy keys below will cause the upstream API to return 401
 * (or a sandbox error), but the code path — request shape, signature
 * verification, status mapping, cancel — is complete and tested.
 *
 * Docs:
 *   - Snap transaction create: https://snap-docs.midtrans.com/#request-body
 *   - Signature key:           SHA-512(order_id + status_code + gross_amount + server_key)
 *   - Sandbox base:            https://app.sandbox.midtrans.com
 *   - Production base:         https://app.midtrans.com
 */

const SANDBOX_BASE = 'https://app.sandbox.midtrans.com';
const PROD_BASE = 'https://app.midtrans.com';
const CORE_SANDBOX = 'https://api.sandbox.midtrans.com';
const CORE_PROD = 'https://api.midtrans.com';

async function baseUrl(): Promise<{ snap: string; core: string }> {
  const env = (await getPaymentSetting('MIDTRANS_ENV') || 'sandbox').toLowerCase();
  if (env === 'production' || env === 'prod') {
    return { snap: PROD_BASE, core: CORE_PROD };
  }
  return { snap: SANDBOX_BASE, core: CORE_SANDBOX };
}

async function serverKey(): Promise<string> {
  const key = await getPaymentSetting('MIDTRANS_SERVER_KEY');
  if (!key) {
    throw new Error('MIDTRANS_SERVER_KEY is required (set via Settings table or env var)');
  }
  return key;
}

function getWebOrigin(): string {
  if (!process.env.WEB_ORIGIN) {
    throw new Error('WEB_ORIGIN environment variable is required for payment provider redirects');
  }
  return process.env.WEB_ORIGIN;
}

async function basicAuthHeader(): Promise<string> {
  const key = await serverKey();
  // Midtrans uses HTTP Basic with server_key as username, empty password.
  return 'Basic ' + Buffer.from(key + ':').toString('base64');
}

export type MidtransSnapResponse = {
  token: string;
  redirect_url: string;
};

export type MidtransStatusResponse = {
  transaction_status:
    | 'capture'
    | 'settlement'
    | 'pending'
    | 'deny'
    | 'cancel'
    | 'expire'
    | 'refund'
    | 'partial_refund'
    | 'chargeback'
    | 'partial_chargeback'
    | 'authorize';
  status_code: string;
  gross_amount: string;
  payment_type?: string;
  transaction_id?: string;
  transaction_time?: string;
  settlement_time?: string;
  fraud_status?: string;
};

export function mapMidtransStatus(s: MidtransStatusResponse['transaction_status']): PaymentResultStatus {
  if (s === 'capture' || s === 'settlement' || s === 'authorize') return 'PAID';
  if (s === 'cancel' || s === 'deny') return 'CANCELLED';
  if (s === 'expire') return 'EXPIRED';
  if (s === 'refund' || s === 'partial_refund') return 'EXPIRED'; // refund flow uses different status
  return 'PENDING';
}

/**
 * Build the callback signature: SHA-512(order_id + status_code + gross_amount + server_key).
 * Hex digest, lowercase.
 */
export async function midtransSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  key?: string,
): Promise<string> {
  const crypto = await import('node:crypto');
  const resolvedKey = key ?? await serverKey();
  return crypto
    .createHash('sha512')
    .update(`${orderId}${statusCode}${grossAmount}${resolvedKey}`)
    .digest('hex');
}

export const midtransProvider: PaymentProvider = {
  name: 'MIDTRANS',
  async charge(req: PaymentRequest): Promise<PaymentResult> {
    const { snap } = await baseUrl();
    const body = {
      transaction_details: {
        order_id: req.orderId,
        gross_amount: req.amount,
      },
      customer_details: {
        first_name: req.customerName || 'Customer',
        email: req.customerEmail,
        phone: req.customerPhone,
      },
      callbacks: {
        finish: `${getWebOrigin()}/orders/${req.orderId}/finish`,
        error: `${getWebOrigin()}/orders/${req.orderId}/error`,
        pending: `${getWebOrigin()}/orders/${req.orderId}/pending`,
      },
    };

    const res = await fetch(`${snap}/snap/v1/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: await basicAuthHeader(),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Midtrans Snap charge failed: ${res.status} ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as MidtransSnapResponse;
    return {
      status: 'PENDING',
      externalId: data.token,
      paymentUrl: data.redirect_url,
      raw: data,
    };
  },
  async getStatus(externalId: string): Promise<PaymentResult> {
    const { core } = await baseUrl();
    const res = await fetch(`${core}/v2/transactions/${encodeURIComponent(externalId)}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: await basicAuthHeader(),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Midtrans getStatus failed: ${res.status} ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as MidtransStatusResponse;
    return {
      status: mapMidtransStatus(data.transaction_status),
      externalId: data.transaction_id || externalId,
      raw: data,
    };
  },
  async cancel(externalId: string): Promise<{ ok: boolean }> {
    const { core } = await baseUrl();
    const res = await fetch(`${core}/v2/transactions/${encodeURIComponent(externalId)}/cancel`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: await basicAuthHeader(),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // 404 means transaction not found; treat as already-cancelled.
      if (res.status === 404) return { ok: true };
      throw new Error(`Midtrans cancel failed: ${res.status} ${text.slice(0, 300)}`);
    }
    return { ok: true };
  },
};

export async function midtransClientKey(): Promise<{ clientKey: string; env: string }> {
  return {
    clientKey: await getPaymentSetting('MIDTRANS_CLIENT_KEY'),
    env: (await getPaymentSetting('MIDTRANS_ENV') || 'sandbox').toLowerCase(),
  };
}
