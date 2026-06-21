// apps/api/src/routes/customers.ts
//
// Sprint 8.8 — Customer / Member + Loyalty routes.
//
// Endpoints (all require auth):
//   GET    /api/customers?search=Q&limit=50
//   GET    /api/customers/:id
//   POST   /api/customers                          (CASHIER+)
//   PATCH  /api/customers/:id                      (CASHIER+)
//   POST   /api/customers/:id/loyalty              (OWNER, MANAGER) manual adjust
//   GET    /api/customers/:id/balance
//   POST   /api/customers/lookup                   (body: { phone })
//
// Indonesian UI strings are used in error messages for staff-facing flows.

import { Hono } from 'hono';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@pos/db';
import {
  AppEnv,
  requireAuth,
  requireRole,
  ok,
  fail,
} from '../middleware/auth.js';
import { logger } from '../logger.js';
import { incCounter } from '../middleware/metrics.js';
import {
  getBalance,
  manualAdjust,
  redeem,
} from '../services/loyalty.js';

export const customerRoutes = new Hono<AppEnv>();

customerRoutes.use('*', requireAuth);

// ─── helpers ───────────────────────────────────────────────────────────────

/** Normalize a phone string for comparison: strip spaces, dashes, parens. */
function normalizePhone(p: string): string {
  return p.replace(/[\s\-\(\)\+]/g, '');
}

// ─── list ──────────────────────────────────────────────────────────────────

customerRoutes.get('/', async (c) => {
  const search = c.req.query('search')?.trim();
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);
  const includeInactive = c.req.query('includeInactive') === 'true';

  const where: Prisma.CustomerWhereInput = { isActive: includeInactive ? undefined : true };
  if (search && search.length > 0) {
    const phoneQ = normalizePhone(search);
    where.AND = [
      {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: phoneQ } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      },
    ];
  }

  const customers = await prisma.customer.findMany({
    where,
    orderBy: [{ lastVisitAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });
  return ok(c, customers);
});

// ─── detail (with loyalty tx history) ──────────────────────────────────────

customerRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const txLimit = Math.min(Math.max(parseInt(c.req.query('txLimit') || '50', 10) || 50, 1), 200);

  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) return fail(c, 'NotFound', 'Pelanggan tidak ditemukan', 404);

  const loyaltyTransactions = await prisma.loyaltyTransaction.findMany({
    where: { customerId: id },
    orderBy: { createdAt: 'desc' },
    take: txLimit,
  });

  return ok(c, { ...customer, loyaltyTransactions });
});

// ─── create ───────────────────────────────────────────────────────────────

const createSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    phone: z.string().min(3).max(30).optional(),
    email: z.string().email().max(200).optional(),
    birthday: z
      .string()
      .datetime()
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .optional(),
    address: z.string().max(500).optional(),
    notes: z.string().max(1000).optional(),
  })
  .refine((o) => Boolean(o.phone) || Boolean(o.email), {
    message: 'phone atau email wajib diisi',
  });

customerRoutes.post('/', requireRole('CASHIER', 'MANAGER', 'OWNER'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);
  }
  const data = parsed.data;

  // De-dup: if a customer with the same phone or email already exists,
  // return it (idempotent) instead of erroring. Lookup matches
  // phone (normalized) OR email case-insensitively.
  const phoneNorm = data.phone ? normalizePhone(data.phone) : null;
  const existing = await prisma.customer.findFirst({
    where: {
      OR: [
        ...(phoneNorm ? [{ phone: phoneNorm }, { phone: data.phone }] : []),
        ...(data.email ? [{ email: { equals: data.email, mode: 'insensitive' as const } }] : []),
      ],
    },
  });
  if (existing) {
    return ok(c, existing, 200);
  }

  const customer = await prisma.customer.create({
    data: {
      name: data.name,
      phone: phoneNorm ?? data.phone,
      email: data.email,
      birthday: data.birthday ? new Date(data.birthday) : null,
      address: data.address,
      notes: data.notes,
    },
  });

  // Best-effort signup bonus (if the global LoyaltyConfig grants one).
  // Failures here are non-fatal — the customer is created either way.
  try {
    const cfg = await prisma.loyaltyConfig.findFirst();
    if (cfg && cfg.isActive && cfg.signupBonusPoints > 0) {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.loyaltyTransaction.create({
          data: {
            customerId: customer.id,
            type: 'BONUS',
            pointsDelta: cfg.signupBonusPoints,
            notes: 'Bonus pendaftaran',
            createdById: user.id,
          },
        });
        await tx.customer.update({
          where: { id: customer.id },
          data: { loyaltyPoints: { increment: cfg.signupBonusPoints } },
        });
      });
      incCounter('pos_loyalty_signup_bonus_total', 'Signup bonus awarded');
    }
  } catch (e) {
    logger.warn({ err: (e as Error).message, customerId: customer.id }, 'signup bonus failed (non-fatal)');
  }

  logger.info({ customerId: customer.id, by: user.id }, 'customer created');
  return ok(c, customer, 201);
});

