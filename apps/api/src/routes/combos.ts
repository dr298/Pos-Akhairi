import { Hono } from 'hono';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { incCounter } from '../middleware/metrics.js';

export const comboRoutes = new Hono<AppEnv>();

comboRoutes.use('*', requireAuth);

// ---------- helpers ----------

/**
 * Compute the effective price of a combo.
 * Returns the combo's own priceCents (the customer pays this).
 * The `breakdown` field shows how the price was derived — useful for
 * displaying "items would cost Rp X, combo price is Rp Y, you save Rp Z".
 */
export interface ComboPriceBreakdown {
  comboId: string;
  comboName: string;
  comboPriceCents: number;
  itemsTotalCents: number; // sum of (item.priceCents * quantity) using overrides when present
  savingsCents: number; // max(0, itemsTotal - comboPrice)
  items: Array<{
    menuItemId: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }>;
}

export async function computeComboPrice(comboId: string): Promise<ComboPriceBreakdown | null> {
  const combo = await prisma.combo.findUnique({
    where: { id: comboId },
    include: {
      items: {
        include: {
          // We rely on the menuItem relation via raw id; Prisma doesn't have
          // an explicit MenuItem relation on ComboItem, so we fetch the items
          // in bulk below.
        },
      },
    },
  });
  if (!combo) return null;

  const itemIds = combo.items.map((ci) => ci.menuItemId);
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, name: true, priceCents: true },
  });
  const menuMap = new Map(menuItems.map((m) => [m.id, m]));

  let itemsTotal = 0;
  const breakdown: ComboPriceBreakdown['items'] = [];
  for (const ci of combo.items) {
    const m = menuMap.get(ci.menuItemId);
    if (!m) continue; // dangling ref — skip
    const unitPrice = ci.overridesPriceCents ?? m.priceCents;
    const lineTotal = unitPrice * ci.quantity;
    itemsTotal += lineTotal;
    breakdown.push({
      menuItemId: ci.menuItemId,
      name: m.name,
      quantity: ci.quantity,
      unitPriceCents: unitPrice,
      lineTotalCents: lineTotal,
    });
  }

  return {
    comboId: combo.id,
    comboName: combo.name,
    comboPriceCents: combo.priceCents,
    itemsTotalCents: itemsTotal,
    savingsCents: Math.max(0, itemsTotal - combo.priceCents),
    items: breakdown,
  };
}

// ---------- list ----------

comboRoutes.get('/', async (c) => {
  const user = c.get('user');
  const includeInactive = c.req.query('includeInactive') === 'true';

  const combos = await prisma.combo.findMany({
    where: {
      ...(includeInactive || user.role !== 'CASHIER' ? {} : { isActive: true }),
    },
    include: {
      items: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  // Enrich with current item names for display
  const itemIds = Array.from(new Set(combos.flatMap((cm) => cm.items.map((ci) => ci.menuItemId))));
  const items = itemIds.length
    ? await prisma.menuItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, name: true, priceCents: true },
      })
    : [];
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const enriched = combos.map((cm) => ({
    ...cm,
    items: cm.items.map((ci) => ({
      ...ci,
      menuItem: itemMap.get(ci.menuItemId) || null,
    })),
  }));
  return ok(c, enriched);
});

// ---------- price breakdown ----------

comboRoutes.get('/:id/price', async (c) => {
  const id = c.req.param('id');
  const breakdown = await computeComboPrice(id);
  if (!breakdown) return fail(c, 'NotFound', 'Combo not found', 404);
  return ok(c, breakdown);
});

// ---------- create ----------

const comboItemSchema = z.object({
  menuItemId: z.string().min(1),
  quantity: z.number().int().positive().max(99),
  overridesPriceCents: z.number().int().nonnegative().nullable().optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  priceCents: z.number().int().nonnegative(),
  imageUrl: z.string().url().max(500).optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  isActive: z.boolean().optional(),
  items: z.array(comboItemSchema).min(1).max(20),
});

