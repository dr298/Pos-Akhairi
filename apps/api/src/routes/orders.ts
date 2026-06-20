import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { computeDiscount } from './discounts.js';
import { finalizeOrderPayment, restoreInventoryForOrder } from '../services/payment-finalize.js';

export const orderRoutes = new Hono<AppEnv>();

orderRoutes.use('*', requireAuth);

const orderItemSchema = z.object({
  menuItemId: z.string().min(1),
  quantity: z.number().int().positive(),
  notes: z.string().max(200).optional(),
  modifiersJson: z.record(z.string(), z.unknown()).optional(),
});

const orderCreateSchema = z.object({
  type: z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY']).optional(),
  tableNumber: z.string().max(20).optional(),
  customerName: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
  shiftId: z.string().optional(),
  discountCode: z.string().min(1).max(50).optional(),
  discountId: z.string().optional(),
  items: z.array(orderItemSchema).min(1),
});

async function nextOrderNumber(branchId: string): Promise<string> {
  const today = new Date();
  const ymd =
    today.getFullYear().toString() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');
  const prefix = `ORD-${ymd}-`;
  const last = await prisma.order.findFirst({
    where: { branchId, orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: 'desc' },
  });
  let seq = 1;
  if (last) {
    const n = parseInt(last.orderNumber.slice(prefix.length), 10);
    if (!isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

async function loadActiveShift(userId: string, branchId: string) {
  return prisma.shift.findFirst({
    where: { userId, branchId, status: 'OPEN' },
  });
}

orderRoutes.get('/', async (c) => {
  const user = c.get('user');
  const status = c.req.query('status');
  const branchId = c.req.query('branchId') || user.branchId;
  if (!branchId) return fail(c, 'NoBranch', 'No branch context', 400);
  const orders = await prisma.order.findMany({
    where: {
      branchId,
      ...(status ? { status: status as any } : {}),
    },
    include: { items: true, payments: true },
    orderBy: { openedAt: 'desc' },
    take: 50,
  });
  return ok(c, orders);
});

orderRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, payments: true, shift: true, openedBy: true },
  });
  if (!order) return fail(c, 'NotFound', 'Order not found', 404);
  return ok(c, order);
});

orderRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = orderCreateSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid order payload', 400, parsed.error.issues);
  }
  if (!user.branchId) return fail(c, 'NoBranch', 'User has no branch', 400);

  const menuIds = parsed.data.items.map((i) => i.menuItemId);
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: menuIds }, branchId: user.branchId, isActive: true },
  });
  const menuMap = new Map(menuItems.map((m) => [m.id, m]));
  for (const it of parsed.data.items) {
    if (!menuMap.has(it.menuItemId)) {
      return fail(c, 'MenuItemNotFound', `Menu item ${it.menuItemId} not in this branch`, 400);
    }
  }

  // Optionally attach to active shift
  let shiftId = parsed.data.shiftId;
  if (!shiftId) {
    const shift = await loadActiveShift(user.id, user.branchId);
    if (shift) shiftId = shift.id;
  }

  const orderNumber = await nextOrderNumber(user.branchId);
  let subtotal = 0;
  let tax = 0;
  const lineItems = parsed.data.items.map((it) => {
    const m = menuMap.get(it.menuItemId)!;
    const lineTotal = m.priceCents * it.quantity;
    subtotal += lineTotal;
    // tax per line: floor(lineTotal * rateBp / 10000)
    tax += Math.floor((lineTotal * m.taxRateBp) / 10000);
    return {
      menuItemId: m.id,
      nameSnapshot: m.name,
      priceCents: m.priceCents,
      quantity: it.quantity,
      notes: it.notes,
      modifiersJson: it.modifiersJson as any,
      lineTotalCents: lineTotal,
    };
  });

  // Discount resolution (S2.5)
  let discountId: string | null = null;
  let discountCents = 0;
  if (parsed.data.discountCode || parsed.data.discountId) {
    const d = await prisma.discount.findFirst({
      where: {
        branchId: user.branchId,
        ...(parsed.data.discountId
          ? { id: parsed.data.discountId }
          : { code: parsed.data.discountCode! }),
      },
    });
    const result = computeDiscount(d, subtotal);
    if (!result.valid) {
      return fail(c, 'DiscountInvalid', result.reason || 'Discount not applicable', 400);
    }
    discountId = result.discountId!;
    discountCents = result.discountCents;
  }
  // total = subtotal + tax - discount (clamp at 0)
  const total = Math.max(0, subtotal + tax - discountCents);

  const branchId = user.branchId!; // narrowed by the check above
  const order = await prisma.$transaction(async (tx) => {
    const ord = await tx.order.create({
      data: {
        branchId,
        shiftId: shiftId ?? undefined,
        orderNumber,
        type: (parsed.data.type as any) ?? 'DINE_IN',
        status: 'OPEN',
        tableNumber: parsed.data.tableNumber,
        customerName: parsed.data.customerName,
        notes: parsed.data.notes,
        subtotalCents: subtotal,
        taxCents: tax,
        discountCents,
        ...(discountId ? { discountId } : {}),
        totalCents: total,
        openedById: user.id,
        items: { create: lineItems },
      },
      include: { items: true, payments: true },
    });
    if (discountId) {
      await tx.discount.update({
        where: { id: discountId },
        data: { usageCount: { increment: 1 } },
      });
    }
    return ord;
  });

  logger.info(
    { orderId: order.id, orderNumber: order.orderNumber, total, discountCents },
    'order created'
  );
  return ok(c, order, 201);
});