// ─── update ────────────────────────────────────────────────────────────────

const updateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    phone: z.string().min(3).max(30).optional(),
    email: z.string().email().max(200).nullable().optional(),
    birthday: z
      .string()
      .datetime()
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .nullable()
      .optional(),
    address: z.string().max(500).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Empty update payload' });

customerRoutes.patch('/:id', requireRole('CASHIER', 'MANAGER', 'OWNER'), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);
  }
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) return fail(c, 'NotFound', 'Pelanggan tidak ditemukan', 404);

  const data: Prisma.CustomerUpdateInput = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.phone !== undefined) data.phone = normalizePhone(parsed.data.phone);
  if (parsed.data.email !== undefined) data.email = parsed.data.email;
  if (parsed.data.birthday !== undefined) {
    data.birthday = parsed.data.birthday ? new Date(parsed.data.birthday) : null;
  }
  if (parsed.data.address !== undefined) data.address = parsed.data.address;
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

  const customer = await prisma.customer.update({ where: { id }, data });
  return ok(c, customer);
});

// ─── manual loyalty adjust ─────────────────────────────────────────────────

const adjustSchema = z.object({
  delta: z.number().int(),
  notes: z.string().min(1).max(500),
});

customerRoutes.post('/:id/loyalty', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = adjustSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'delta dan notes wajib diisi', 400, parsed.error.issues);
  }
  try {
    const result = await manualAdjust(id, parsed.data.delta, parsed.data.notes, user.id);
    return ok(c, result);
  } catch (e) {
    const msg = (e as Error).message || 'Penyesuaian poin gagal';
    return fail(c, 'AdjustFailed', msg, 400);
  }
});

// ─── balance ───────────────────────────────────────────────────────────────

customerRoutes.get('/:id/balance', async (c) => {
  const id = c.req.param('id');
  const balance = await getBalance(id);
  return ok(c, balance);
});

// ─── phone lookup (used by POS for fast member attach) ─────────────────────

const lookupSchema = z.object({
  phone: z.string().min(3).max(30),
});

customerRoutes.post('/lookup', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = lookupSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'phone wajib diisi', 400, parsed.error.issues);
  }
  const phoneNorm = normalizePhone(parsed.data.phone);
  const customer = await prisma.customer.findFirst({
    where: {
      AND: [
        { isActive: true },
        { OR: [{ phone: phoneNorm }, { phone: parsed.data.phone }] },
      ],
    },
    orderBy: { lastVisitAt: 'desc' },
  });
  return ok(c, customer);
});

// ─── redeem (used by order creation / POS) ─────────────────────────────────

const redeemSchema = z.object({
  points: z.number().int().positive(),
  orderId: z.string().optional(),
  notes: z.string().max(200).optional(),
});

customerRoutes.post('/:id/redeem', requireRole('CASHIER', 'MANAGER', 'OWNER'), async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = redeemSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'points wajib diisi', 400, parsed.error.issues);
  }
  try {
    const result = await redeem(id, parsed.data.points, {
      orderId: parsed.data.orderId,
      notes: parsed.data.notes,
      createdById: user.id,
    });
    return ok(c, result);
  } catch (e) {
    const msg = (e as Error).message || 'Redeem gagal';
    return fail(c, 'RedeemFailed', msg, 400);
  }
});
