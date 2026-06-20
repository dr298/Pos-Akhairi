import { Hono } from 'hono';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';

export const discountRoutes = new Hono<AppEnv>();

discountRoutes.use('*', requireAuth);

// ---------- helpers ----------

export interface DiscountComputation {
  valid: boolean;
  discountId?: string;
  name?: string;
  discountCents: number;
  newSubtotalCents: number;
  reason?: string;
}

/**
 * Pure validation + computation. Used by both the /validate endpoint
 * and the order creation flow. Does NOT touch the database.
 */
export function computeDiscount(
  d: {
    id: string;
    name: string;
    type: 'PERCENTAGE' | 'FIXED';
    value: number;
    minOrderCents: number;
    maxDiscountCents: number | null;
    validFrom: Date | null;
    validUntil: Date | null;
    usageLimit: number | null;
    usageCount: number;
    isActive: boolean;
  } | null,
  subtotalCents: number,
  now: Date = new Date()
): DiscountComputation {
  if (!d) {
    return { valid: false, discountCents: 0, newSubtotalCents: subtotalCents, reason: 'Discount not found' };
  }
  if (!d.isActive) {
    return { valid: false, discountCents: 0, newSubtotalCents: subtotalCents, reason: 'Discount is inactive' };
  }
  if (d.validFrom && now < d.validFrom) {
    return { valid: false, discountCents: 0, newSubtotalCents: subtotalCents, reason: 'Discount not yet valid' };
  }
  if (d.validUntil && now > d.validUntil) {
    return { valid: false, discountCents: 0, newSubtotalCents: subtotalCents, reason: 'Discount has expired' };
  }
  if (d.usageLimit !== null && d.usageCount >= d.usageLimit) {
    return { valid: false, discountCents: 0, newSubtotalCents: subtotalCents, reason: 'Usage limit reached' };
  }
  if (subtotalCents < d.minOrderCents) {
    return {
      valid: false,
      discountCents: 0,
      newSubtotalCents: subtotalCents,
      reason: `Minimum order ${d.minOrderCents} cents required`,
    };
  }

  let discountCents = 0;
  if (d.type === 'PERCENTAGE') {
    discountCents = Math.floor((subtotalCents * d.value) / 100);
    if (d.maxDiscountCents !== null && discountCents > d.maxDiscountCents) {
      discountCents = d.maxDiscountCents;
    }
  } else {
    // FIXED — value is already in cents
    discountCents = d.value;
  }
  if (discountCents > subtotalCents) discountCents = subtotalCents;
  if (discountCents < 0) discountCents = 0;

  return {
    valid: true,
    discountId: d.id,
    name: d.name,
    discountCents,
    newSubtotalCents: subtotalCents - discountCents,
  };
}

// ---------- list ----------

discountRoutes.get('/', async (c) => {
  const user = c.get('user');
  const branchId = c.req.query('branchId') || user.branchId;
  if (!branchId) return fail(c, 'NoBranch', 'No branch context', 400);

  // Cashiers see only active; managers/owners see all
  const where: Prisma.DiscountWhereInput = { branchId };
  if (user.role === 'CASHIER') where.isActive = true;

  const discounts = await prisma.discount.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
  return ok(c, discounts);
});

// ---------- validate ----------

const validateSchema = z.object({
  code: z.string().min(1).max(50),
  subtotalCents: z.number().int().nonnegative(),
  discountId: z.string().optional(),
});

discountRoutes.post('/validate', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = validateSchema.safeParse(body);
  if (!parsed.success) return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);
  const { code, subtotalCents, discountId } = parsed.data;
  if (!user.branchId) return fail(c, 'NoBranch', 'No branch context', 400);

  const d = await prisma.discount.findFirst({
    where: {
      branchId: user.branchId,
      ...(discountId ? { id: discountId } : { code }),
    },
  });
  const result = computeDiscount(d, subtotalCents);
  return ok(c, result);
});

// ---------- create ----------

const createSchema = z.object({
  code: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(100),
  type: z.enum(['PERCENTAGE', 'FIXED']),
  value: z.number().int().nonnegative(),
  minOrderCents: z.number().int().nonnegative().optional(),
  maxDiscountCents: z.number().int().nonnegative().nullable().optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  usageLimit: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
});

discountRoutes.post('/', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);
  if (!user.branchId) return fail(c, 'NoBranch', 'No branch context', 400);

  if (parsed.data.type === 'PERCENTAGE' && parsed.data.value > 100) {
    return fail(c, 'ValidationError', 'PERCENTAGE value must be 0-100', 400);
  }

  if (parsed.data.code) {
    const dup = await prisma.discount.findFirst({
      where: { branchId: user.branchId, code: parsed.data.code },
    });
    if (dup) return fail(c, 'CodeTaken', 'Discount code already exists', 409);
  }

  const d = await prisma.discount.create({
    data: {
      branchId: user.branchId,
      code: parsed.data.code,
      name: parsed.data.name,
      type: parsed.data.type,
      value: parsed.data.value,
      minOrderCents: parsed.data.minOrderCents ?? 0,
      maxDiscountCents: parsed.data.maxDiscountCents ?? null,
      validFrom: parsed.data.validFrom ? new Date(parsed.data.validFrom) : null,
      validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : null,
      usageLimit: parsed.data.usageLimit ?? null,
      isActive: parsed.data.isActive ?? true,
    },
  });
  return ok(c, d, 201);
});

// ---------- update ----------

const updateSchema = createSchema.partial().refine(
  (o) => Object.keys(o).length > 0,
  { message: 'Empty update payload' }
);

discountRoutes.patch('/:id', requireRole('OWNER', 'MANAGER'), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);

  const existing = await prisma.discount.findUnique({ where: { id } });
  if (!existing) return fail(c, 'NotFound', 'Discount not found', 404);

  const data: Prisma.DiscountUpdateInput = {};
  if (parsed.data.code !== undefined) data.code = parsed.data.code;
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.type !== undefined) data.type = parsed.data.type;
  if (parsed.data.value !== undefined) data.value = parsed.data.value;
  if (parsed.data.minOrderCents !== undefined) data.minOrderCents = parsed.data.minOrderCents;
  if (parsed.data.maxDiscountCents !== undefined) data.maxDiscountCents = parsed.data.maxDiscountCents;
  if (parsed.data.validFrom !== undefined) {
    data.validFrom = parsed.data.validFrom ? new Date(parsed.data.validFrom) : null;
  }
  if (parsed.data.validUntil !== undefined) {
    data.validUntil = parsed.data.validUntil ? new Date(parsed.data.validUntil) : null;
  }
  if (parsed.data.usageLimit !== undefined) data.usageLimit = parsed.data.usageLimit;
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

  const d = await prisma.discount.update({ where: { id }, data });
  return ok(c, d);
});

// ---------- soft delete ----------

discountRoutes.delete('/:id', requireRole('OWNER', 'MANAGER'), async (c) => {
  const id = c.req.param('id');
  const existing = await prisma.discount.findUnique({ where: { id } });
  if (!existing) return fail(c, 'NotFound', 'Discount not found', 404);
  const d = await prisma.discount.update({ where: { id }, data: { isActive: false } });
  return ok(c, d);
});
