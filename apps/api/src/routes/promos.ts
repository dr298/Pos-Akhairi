import { Hono } from 'hono';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { incCounter } from '../middleware/metrics.js';

export const promoRoutes = new Hono<AppEnv>();

promoRoutes.use('*', requireAuth);

// ─── Pure engine: validate + compute reward ────────────────────────────────

export interface PromoLineItem {
  menuItemId: string;
  quantity: number;
  unitPriceCents: number;
  // Optional categoryId to support category-scoped conditions.
  categoryId?: string;
}

export interface PromoValidationResult {
  valid: boolean;
  promoId?: string;
  name?: string;
  discountCents: number;
  // Free items granted by the promo (BUNDLE / BUY_X_GET_Y).
  // Each entry is a "free add" line — caller can either add to the order
  // as a $0 line item or pass through to the kitchen as a "comp" item.
  freeItems: Array<{ menuItemId: string; name?: string; quantity: number }>;
  reason?: string;
}

export interface PromoLike {
  id: string;
  code: string;
  name: string;
  type: 'PERCENT' | 'AMOUNT' | 'BUY_X_GET_Y' | 'BUNDLE';
  valueCents: number | null;
  percentBp: number | null;
  minSubtotalCents: number;
  maxDiscountCents: number | null;
  validFrom: Date;
  validUntil: Date;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  conditions: Array<{
    id: string;
    menuItemId: string | null;
    categoryId: string | null;
    minQuantity: number;
  }>;
  rewards: Array<{
    id: string;
    freeMenuItemId: string | null;
    freeQuantity: number;
    discountPercentBp: number | null;
    discountCents: number | null;
  }>;
}

/**
 * Pure (DB-free) promo validation/computation. Returns discountCents + free
 * items, OR { valid: false, reason }. Caller supplies the items array and
 * the promo row (already loaded). The caller is responsible for incrementing
 * usedCount / maxDiscountCaps in a transaction.
 */
