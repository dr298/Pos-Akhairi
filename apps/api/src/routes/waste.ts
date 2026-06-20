// apps/api/src/routes/waste.ts
//
// Sprint 9.9 — Waste tracking. Branch-scoped, soft-delete via `status`.
//
// Use cases:
//   - Kitchen staff log mistakes ("ruang masak kepanasan, 3 porsi nasgor
//     gosong") at end of shift.
//   - Manager logs expired ingredients from the walk-in cooler.
//   - Owner reviews monthly waste cost in the /pos/waste summary.
//
// Endpoints (all require auth):
//   GET    /api/waste?branchId=X&from=YYYY-MM-DD&to=YYYY-MM-DD&type=FOOD
//   POST   /api/waste                         (CASHIER+)
//   PATCH  /api/waste/:id                     (OWNER, MANAGER)
//   DELETE /api/waste/:id                     (OWNER) — soft delete (status)
//   GET    /api/waste/summary?branchId=X&days=30
//
// Cost computation: if `unitCostCents` is omitted and a `menuItemId` is set,
// we look up `MenuItem.costCents` and compute `totalCostCents` server-side.
// If `inventoryItemId` is set, we use `InventoryItem.costPerUnit` (decimal
// in IDR/unit) and multiply by `quantity`.

import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { incCounter } from '../middleware/metrics.js';

export const wasteRoutes = new Hono<AppEnv>();

wasteRoutes.use('*', requireAuth);

// ─── Helpers ───────────────────────────────────────────────────────────────

function userHasBranchAccess(
  branchAccess: Array<{ branchId: string }>,
  branchId: string,
): boolean {
  return branchAccess.some((b) => b.branchId === branchId);
}