// S1.5 — pay-cash (refactored S2.2 to use finalizeOrderPayment for inventory deduction)
const payCashSchema = z.object({
  amountGiven: z.number().int().positive(),
});

orderRoutes.post('/:id/pay-cash', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = payCashSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);
  }
  const { amountGiven } = parsed.data;

  const order = await prisma.order.findUnique({ where: { id }, include: { payments: true } });
  if (!order) return fail(c, 'NotFound', 'Order not found', 404);
  if (order.status === 'PAID' || order.status === 'CANCELLED' || order.status === 'VOIDED' || order.status === 'REFUNDED') {
    return fail(c, 'OrderClosed', `Order is ${order.status}`, 409);
  }
  if (amountGiven < order.totalCents) {
    return fail(
      c,
      'InsufficientCash',
      `Amount given ${amountGiven} < order total ${order.totalCents}`,
      400
    );
  }
  const changeCents = amountGiven - order.totalCents;
  const externalId = `CASH-${order.id}-${Math.random().toString(36).slice(2, 10)}`;

  try {
    const finalized = await finalizeOrderPayment({
      orderId: order.id,
      userId: user.id,
      payment: {
        provider: 'CASH',
        method: 'CASH',
        externalId,
        amountCents: order.totalCents,
      },
      providerRaw: {
        method: 'CASH',
        amountGiven,
        changeCents,
        cashierId: user.id,
      },
    });
    return ok(c, {
      order: finalized.order,
      payment: finalized.payment,
      changeCents,
      amountGiven,
      lowStockAlerts: finalized.lowStockAlerts,
    });
  } catch (e: any) {
    logger.error({ err: e, orderId: id }, 'pay-cash finalize failed');
    return fail(c, 'FinalizeFailed', e?.message || 'Payment finalization failed', 500);
  }
});

// S2.4 — void an OPEN order
const voidSchema = z.object({
  reason: z.string().min(1).max(500),
});

orderRoutes.post('/:id/void', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = voidSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);
  }
  const { reason } = parsed.data;

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return fail(c, 'NotFound', 'Order not found', 404);
  if (order.status !== 'OPEN') {
    return fail(c, 'OrderNotVoidable', `Only OPEN orders can be voided (current: ${order.status})`, 409);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const o = await tx.order.update({
      where: { id },
      data: {
        status: 'VOIDED',
        voidedAt: new Date(),
        voidedById: user.id,
        voidReason: reason,
      },
      include: { items: true, payments: true },
    });
    return o;
  });

  logger.info({ orderId: id, reason, by: user.id }, 'order voided');
  return ok(c, updated);
});

// S2.4 — refund a PAID order
const refundSchema = z.object({
  reason: z.string().min(1).max(500),
  refundMethod: z.enum(['CASH', 'ORIGINAL']).default('CASH'),
});

orderRoutes.post('/:id/refund', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = refundSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);
  }
  const { reason, refundMethod } = parsed.data;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { payments: true },
  });
  if (!order) return fail(c, 'NotFound', 'Order not found', 404);
  if (order.status !== 'PAID') {
    return fail(c, 'OrderNotRefundable', `Only PAID orders can be refunded (current: ${order.status})`, 409);
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      let refundPaymentId: string | null = null;
      if (refundMethod === 'CASH') {
        const ref = `REFUND-${id}-${Math.random().toString(36).slice(2, 10)}`;
        const refundPayment = await tx.payment.create({
          data: {
            orderId: id,
            provider: 'CASH',
            method: 'CASH',
            status: 'PAID',
            amountCents: -order.totalCents,
            reference: ref,
            providerRaw: { refund: true, method: 'CASH', cashierId: user.id } as any,
            paidAt: new Date(),
          },
        });
        refundPaymentId = refundPayment.id;
      } else {
        // Mark the original payment as REFUNDED
        const original = order.payments.find((p) => p.status === 'PAID');
        if (original) {
          await tx.payment.update({
            where: { id: original.id },
            data: { status: 'REFUNDED' },
          });
          refundPaymentId = original.id;
        }
      }
      return tx.order.update({
        where: { id },
        data: {
          status: 'REFUNDED',
          refundedAt: new Date(),
          refundedById: user.id,
          refundReason: reason,
          refundMethod,
          refundPaymentId,
        },
        include: { items: true, payments: true },
      });
    });

    // Restore inventory outside the main transaction so a stock
    // restoration failure doesn't roll back the refund itself.
    try {
      await restoreInventoryForOrder(id);
    } catch (e) {
      logger.warn({ err: e, orderId: id }, 'inventory restore failed (non-fatal)');
    }

    logger.info({ orderId: id, refundMethod, by: user.id }, 'order refunded');
    return ok(c, updated);
  } catch (e: any) {
    logger.error({ err: e, orderId: id }, 'refund failed');
    return fail(c, 'RefundFailed', e?.message || 'Refund failed', 500);
  }
});