export function computePromo(
  promo: PromoLike | null,
  items: PromoLineItem[],
  subtotalCents: number,
  itemMenuLookup: Map<string, { name: string; categoryId?: string }>,
  now: Date = new Date(),
): PromoValidationResult {
  const empty: PromoValidationResult = {
    valid: false,
    discountCents: 0,
    freeItems: [],
  };
  if (!promo) return { ...empty, reason: 'Promo not found' };
  if (!promo.isActive) return { ...empty, reason: 'Promo is inactive' };
  if (now < promo.validFrom) return { ...empty, reason: 'Promo not yet valid' };
  if (now > promo.validUntil) return { ...empty, reason: 'Promo has expired' };
  if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit) {
    return { ...empty, reason: 'Usage limit reached' };
  }
  if (subtotalCents < promo.minSubtotalCents) {
    return {
      ...empty,
      reason: `Minimum subtotal ${promo.minSubtotalCents} cents required`,
    };
  }

  // Aggregate cart quantities per menuItemId and per categoryId for condition checks.
  const perItemQty = new Map<string, number>();
  const perCategoryQty = new Map<string, number>();
  for (const it of items) {
    perItemQty.set(it.menuItemId, (perItemQty.get(it.menuItemId) ?? 0) + it.quantity);
    if (it.categoryId) {
      perCategoryQty.set(it.categoryId, (perCategoryQty.get(it.categoryId) ?? 0) + it.quantity);
    }
  }

  // Evaluate conditions (AND).
  for (const cond of promo.conditions) {
    let have = 0;
    if (cond.menuItemId) {
      have = perItemQty.get(cond.menuItemId) ?? 0;
    } else if (cond.categoryId) {
      have = perCategoryQty.get(cond.categoryId) ?? 0;
    } else {
      // Cart-level: total quantity across all items.
      have = items.reduce((sum, i) => sum + i.quantity, 0);
    }
    if (have < cond.minQuantity) {
      return {
        ...empty,
        reason: `Condition not met: need ${cond.minQuantity} of ${cond.menuItemId || cond.categoryId || 'cart'}`,
      };
    }
  }

  // Compute reward.
  let discountCents = 0;
  const freeItems: PromoValidationResult['freeItems'] = [];

  switch (promo.type) {
    case 'PERCENT': {
      const bp = promo.percentBp ?? 0;
      discountCents = Math.floor((subtotalCents * bp) / 10000);
      if (promo.maxDiscountCents !== null && discountCents > promo.maxDiscountCents) {
        discountCents = promo.maxDiscountCents;
      }
      // Sum any additional percent rewards
      for (const r of promo.rewards) {
        if (r.discountPercentBp) {
          discountCents += Math.floor((subtotalCents * r.discountPercentBp) / 10000);
        }
        if (r.discountCents) {
          discountCents += r.discountCents;
        }
      }
      break;
    }
    case 'AMOUNT': {
      discountCents = promo.valueCents ?? 0;
      for (const r of promo.rewards) {
        if (r.discountCents) discountCents += r.discountCents;
      }
      break;
    }
    case 'BUY_X_GET_Y': {
      // Reward is N free items of freeMenuItemId. Caller decides whether
      // they appear as $0 line items or just a discount.
      for (const r of promo.rewards) {
        if (r.freeMenuItemId) {
          const meta = itemMenuLookup.get(r.freeMenuItemId);
          freeItems.push({
            menuItemId: r.freeMenuItemId,
            name: meta?.name,
            quantity: r.freeQuantity,
          });
        } else if (r.discountCents) {
          discountCents += r.discountCents;
        }
      }
      break;
    }
    case 'BUNDLE': {
      // Apply each reward: percent, amount, and/or free items.
      for (const r of promo.rewards) {
        if (r.discountPercentBp) {
          discountCents += Math.floor((subtotalCents * r.discountPercentBp) / 10000);
        }
        if (r.discountCents) {
          discountCents += r.discountCents;
        }
        if (r.freeMenuItemId) {
          const meta = itemMenuLookup.get(r.freeMenuItemId);
          freeItems.push({
            menuItemId: r.freeMenuItemId,
            name: meta?.name,
            quantity: r.freeQuantity,
          });
        }
      }
      break;
    }
  }

  if (discountCents > subtotalCents) discountCents = subtotalCents;
  if (discountCents < 0) discountCents = 0;

  return {
    valid: true,
    promoId: promo.id,
    name: promo.name,
    discountCents,
    freeItems,
  };
}

// ─── list ─────────────────────────────────────────────────────────────────

promoRoutes.get('/', async (c) => {
  const user = c.get('user');
  const onlyActive = c.req.query('isActive') === 'true';

  const promos = await prisma.promo.findMany({
    where: {
      ...(onlyActive ? { isActive: true } : {}),
      // Cashiers see only active promos by default
      ...(user.role === 'CASHIER' && !onlyActive ? { isActive: true } : {}),
    },
    include: {
      conditions: true,
      rewards: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  return ok(c, promos);
});

// ─── validate (no mutation) ───────────────────────────────────────────────

const validateSchema = z.object({
  code: z.string().min(1).max(50),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.number().int().positive(),
        unitPriceCents: z.number().int().nonnegative(),
      }),
    )
    .min(1),
  memberId: z.string().optional(),
});

promoRoutes.post('/validate', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = validateSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);
  }

  const promo = await prisma.promo.findFirst({
    where: { code: parsed.data.code },
    include: { conditions: true, rewards: true },
  });

  // Compute subtotal and category lookup.
  const menuIds = Array.from(new Set(parsed.data.items.map((i) => i.menuItemId)));
  const items = await prisma.menuItem.findMany({
    where: { id: { in: menuIds } },
    select: { id: true, name: true, priceCents: true, categoryId: true },
  });
  const lookup = new Map(items.map((m) => [m.id, { name: m.name, categoryId: m.categoryId }]));
  const subtotalCents = parsed.data.items.reduce(
    (sum, i) => sum + i.unitPriceCents * i.quantity,
    0,
  );
  const result = computePromo(
    promo as PromoLike | null,
    parsed.data.items.map((i) => ({
      menuItemId: i.menuItemId,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      categoryId: lookup.get(i.menuItemId)?.categoryId,
    })),
    subtotalCents,
    lookup,
  );
  // Stamp a default name for free items that came from rewards without a lookup
  for (const f of result.freeItems) {
    if (!f.name) f.name = lookup.get(f.menuItemId)?.name || 'Bonus';
  }
  return ok(c, result);
});

