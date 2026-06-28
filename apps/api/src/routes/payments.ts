import { Hono } from 'hono';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, ok, fail } from '../middleware/auth.js';
import { list, get as getProvider } from '../payments/registry.js';
import {
  midtransClientKey,
  midtransSignature,
  type MidtransStatusResponse,
} from '../payments/midtrans.js';
import { getPaymentSetting } from '../services/settings.js';
import { verifyXenditWebhook, type XenditInvoice } from '../payments/xendit.js';
import { finalizeOrderPayment, type FinalizeMethod, type FinalizeProvider } from '../services/payment-finalize.js';
import { logger } from '../logger.js';

export const paymentRoutes = new Hono<AppEnv>();

// IMPORTANT: webhook routes are mounted WITHOUT requireAuth (handled per-route).

// ---------- public: midtrans client key ----------
paymentRoutes.get('/midtrans/client-key', async (c) => {
  return ok(c, await midtransClientKey());
});

// ---------- public: xendit client key (minimal) ----------
paymentRoutes.get('/xendit/public-config', async (c) => {
  return ok(c, {
    publicKey: await getPaymentSetting('XENDIT_PUBLIC_KEY') || null,
    env: process.env.NODE_ENV || 'development',
  });
});

// ---------- public: midtrans webhook ----------
// Verifies the x-signature header (SHA-512 of order_id|status_code|gross_amount|server_key)
// then finalizes the payment if the transaction is settled/captured.
const midtransWebhookBody = z.object({
  transaction_status: z.string(),
  status_code: z.string(),
  gross_amount: z.string(),
  order_id: z.string(),
  transaction_id: z.string().optional(),
  payment_type: z.string().optional(),
  fraud_status: z.string().optional(),
  signature_key: z.string().optional(),
});

paymentRoutes.post('/midtrans/webhook', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = midtransWebhookBody.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid webhook payload', 400, parsed.error.issues);
  }
  const { transaction_status, status_code, gross_amount, order_id } = parsed.data;

  // Verify signature
  const providedSig =
    c.req.header('x-signature') || c.req.header('X-Signature') || parsed.data.signature_key;
  if (!providedSig) {
    return fail(c, 'SignatureMissing', 'Missing Midtrans signature', 401);
  }
  const expected = await midtransSignature(order_id, status_code, gross_amount);
  if (expected !== providedSig) {
    logger.warn({ order_id }, 'midtrans webhook signature mismatch');
    return fail(c, 'SignatureInvalid', 'Signature mismatch', 401);
  }

  // Find the original payment row by reference (= orderId, since we use the
  // provider's external id, but the row was created with reference=token or
  // reference=order_id; we look it up by orderId).
  const payment = await prisma.payment.findFirst({
    where: { orderId: order_id },
    orderBy: { createdAt: 'desc' },
  });
  if (!payment) {
    return fail(c, 'PaymentNotFound', `No payment for order ${order_id}`, 404);
  }

  // Map status
  const statusMap: Record<string, string> = {
    settlement: 'PAID',
    capture: 'PAID',
    cancel: 'CANCELLED',
    expire: 'EXPIRED',
    deny: 'FAILED',
    refund: 'REFUNDED',
  };
  const newStatus = statusMap[transaction_status] || 'PENDING';

  if (newStatus === 'PAID' && payment.status !== 'PAID') {
    // Finalize: close order, deduct inventory. Use a method inferred from
    // the original payment row.
    const method = (payment.method as FinalizeMethod) || 'QRIS';
    try {
      const finalized = await finalizeOrderPayment({
        orderId: order_id,
        userId: payment.orderId, // system-driven; closedById may not be a real user
        payment: {
          provider: 'MIDTRANS',
          method,
          externalId: payment.reference || order_id,
          amountCents: payment.amountCents,
        },
        providerRaw: body as Prisma.InputJsonValue,
      });
      // The service creates its own Payment row with status=PAID. The old
      // PENDING row from /charge becomes a record-of-attempt.
      logger.info(
        { orderId: order_id, paymentId: finalized.payment.id },
        'midtrans webhook finalized order'
      );
      return c.json({ data: { ok: true, orderId: order_id, status: 'PAID' } });
    } catch (e: any) {
      logger.error({ err: e, orderId: order_id }, 'midtrans finalize failed');
      return fail(c, 'FinalizeFailed', e?.message || 'Finalize failed', 500);
    }
  }

  // For non-PAID transitions, just update the existing payment row.
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: newStatus as any,
      providerRaw: body as Prisma.InputJsonValue,
      paidAt: newStatus === 'PAID' ? new Date() : payment.paidAt,
    },
  });

  return c.json({ data: { ok: true, orderId: order_id, status: newStatus } });
});

// ---------- public: midtrans cancel by external id ----------
paymentRoutes.post('/midtrans/cancel/:externalId', async (c) => {
  const externalId = c.req.param('externalId');
  const provider = getProvider('MIDTRANS');
  if (!provider) return fail(c, 'ProviderNotFound', 'MIDTRANS not registered', 500);
  try {
    const r = await provider.cancel(externalId);
    return ok(c, r);
  } catch (e: any) {
    return fail(c, 'CancelFailed', e?.message || 'Cancel failed', 502);
  }
});

// ---------- public: xendit webhook ----------
const xenditWebhookBody = z.object({
  id: z.string(),
  external_id: z.string().optional(),
  status: z.string(),
  amount: z.number().optional(),
  paid_at: z.string().optional(),
  payment_method: z.string().optional(),
  payment_channel: z.string().optional(),
});