function parseDateOnly(input: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!m) throw new Error(`Invalid date string: ${input} (expected YYYY-MM-DD)`);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${input}`);
  return d;
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

// ─── Schemas ──────────────────────────────────────────────────────────────

const createSchema = z.object({
  branchId: z.string().min(1).max(50),
  type: z.enum(['FOOD', 'INGREDIENT', 'PACKAGING']),
  menuItemId: z.string().min(1).max(50).optional().nullable(),
  inventoryItemId: z.string().min(1).max(50).optional().nullable(),
  quantity: z.number().positive().finite(),
  unitCostCents: z.number().int().nonnegative().optional().nullable(),
  totalCostCents: z.number().int().nonnegative().optional().nullable(),
  reason: z.string().max(200).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  recordedAt: z.string().max(40).optional().nullable(),
});

const updateSchema = z.object({
  type: z.enum(['FOOD', 'INGREDIENT', 'PACKAGING']).optional(),
  menuItemId: z.string().min(1).max(50).optional().nullable(),
  inventoryItemId: z.string().min(1).max(50).optional().nullable(),
  quantity: z.number().positive().finite().optional(),
  unitCostCents: z.number().int().nonnegative().optional().nullable(),
  totalCostCents: z.number().int().nonnegative().optional().nullable(),
  reason: z.string().max(200).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  recordedAt: z.string().max(40).optional().nullable(),
});

// ─── Cost computation ─────────────────────────────────────────────────────

/**
 * Resolve unit cost in cents and total cost. Returns {unitCostCents,
 * totalCostCents}, both nullable (cost is optional in the schema — we don't
 * force owners to keep books).
 */
async function resolveCost(
  type: 'FOOD' | 'INGREDIENT' | 'PACKAGING',
  menuItemId: string | null | undefined,
  inventoryItemId: string | null | undefined,
  quantity: number,
  hintUnit: number | null | undefined,
  hintTotal: number | null | undefined,
): Promise<{ unitCostCents: number | null; totalCostCents: number | null }> {
  // Caller-supplied values win.
  if (hintTotal !== undefined && hintTotal !== null) {
    const unit =
      hintUnit !== undefined && hintUnit !== null
        ? hintUnit
        : quantity > 0
        ? Math.round(hintTotal / quantity)
        : 0;
    return { unitCostCents: unit, totalCostCents: hintTotal };
  }
  if (type === 'FOOD' && menuItemId) {
    const mi = await prisma.menuItem.findUnique({
      where: { id: menuItemId },
      select: { costCents: true },
    });
    if (mi) {
      const unit = mi.costCents ?? 0;
      return { unitCostCents: unit, totalCostCents: Math.round(unit * quantity) };
    }
  }
  if ((type === 'INGREDIENT' || type === 'PACKAGING') && inventoryItemId) {
    const inv = await prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      select: { costPerUnit: true },
    });
    if (inv) {
      // InventoryItem.costPerUnit is Decimal in IDR/unit. Multiply by
      // quantity, then convert to cents (round to nearest cent).
      const unitIdr = Number(inv.costPerUnit);
      const totalIdr = unitIdr * quantity;
      return {
        unitCostCents: Math.round(unitIdr * 100),
        totalCostCents: Math.round(totalIdr * 100),
      };
    }
  }
  return { unitCostCents: null, totalCostCents: null };
}

// ─── List ─────────────────────────────────────────────────────────────────

wasteRoutes.get('/', async (c) => {
  const user = c.get('user');
  const branchId = c.req.query('branchId') || user.branchId;
  if (!branchId) return fail(c, 'NoBranch', 'No branch context', 400);
  if (!userHasBranchAccess(user.branchAccess, branchId)) {
    return fail(c, 'NoAccess', `No access to branch ${branchId}`, 403);
  }
  const from = c.req.query('from');
  const to = c.req.query('to');
  const type = c.req.query('type');
  const includeDeleted = c.req.query('includeDeleted') === 'true';
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') || 100)));

  let start: Date | undefined;
  let end: Date | undefined;
  try {
    if (from) start = parseDateOnly(from);
    if (to) end = endOfDay(parseDateOnly(to));
  } catch (e) {
    return fail(c, 'ValidationError', (e as Error).message, 400);
  }
  if (start && end && start > end) {
    return fail(c, 'ValidationError', 'from must be <= to', 400);
  }

  const entries = await prisma.wasteEntry.findMany({
    where: {
      branchId,
      ...(type ? { type: type as 'FOOD' | 'INGREDIENT' | 'PACKAGING' } : {}),
      ...(includeDeleted ? {} : { status: 'ACTIVE' }),
      ...(start || end
        ? {
            recordedAt: {
              ...(start ? { gte: start } : {}),
              ...(end ? { lte: end } : {}),
            },
          }
        : {}),
    },
    include: {
      recordedBy: { select: { id: true, name: true, role: true } },
    },
    orderBy: { recordedAt: 'desc' },
    take: limit,
  });

  // Enrich with item name (best effort). We batch a single query for each
  // related table.
  const menuIds = Array.from(
    new Set(entries.map((e) => e.menuItemId).filter((v): v is string => !!v)),
  );
  const invIds = Array.from(
    new Set(entries.map((e) => e.inventoryItemId).filter((v): v is string => !!v)),
  );
  const [menus, invs] = await Promise.all([
    menuIds.length
      ? prisma.menuItem.findMany({
          where: { id: { in: menuIds } },
          select: { id: true, name: true, sku: true },
        })
      : Promise.resolve([]),
    invIds.length
      ? prisma.inventoryItem.findMany({
          where: { id: { in: invIds } },
          select: { id: true, name: true, sku: true, unit: true },
        })
      : Promise.resolve([]),
  ]);
  const menuMap = new Map(menus.map((m) => [m.id, m]));
  const invMap = new Map(invs.map((i) => [i.id, i]));

  const enriched = entries.map((e) => ({
    ...e,
    // Decimal → string for JSON
    quantity: e.quantity.toString(),
    menuItem: e.menuItemId ? menuMap.get(e.menuItemId) ?? null : null,
    inventoryItem: e.inventoryItemId ? invMap.get(e.inventoryItemId) ?? null : null,
  }));

  return ok(c, { entries: enriched, count: enriched.length });
});

// ─── Create (CASHIER+) ────────────────────────────────────────────────────

wasteRoutes.post(
  '/',
  requireRole('OWNER', 'MANAGER', 'CASHIER'),
  async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid waste payload', 400, parsed.error.issues);
    }
    const input = parsed.data;
    if (!userHasBranchAccess(user.branchAccess, input.branchId)) {
      return fail(c, 'NoAccess', `No access to branch ${input.branchId}`, 403);
    }
    // Validate the related items belong to this branch (when set).
    if (input.menuItemId) {
      const mi = await prisma.menuItem.findUnique({
        where: { id: input.menuItemId },
        select: { id: true, branchId: true },
      });
      if (!mi) return fail(c, 'NotFound', 'Menu item not found', 404);
      if (mi.branchId !== input.branchId) {
        return fail(c, 'ValidationError', 'Menu item belongs to a different branch', 400);
      }
    }
    if (input.inventoryItemId) {
      const inv = await prisma.inventoryItem.findUnique({
        where: { id: input.inventoryItemId },
        select: { id: true, branchId: true },
      });
      if (!inv) return fail(c, 'NotFound', 'Inventory item not found', 404);
      if (inv.branchId !== input.branchId) {
        return fail(c, 'ValidationError', 'Inventory item belongs to a different branch', 400);
      }
    }
    if (!input.menuItemId && !input.inventoryItemId) {
      return fail(
        c,
        'ValidationError',
        'Either menuItemId or inventoryItemId is required',
        400,
      );
    }
    const cost = await resolveCost(
      input.type,
      input.menuItemId,
      input.inventoryItemId,
      input.quantity,
      input.unitCostCents ?? null,
      input.totalCostCents ?? null,
    );
    const recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();
    if (isNaN(recordedAt.getTime())) {
      return fail(c, 'ValidationError', 'Invalid recordedAt', 400);
    }
    const entry = await prisma.wasteEntry.create({
      data: {
        branchId: input.branchId,
        type: input.type,
        status: 'ACTIVE',
        menuItemId: input.menuItemId ?? null,
        inventoryItemId: input.inventoryItemId ?? null,
        quantity: input.quantity,
        unitCostCents: cost.unitCostCents,
        totalCostCents: cost.totalCostCents,
        reason: input.reason ?? null,
        recordedById: user.id,
        recordedAt,
        notes: input.notes ?? null,
      },
    });
    incCounter('pos_waste_entries_created_total', 'Waste entries created', {
      branchId: input.branchId,
      type: input.type,
    });
    logger.info(
      { wasteId: entry.id, branchId: input.branchId, type: input.type, qty: input.quantity },
      'waste entry created',
    );
    return ok(
      c,
      {
        entry: { ...entry, quantity: entry.quantity.toString() },
      },
      201,
    );
  },
);

// ─── Update (OWNER, MANAGER) ───────────────────────────────────────────────

wasteRoutes.patch(
  '/:id',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid waste payload', 400, parsed.error.issues);
    }
    const existing = await prisma.wasteEntry.findUnique({ where: { id } });
    if (!existing) return fail(c, 'NotFound', 'Waste entry not found', 404);
    if (!userHasBranchAccess(user.branchAccess, existing.branchId)) {
      return fail(c, 'NoAccess', 'No access to this waste entry', 403);
    }
    if (existing.status === 'DELETED') {
      return fail(c, 'InvalidState', 'Cannot update a deleted entry', 409);
    }

    // Build the update payload — only include fields that were actually
    // passed (Zod .optional() returns undefined; we translate to "leave
    // alone").
    const data: Record<string, unknown> = {};
    if (parsed.data.type !== undefined) data.type = parsed.data.type;
    if (parsed.data.menuItemId !== undefined) data.menuItemId = parsed.data.menuItemId;
    if (parsed.data.inventoryItemId !== undefined)
      data.inventoryItemId = parsed.data.inventoryItemId;
    if (parsed.data.reason !== undefined) data.reason = parsed.data.reason;
    if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
    if (parsed.data.recordedAt !== undefined && parsed.data.recordedAt !== null) {
      const d = new Date(parsed.data.recordedAt);
      if (isNaN(d.getTime())) {
        return fail(c, 'ValidationError', 'Invalid recordedAt', 400);
      }
      data.recordedAt = d;
    } else if (parsed.data.recordedAt === null) {
      data.recordedAt = null;
    }
    if (parsed.data.quantity !== undefined) {
      data.quantity = parsed.data.quantity;
    }
    if (
      parsed.data.unitCostCents !== undefined ||
      parsed.data.totalCostCents !== undefined ||
      parsed.data.quantity !== undefined
    ) {
      // Recompute cost with the new values (if quantity changed, recompute
      // total; if total given, recompute unit; if neither, keep existing).
      const cost = await resolveCost(
        (parsed.data.type ?? existing.type) as 'FOOD' | 'INGREDIENT' | 'PACKAGING',
        parsed.data.menuItemId !== undefined
          ? parsed.data.menuItemId
          : existing.menuItemId,
        parsed.data.inventoryItemId !== undefined
          ? parsed.data.inventoryItemId
          : existing.inventoryItemId,
        parsed.data.quantity ?? Number(existing.quantity),
        parsed.data.unitCostCents ?? existing.unitCostCents,
        parsed.data.totalCostCents ?? existing.totalCostCents,
      );
      data.unitCostCents = cost.unitCostCents;
      data.totalCostCents = cost.totalCostCents;
    }

    if (Object.keys(data).length === 0) {
      return fail(c, 'ValidationError', 'No fields to update', 400);
    }
    const updated = await prisma.wasteEntry.update({ where: { id }, data });
    void user;
    return ok(c, { entry: { ...updated, quantity: updated.quantity.toString() } });
  },
);

// ─── Soft delete (OWNER) ───────────────────────────────────────────────────

wasteRoutes.delete(
  '/:id',
  requireRole('OWNER'),
  async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await prisma.wasteEntry.findUnique({ where: { id } });
    if (!existing) return fail(c, 'NotFound', 'Waste entry not found', 404);
    if (!userHasBranchAccess(user.branchAccess, existing.branchId)) {
      return fail(c, 'NoAccess', 'No access to this waste entry', 403);
    }
    if (existing.status === 'DELETED') {
      return fail(c, 'InvalidState', 'Already deleted', 409);
    }
    const updated = await prisma.wasteEntry.update({
      where: { id },
      data: { status: 'DELETED' },
    });
    logger.info(
      { wasteId: id, branchId: existing.branchId, by: user.id },
      'waste entry soft-deleted',
    );
    return ok(c, { entry: { ...updated, quantity: updated.quantity.toString() } });
  },
);

// ─── Summary (OWNER, MANAGER) ─────────────────────────────────────────────

wasteRoutes.get('/summary', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  const branchId = c.req.query('branchId') || user.branchId;
  if (!branchId) return fail(c, 'NoBranch', 'No branch context', 400);
  if (!userHasBranchAccess(user.branchAccess, branchId)) {
    return fail(c, 'NoAccess', `No access to branch ${branchId}`, 403);
  }
  const days = Math.min(365, Math.max(1, Number(c.req.query('days') || 30)));
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);

  const entries = await prisma.wasteEntry.findMany({
    where: {
      branchId,
      status: 'ACTIVE',
      recordedAt: { gte: start, lte: now },
    },
    select: {
      type: true,
      reason: true,
      totalCostCents: true,
      menuItemId: true,
      inventoryItemId: true,
      recordedAt: true,
    },
  });

  // Aggregate
  let totalCostCents = 0;
  let totalCount = 0;
  const byType: Record<string, { count: number; costCents: number }> = {
    FOOD: { count: 0, costCents: 0 },
    INGREDIENT: { count: 0, costCents: 0 },
    PACKAGING: { count: 0, costCents: 0 },
  };
  const byReason: Record<string, { count: number; costCents: number }> = {};
  const byItem: Record<
    string,
    { name: string; type: string; count: number; costCents: number }
  > = {};
  for (const e of entries) {
    const cost = e.totalCostCents ?? 0;
    totalCostCents += cost;
    totalCount += 1;
    const t = byType[e.type] || { count: 0, costCents: 0 };
    t.count += 1;
    t.costCents += cost;
    byType[e.type] = t;
    if (e.reason) {
      const r = byReason[e.reason] || { count: 0, costCents: 0 };
      r.count += 1;
      r.costCents += cost;
      byReason[e.reason] = r;
    }
    if (e.menuItemId || e.inventoryItemId) {
      const k = `${e.type}:${e.menuItemId ?? e.inventoryItemId}`;
      if (!byItem[k]) {
        byItem[k] = {
          name: e.menuItemId ? `(menu ${e.menuItemId})` : `(inventory ${e.inventoryItemId})`,
          type: e.type,
          count: 0,
          costCents: 0,
        };
      }
      byItem[k].count += 1;
      byItem[k].costCents += cost;
    }
  }
  // Enrich item names
  const menuIds = Array.from(
    new Set(
      entries
        .map((e) => e.menuItemId)
        .filter((v): v is string => !!v),
    ),
  );
  const invIds = Array.from(
    new Set(
      entries
        .map((e) => e.inventoryItemId)
        .filter((v): v is string => !!v),
    ),
  );
  const [menus, invs] = await Promise.all([
    menuIds.length
      ? prisma.menuItem.findMany({
          where: { id: { in: menuIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    invIds.length
      ? prisma.inventoryItem.findMany({
          where: { id: { in: invIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const menuMap = new Map(menus.map((m) => [m.id, m.name]));
  const invMap = new Map(invs.map((i) => [i.id, i.name]));
  for (const k of Object.keys(byItem)) {
    const v = byItem[k];
    if (!v) continue;
    if (k.startsWith('FOOD:') || k.startsWith('INGREDIENT:') || k.startsWith('PACKAGING:')) {
      const id = k.split(':')[1] ?? '';
      if (k.startsWith('FOOD:')) {
        v.name = menuMap.get(id) ?? v.name;
      } else {
        v.name = invMap.get(id) ?? v.name;
      }
    }
  }
  const topItems = Object.entries(byItem)
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.costCents - a.costCents)
    .slice(0, 5);

  const byReasonList = Object.entries(byReason)
    .map(([reason, v]) => ({ reason, ...v }))
    .sort((a, b) => b.costCents - a.costCents);

  return ok(c, {
    periodDays: days,
    from: start.toISOString(),
    to: now.toISOString(),
    branchId,
    totalCount,
    totalCostCents,
    byType,
    topItems,
    byReason: byReasonList,
  });
});