// ─── apply (mutate order discount) ─────────────────────────────────────────

const applySchema = validateSchema.extend({
  orderId: z.string().min(1),
});

promoRoutes.post('/apply', requireRole('OWNER', 'MANAGER', 'CASHIER'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = applySchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);
  }

  const order = await prisma.order.findUnique({
    where: { id: parsed.data.orderId },
    include: { items: true },
  });
  if (!order) return fail(c, 'NotFound', 'Order not found', 404);
  if (order.status !== 'OPEN') {
    return fail(c, 'OrderClosed', `Order is ${order.status}`, 409);
  }

  // Use the order's actual line items for validation.
  const orderItems: PromoLineItem[] = order.items.map((it) => ({
    menuItemId: it.menuItemId,
    quantity: it.quantity,
    unitPriceCents: it.priceCents,
  }));
  const menuIds = Array.from(new Set(orderItems.map((i) => i.menuItemId)));
  const itemsMeta = await prisma.menuItem.findMany({
    where: { id: { in: menuIds } },
    select: { id: true, name: true, categoryId: true },
  });
  const lookup = new Map(itemsMeta.map((m) => [m.id, { name: m.name, categoryId: m.categoryId }]));
  const subtotalCents = orderItems.reduce(
    (sum, i) => sum + i.unitPriceCents * i.quantity,
    0,
  );

  const promo = await prisma.promo.findFirst({
    where: { code: parsed.data.code },
    include: { conditions: true, rewards: true },
  });

  const result = computePromo(
    promo as PromoLike | null,
    orderItems.map((i) => ({
      ...i,
      categoryId: lookup.get(i.menuItemId)?.categoryId,
    })),
    subtotalCents,
    lookup,
  );
  for (const f of result.freeItems) {
    if (!f.name) f.name = lookup.get(f.menuItemId)?.name || 'Bonus';
  }
  if (!result.valid) {
    return fail(c, 'PromoInvalid', result.reason || 'Promo not applicable', 400);
  }

  // Mutate: bump usedCount, update order.discountCents and total.
  const newTotal = Math.max(0, order.subtotalCents + order.taxCents - result.discountCents);
  const updated = await prisma.$transaction(async (tx) => {
    const o = await tx.order.update({
      where: { id: order.id },
      data: {
        discountCents: result.discountCents,
        totalCents: newTotal,
      },
      include: { items: true, payments: true },
    });
    if (promo) {
      await tx.promo.update({
        where: { id: promo.id },
        data: { usedCount: { increment: 1 } },
      });
    }
    return o;
  });

  incCounter('pos_promos_applied_total', 'Promos applied', {
    type: promo?.type ?? 'UNKNOWN',
  });
  logger.info(
    { orderId: order.id, promoId: result.promoId, discountCents: result.discountCents, actor: user.id },
    'promo applied to order',
  );
  return ok(c, { order: updated, promo: result });
});

// ─── create ───────────────────────────────────────────────────────────────

const rewardSchema = z
  .object({
    freeMenuItemId: z.string().min(1).optional(),
    freeQuantity: z.number().int().positive().max(99).optional(),
    discountPercentBp: z.number().int().min(0).max(10000).optional(),
    discountCents: z.number().int().nonnegative().optional(),
  })
  .refine(
    (r) =>
      Boolean(r.freeMenuItemId) ||
      r.discountPercentBp !== undefined ||
      r.discountCents !== undefined,
    { message: 'Reward must specify at least one of freeMenuItemId/discountPercentBp/discountCents' },
  );