paymentRoutes.post('/xendit/webhook', async (c) => {
  const token = c.req.header('x-callback-token');
  const okSig = await verifyXenditWebhook(token);
  if (!okSig) {
    return fail(c, 'SignatureInvalid', 'Invalid x-callback-token', 401);
  }
  const body = (await c.req.json().catch(() => ({}))) as Partial<XenditInvoice>;
  const parsed = xenditWebhookBody.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid webhook payload', 400, parsed.error.issues);
  }
  const { id, external_id, status } = parsed.data;
  const orderId = external_id || id;

  const payment = await prisma.payment.findFirst({
    where: { orderId, reference: id },
    orderBy: { createdAt: 'desc' },
  });
  if (!payment) {
    return c.json({ data: { ok: true, ignored: 'no matching payment' } });
  }

  if ((status === 'PAID' || status === 'SETTLED') && payment.status !== 'PAID') {
    try {
      const method = (payment.method as FinalizeMethod) || 'VIRTUAL_ACCOUNT';
      const finalized = await finalizeOrderPayment({
        orderId,
        userId: orderId,
        payment: {
          provider: 'XENDIT',
          method,
          externalId: id,
          amountCents: payment.amountCents,
        },
        providerRaw: body as Prisma.InputJsonValue,
      });
      logger.info({ orderId, paymentId: finalized.payment.id }, 'xendit webhook finalized order');
      return c.json({ data: { ok: true, orderId, status: 'PAID' } });
    } catch (e: any) {
      logger.error({ err: e, orderId }, 'xendit finalize failed');
      return fail(c, 'FinalizeFailed', e?.message || 'Finalize failed', 500);
    }
  }

  const statusMap: Record<string, string> = {
    PAID: 'PAID',
    SETTLED: 'PAID',
    EXPIRED: 'EXPIRED',
    INACTIVE: 'CANCELLED',
    PENDING: 'PENDING',
  };
  const newStatus = statusMap[status] || 'PENDING';
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: newStatus as any,
      providerRaw: body as Prisma.InputJsonValue,
      paidAt: newStatus === 'PAID' ? new Date() : payment.paidAt,
    },
  });
  return c.json({ data: { ok: true, orderId, status: newStatus } });
});

// ---------- public: xendit cancel ----------
paymentRoutes.post('/xendit/cancel/:externalId', async (c) => {
  const externalId = c.req.param('externalId');
  const provider = getProvider('XENDIT');
  if (!provider) return fail(c, 'ProviderNotFound', 'XENDIT not registered', 500);
  try {
    const r = await provider.cancel(externalId);
    return ok(c, r);
  } catch (e: any) {
    return fail(c, 'CancelFailed', e?.message || 'Cancel failed', 502);
  }
});

// ---------- authenticated routes below ----------
paymentRoutes.use('*', requireAuth);

paymentRoutes.get('/providers', (c) => {
  const providers = list().map((p) => ({ name: p.name, methods: getMethodsFor(p.name) }));
  return ok(c, providers);
});

function getMethodsFor(providerName: string): string[] {
  if (providerName === 'CASH') return ['CASH'];
  if (providerName === 'MIDTRANS') return ['QRIS', 'VIRTUAL_ACCOUNT', 'EWALLET'];
  if (providerName === 'XENDIT') return ['VIRTUAL_ACCOUNT', 'EWALLET', 'QRIS'];
  return [];
}

const chargeSchema = z.object({
  orderId: z.string().min(1),
  provider: z.enum(['CASH', 'MIDTRANS', 'XENDIT']),
  method: z.enum(['CASH', 'QRIS', 'VIRTUAL_ACCOUNT', 'EWALLET']),
  amount: z.number().int().positive(),
  customer: z
    .object({
      name: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

paymentRoutes.post('/charge', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = chargeSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid charge payload', 400, parsed.error.issues);
  }
  const { orderId, provider, method, amount, customer, metadata } = parsed.data;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: true },
  });
  if (!order) return fail(c, 'OrderNotFound', 'Order not found', 404);
  if (order.status === 'PAID' || order.status === 'CANCELLED' || order.status === 'VOIDED' || order.status === 'REFUNDED') {
    return fail(c, 'OrderClosed', `Order is ${order.status}`, 409);
  }
  if (amount !== order.totalCents) {
    return fail(
      c,
      'AmountMismatch',
      `Amount ${amount} does not match order total ${order.totalCents}`,
      400
    );
  }

  const providerImpl = getProvider(provider);
  if (!providerImpl) return fail(c, 'ProviderNotFound', `Provider ${provider} not registered`, 400);

  try {
    const result = await providerImpl.charge({
      orderId,
      amount,
      method: method as FinalizeMethod,
      customerName: customer?.name || order.customerName || undefined,
      customerEmail: customer?.email,
      customerPhone: customer?.phone,
      metadata,
    });

    const payment = await prisma.payment.create({
      data: {
        orderId,
        provider,
        method: method as any,
        status: result.status as any,
        amountCents: amount,
        reference: result.externalId,
        providerRaw: (result.raw as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        paidAt: result.status === 'PAID' ? new Date() : null,
      },
    });

    if (result.status === 'PAID') {
      // Cash: finalize immediately (also deducts inventory)
      if (provider === 'CASH') {
        const finalized = await finalizeOrderPayment({
          orderId,
          userId: order.openedById,
          payment: {
            provider: 'CASH',
            method: 'CASH',
            externalId: result.externalId,
            amountCents: amount,
          },
          providerRaw: (result.raw as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        });
        return ok(c, { payment: finalized.payment, result, lowStockAlerts: finalized.lowStockAlerts }, 201);
      }
    }

    return ok(c, { payment, result }, 201);
  } catch (e: any) {
    logger.error({ err: e, orderId, provider }, 'charge failed');
    return fail(c, 'ChargeFailed', e?.message || 'Provider charge failed', 502);
  }
});
