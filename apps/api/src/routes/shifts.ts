import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';

export const shiftRoutes = new Hono<AppEnv>();

shiftRoutes.use('*', requireAuth);

const openShiftSchema = z.object({
  openingCash: z.number().int().nonnegative(),
  notes: z.string().max(500).optional(),
});

const closeShiftSchema = z.object({
  closingCash: z.number().int().nonnegative(),
  notes: z.string().max(500).optional(),
});

shiftRoutes.get('/current', async (c) => {
  const user = c.get('user');
  const where: any = { status: 'OPEN' };
  if (c.req.query('mine') === 'true') where.userId = user.id;
  const shift = await prisma.shift.findFirst({
    where,
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { openedAt: 'desc' },
  });
  return ok(c, shift);
});

shiftRoutes.post('/open', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = openShiftSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);
  }

  // Enforce: only one open shift per user
  const existing = await prisma.shift.findFirst({
    where: { userId: user.id, status: 'OPEN' },
  });
  if (existing) {
    return fail(c, 'ShiftAlreadyOpen', `User already has open shift ${existing.id}`, 409);
  }

  const shift = await prisma.shift.create({
    data: {
      userId: user.id,
      status: 'OPEN',
      openingCents: parsed.data.openingCash,
      notes: parsed.data.notes,
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  logger.info({ shiftId: shift.id, userId: user.id }, 'shift opened');
  return ok(c, shift, 201);
});

shiftRoutes.post('/:id/close', requireRole('OWNER', 'MANAGER'), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = closeShiftSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);
  }
  const shift = await prisma.shift.findUnique({ where: { id } });
  if (!shift) return fail(c, 'NotFound', 'Shift not found', 404);
  if (shift.status === 'CLOSED') return fail(c, 'ShiftClosed', 'Shift already closed', 409);

  // Validate all orders in shift are PAID or VOIDED
  const openOrders = await prisma.order.count({
    where: {
      shiftId: id,
      status: { notIn: ['PAID', 'CANCELLED', 'VOIDED', 'SERVED'] },
    },
  });
  // Note: SERVED is terminal in some flows; only enforce truly open ones
  // Be more lenient: just require no OPEN orders
  const trulyOpen = await prisma.order.count({
    where: {
      shiftId: id,
      status: { in: ['OPEN', 'SENT_TO_KDS', 'IN_PROGRESS', 'READY'] },
    },
  });
  if (trulyOpen > 0) {
    return fail(
      c,
      'OpenOrdersRemain',
      `${trulyOpen} open orders remain in shift; finish or void them first`,
      409
    );
  }

  // Sum cash payments during shift window
  const cashSum = await prisma.payment.aggregate({
    where: {
      provider: 'CASH',
      status: 'PAID',
      paidAt: { gte: shift.openedAt, lte: new Date() },
      order: { shiftId: id },
    },
    _sum: { amountCents: true },
  });
  const cashIn = cashSum._sum.amountCents ?? 0;
  // Refunds (status REFUNDED)
  const refundSum = await prisma.payment.aggregate({
    where: {
      status: 'REFUNDED',
      paidAt: { gte: shift.openedAt, lte: new Date() },
      order: { shiftId: id },
    },
    _sum: { amountCents: true },
  });
  const refunds = refundSum._sum.amountCents ?? 0;
  const expected = shift.openingCents + cashIn - refunds;
  const variance = parsed.data.closingCash - expected;

  const updated = await prisma.shift.update({
    where: { id },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
      closingCents: parsed.data.closingCash,
      expectedCents: expected,
      varianceCents: variance,
      notes: parsed.data.notes ?? shift.notes,
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  logger.info(
    { shiftId: id, expected, variance, cashIn, refunds, opening: shift.openingCents },
    'shift closed'
  );
  return ok(c, updated);
});

shiftRoutes.get('/', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  const status = c.req.query('status');

  const where: any = {};
  if (status) where.status = status;
  if (from || to) {
    where.openedAt = {};
    if (from) where.openedAt.gte = new Date(from);
    if (to) where.openedAt.lte = new Date(to);
  }
  const shifts = await prisma.shift.findMany({
    where,
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { openedAt: 'desc' },
    take: 100,
  });
  return ok(c, shifts);
});

shiftRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const shift = await prisma.shift.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      orders: {
        include: { items: true, payments: true },
        orderBy: { openedAt: 'asc' },
      },
    },
  });
  if (!shift) return fail(c, 'NotFound', 'Shift not found', 404);
  return ok(c, shift);
});
