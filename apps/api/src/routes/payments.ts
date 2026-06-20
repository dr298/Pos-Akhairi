import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, ok, fail } from '../middleware/auth.js';
import { list, get as getProvider } from '../payments/registry.js';

export const paymentRoutes = new Hono<AppEnv>();

paymentRoutes.use('*', requireAuth);

paymentRoutes.get('/providers', (c) => {
  const providers = list().map((p) => ({ name: p.name, methods: getMethodsFor(p.name) }));
  return ok(c, providers);
});

function getMethodsFor(providerName: string): string[] {
  if (providerName === 'CASH') return ['CASH'];
  return [];
}

const chargeSchema = z.object({
  orderId: z.string().min(1),
  provider: z.literal('CASH'),
  method: z.literal('CASH'),
  amount: z.number().int().positive(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

paymentRoutes.post('/charge', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = chargeSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid charge payload', 400, parsed.error.issues);
  }
  const { orderId, provider, method, amount, metadata } = parsed.data;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: true },
  });
  if (!order) return fail(c, 'OrderNotFound', 'Order not found', 404);
  if (order.status === 'PAID' || order.status === 'CANCELLED' || order.status === 'VOIDED') {
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

  const result = await providerImpl.charge({
    orderId,
    amount,
    method,
    customerName: order.customerName || undefined,
    metadata,
  });

  const payment = await prisma.payment.create({
    data: {
      orderId,
      provider,
      method,
      status: result.status === 'PAID' ? 'PAID' : 'PENDING',
      amountCents: amount,
      reference: result.externalId,
      providerRaw: (result.raw as any) ?? undefined,
      paidAt: result.status === 'PAID' ? new Date() : null,
    },
  });

  if (result.status === 'PAID') {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'PAID', closedAt: new Date() },
    });
  }

  return ok(c, { payment, result }, 201);
});