comboRoutes.post('/', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid combo payload', 400, parsed.error.issues);
  }

  // Verify all menu items exist
  const menuIds = Array.from(new Set(parsed.data.items.map((i) => i.menuItemId)));
  const found = await prisma.menuItem.findMany({
    where: { id: { in: menuIds }, isActive: true },
    select: { id: true },
  });
  const foundSet = new Set(found.map((m) => m.id));
  for (const id of menuIds) {
    if (!foundSet.has(id)) {
      return fail(c, 'MenuItemNotFound', `Menu item ${id} not found`, 400);
    }
  }

  const combo = await prisma.combo.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      priceCents: parsed.data.priceCents,
      imageUrl: parsed.data.imageUrl,
      validFrom: parsed.data.validFrom ? new Date(parsed.data.validFrom) : null,
      validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : null,
      isActive: parsed.data.isActive ?? true,
      items: {
        create: parsed.data.items.map((it) => ({
          menuItemId: it.menuItemId,
          quantity: it.quantity,
          overridesPriceCents: it.overridesPriceCents ?? null,
        })),
      },
    },
    include: { items: true },
  });

  incCounter('pos_combos_created_total', 'Combos created');
  logger.info({ comboId: combo.id, actor: user.id }, 'combo created');
  return ok(c, combo, 201);
});

// ---------- update ----------

const updateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    priceCents: z.number().int().nonnegative().optional(),
    imageUrl: z.string().url().max(500).optional(),
    validFrom: z.string().datetime().nullable().optional(),
    validUntil: z.string().datetime().nullable().optional(),
    isActive: z.boolean().optional(),
    items: z.array(comboItemSchema).min(1).max(20).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Empty update payload' });

comboRoutes.patch('/:id', requireRole('OWNER', 'MANAGER'), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid update payload', 400, parsed.error.issues);
  }

  const existing = await prisma.combo.findUnique({ where: { id } });
  if (!existing) return fail(c, 'NotFound', 'Combo not found', 404);

  const data: Prisma.ComboUpdateInput = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.priceCents !== undefined) data.priceCents = parsed.data.priceCents;
  if (parsed.data.imageUrl !== undefined) data.imageUrl = parsed.data.imageUrl;
  if (parsed.data.validFrom !== undefined) {
    data.validFrom = parsed.data.validFrom ? new Date(parsed.data.validFrom) : null;
  }
  if (parsed.data.validUntil !== undefined) {
    data.validUntil = parsed.data.validUntil ? new Date(parsed.data.validUntil) : null;
  }
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

  // If items are being replaced, do it inside a transaction so we never
  // end up with a combo that has no items.
  if (parsed.data.items) {
    return await prisma.$transaction(async (tx) => {
      // validate the menu items exist
      const menuIds = Array.from(new Set(parsed.data.items!.map((i) => i.menuItemId)));
      const found = await tx.menuItem.findMany({
        where: { id: { in: menuIds }, isActive: true },
        select: { id: true },
      });
      const foundSet = new Set(found.map((m) => m.id));
      for (const mid of menuIds) {
        if (!foundSet.has(mid)) {
          throw new Error(`MenuItemNotFound:${mid}`);
        }
      }
      await tx.comboItem.deleteMany({ where: { comboId: id } });
      const updated = await tx.combo.update({
        where: { id },
        data: {
          ...data,
          items: {
            create: parsed.data.items!.map((it) => ({
              menuItemId: it.menuItemId,
              quantity: it.quantity,
              overridesPriceCents: it.overridesPriceCents ?? null,
            })),
          },
        },
        include: { items: true },
      });
      return ok(c, updated);
    }).catch((e: unknown) => {
      const msg = (e as Error).message || 'Update failed';
      if (msg.startsWith('MenuItemNotFound:')) {
        return fail(c, 'MenuItemNotFound', `Menu item ${msg.split(':')[1]} not found`, 400);
      }
      logger.error({ err: e, comboId: id }, 'combo update failed');
      return fail(c, 'UpdateFailed', msg, 500);
    });
  }

  const updated = await prisma.combo.update({
    where: { id },
    data,
    include: { items: true },
  });
  return ok(c, updated);
});

// ---------- soft delete ----------

comboRoutes.delete('/:id', requireRole('OWNER'), async (c) => {
  const id = c.req.param('id');
  const existing = await prisma.combo.findUnique({ where: { id } });
  if (!existing) return fail(c, 'NotFound', 'Combo not found', 404);
  const updated = await prisma.combo.update({
    where: { id },
    data: { isActive: false },
    include: { items: true },
  });
  logger.info({ comboId: id, actor: c.get('user').id }, 'combo soft-deleted');
  return ok(c, updated);
});
