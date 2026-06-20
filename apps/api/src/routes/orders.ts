import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';

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
  const total = subtotal + tax;

  const order = await prisma.order.create({
    data: {
      branchId: user.branchId,
      shiftId: shiftId ?? null,
      orderNumber,
      type: (parsed.data.type as any) ?? 'DINE_IN',
      status: 'OPEN',
      tableNumber: parsed.data.tableNumber,
      customerName: parsed.data.customerName,
      notes: parsed.data.notes,
      subtotalCents: subtotal,
      taxCents: tax,
      totalCents: total,
      openedById: user.id,
      items: { create: lineItems },
    },
    include: { items: true, payments: true },
  });
  logger.info({ orderId: order.id, orderNumber: order.orderNumber, total }, 'order created');
  return ok(c, order, 201);
});

// S1.5 — pay-cash
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
  if (order.status === 'PAID' || order.status === 'CANCELLED' || order.status === 'VOIDED') {
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

  // TODO Sprint 2.3: decrement inventory via recipe in the same transaction
  const updated = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        provider: 'CASH',
        method: 'CASH',
        status: 'PAID',
        amountCents: order.totalCents,
        reference: externalId,
        providerRaw: {
          method: 'CASH',
          amountGiven,
          changeCents,
          cashierId: user.id,
        } as any,
        paidAt: new Date(),
      },
    });
    const ord = await tx.order.update({
      where: { id: order.id },
      data: { status: 'PAID', closedAt: new Date() },
      include: { items: true, payments: true },
    });
    return { ord, payment };
  });

  // Emit order.paid event (Sprint 2 will hook to WebSocket)
  logger.info(
    { orderId: order.id, changeCents, paymentId: updated.payment.id },
    'event: order.paid'
  );

  return ok(c, {
    order: updated.ord,
    payment: updated.payment,
    changeCents,
    amountGiven,
  });
});