const conditionSchema = z.object({
  menuItemId: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  minQuantity: z.number().int().positive().max(999).optional(),
});

const createSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  type: z.enum(['PERCENT', 'AMOUNT', 'BUY_X_GET_Y', 'BUNDLE']),
  valueCents: z.number().int().nonnegative().optional(),
  percentBp: z.number().int().min(0).max(10000).optional(),
  minSubtotalCents: z.number().int().nonnegative().optional(),
  maxDiscountCents: z.number().int().nonnegative().nullable().optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime(),
  usageLimit: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
  requiresMember: z.boolean().optional(),
  conditions: z.array(conditionSchema).max(20).optional(),
  rewards: z.array(rewardSchema).min(1).max(20),
});

promoRoutes.post('/', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid promo payload', 400, parsed.error.issues);
  }

  // Cross-field validation: type-specific value fields.
  if (parsed.data.type === 'PERCENT' && (parsed.data.percentBp === undefined || parsed.data.percentBp < 0)) {
    return fail(c, 'ValidationError', 'PERCENT type requires percentBp', 400);
  }
  if (parsed.data.type === 'AMOUNT' && (parsed.data.valueCents === undefined || parsed.data.valueCents < 0)) {
    return fail(c, 'ValidationError', 'AMOUNT type requires valueCents', 400);
  }

  // Verify referenced menu items exist
  const refMenuIds = Array.from(
    new Set(
      [
        ...(parsed.data.conditions ?? []).map((c) => c.menuItemId).filter((x): x is string => Boolean(x)),
        ...parsed.data.rewards.map((r) => r.freeMenuItemId).filter((x): x is string => Boolean(x)),
      ] as string[],
    ),
  );
  if (refMenuIds.length) {
    const found = await prisma.menuItem.findMany({
      where: { id: { in: refMenuIds } },
      select: { id: true },
    });
    const foundSet = new Set(found.map((m) => m.id));
    for (const id of refMenuIds) {
      if (!foundSet.has(id)) {
        return fail(c, 'MenuItemNotFound', `Menu item ${id} not found`, 400);
      }
    }
  }

  // Code uniqueness
  const dup = await prisma.promo.findUnique({ where: { code: parsed.data.code } });
  if (dup) return fail(c, 'CodeTaken', 'Promo code already exists', 409);

  const promo = await prisma.promo.create({
    data: {
      code: parsed.data.code,
      name: parsed.data.name,
      type: parsed.data.type,
      valueCents: parsed.data.valueCents ?? null,
      percentBp: parsed.data.percentBp ?? null,
      minSubtotalCents: parsed.data.minSubtotalCents ?? 0,
      maxDiscountCents: parsed.data.maxDiscountCents ?? null,
      validFrom: parsed.data.validFrom ? new Date(parsed.data.validFrom) : new Date(),
      validUntil: new Date(parsed.data.validUntil),
      usageLimit: parsed.data.usageLimit ?? null,
      isActive: parsed.data.isActive ?? true,
      requiresMember: parsed.data.requiresMember ?? false,
      conditions: parsed.data.conditions
        ? {
            create: parsed.data.conditions.map((c) => ({
              menuItemId: c.menuItemId ?? null,
              categoryId: c.categoryId ?? null,
              minQuantity: c.minQuantity ?? 1,
            })),
          }
        : undefined,
      rewards: {
        create: parsed.data.rewards.map((r) => ({
          freeMenuItemId: r.freeMenuItemId ?? null,
          freeQuantity: r.freeQuantity ?? 1,
          discountPercentBp: r.discountPercentBp ?? null,
          discountCents: r.discountCents ?? null,
        })),
      },
    },
    include: { conditions: true, rewards: true },
  });

  incCounter('pos_promos_created_total', 'Promos created', { type: parsed.data.type });
  logger.info({ promoId: promo.id, actor: user.id }, 'promo created');
  return ok(c, promo, 201);
});

// ─── update ───────────────────────────────────────────────────────────────

const updateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    valueCents: z.number().int().nonnegative().optional(),
    percentBp: z.number().int().min(0).max(10000).optional(),
    minSubtotalCents: z.number().int().nonnegative().optional(),
    maxDiscountCents: z.number().int().nonnegative().nullable().optional(),
    validFrom: z.string().datetime().nullable().optional(),
    validUntil: z.string().datetime().optional(),
    usageLimit: z.number().int().positive().nullable().optional(),
    isActive: z.boolean().optional(),
    requiresMember: z.boolean().optional(),
    conditions: z.array(conditionSchema).max(20).optional(),
    rewards: z.array(rewardSchema).min(1).max(20).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Empty update payload' });

promoRoutes.patch('/:id', requireRole('OWNER', 'MANAGER'), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid update payload', 400, parsed.error.issues);
  }

  const existing = await prisma.promo.findUnique({ where: { id } });
  if (!existing) return fail(c, 'NotFound', 'Promo not found', 404);

  const data: Prisma.PromoUpdateInput = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.valueCents !== undefined) data.valueCents = parsed.data.valueCents;
  if (parsed.data.percentBp !== undefined) data.percentBp = parsed.data.percentBp;
  if (parsed.data.minSubtotalCents !== undefined) data.minSubtotalCents = parsed.data.minSubtotalCents;
  if (parsed.data.maxDiscountCents !== undefined) data.maxDiscountCents = parsed.data.maxDiscountCents;
  if (parsed.data.validFrom !== undefined) {
    data.validFrom = parsed.data.validFrom ? new Date(parsed.data.validFrom) : undefined;
  }
  if (parsed.data.validUntil !== undefined) {
    data.validUntil = new Date(parsed.data.validUntil);
  }
  if (parsed.data.usageLimit !== undefined) data.usageLimit = parsed.data.usageLimit;
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
  if (parsed.data.requiresMember !== undefined) data.requiresMember = parsed.data.requiresMember;

  // If conditions or rewards are being replaced, do it transactionally.
  if (parsed.data.conditions || parsed.data.rewards) {
    return await prisma.$transaction(async (tx) => {
      if (parsed.data.conditions) {
        await tx.promoCondition.deleteMany({ where: { promoId: id } });
        data.conditions = {
          create: parsed.data.conditions!.map((c) => ({
            menuItemId: c.menuItemId ?? null,
            categoryId: c.categoryId ?? null,
            minQuantity: c.minQuantity ?? 1,
          })),
        };
      }
      if (parsed.data.rewards) {
        await tx.promoReward.deleteMany({ where: { promoId: id } });
        data.rewards = {
          create: parsed.data.rewards!.map((r) => ({
            freeMenuItemId: r.freeMenuItemId ?? null,
            freeQuantity: r.freeQuantity ?? 1,
            discountPercentBp: r.discountPercentBp ?? null,
            discountCents: r.discountCents ?? null,
          })),
        };
      }
      const updated = await tx.promo.update({
        where: { id },
        data,
        include: { conditions: true, rewards: true },
      });
      return ok(c, updated);
    }).catch((e: unknown) => {
      const msg = (e as Error).message || 'Update failed';
      logger.error({ err: e, promoId: id }, 'promo update failed');
      return fail(c, 'UpdateFailed', msg, 500);
    });
  }

  const updated = await prisma.promo.update({
    where: { id },
    data,
    include: { conditions: true, rewards: true },
  });
  return ok(c, updated);
});

// ─── soft delete ──────────────────────────────────────────────────────────

promoRoutes.delete('/:id', requireRole('OWNER'), async (c) => {
  const id = c.req.param('id');
  const existing = await prisma.promo.findUnique({ where: { id } });
  if (!existing) return fail(c, 'NotFound', 'Promo not found', 404);
  const updated = await prisma.promo.update({
    where: { id },
    data: { isActive: false },
    include: { conditions: true, rewards: true },
  });
  logger.info({ promoId: id, actor: c.get('user').id }, 'promo soft-deleted');
  return ok(c, updated);
});
