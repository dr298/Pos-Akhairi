// apps/api/src/routes/inventory.ts
//
// Sprint 12 — Inventory items + batch listing endpoint.
// Sprint 21 — Inventory adjustment (stock opname) endpoint.
//
// Endpoints:
//   GET    /api/inventory                       (any role)
//   GET    /api/inventory/:id                   (any role)
//   GET    /api/inventory/:id/batches           (any role) — FIFO order
//   POST   /api/inventory/:id/adjust            (MANAGER+OWNER) — Sprint 21
//   GET    /api/inventory/:id/adjustments       (any role) — Sprint 21
//                                                   last 50 ADJUSTMENT logs
//
// Adjustment flow (stock opname):
//   1. Manager walks the kitchen and counts actual physical stock.
//   2. For each item, they submit actualQty (counted) + reason.
//   3. Server computes delta = actual - current, applies the delta to
//      InventoryItem.quantity, and writes an InventoryLog of type
//      ADJUSTMENT with the signed delta. Positive delta = gain/keuntungan,
//      negative delta = loss/kerugian. Audit trail preserved.

import { Hono } from 'hono';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';

export const inventoryRoutes = new Hono<AppEnv>();

inventoryRoutes.use('*', requireAuth);

inventoryRoutes.get('/', async (c) => {
  const items = await prisma.inventoryItem.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
  return ok(c, { items });
});

inventoryRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item) return fail(c, 'NotFound', 'Inventory item not found', 404);
  return ok(c, { item });
});

// FIFO list of active (qtyRemaining > 0) batches. Oldest first.
inventoryRoutes.get('/:id/batches', async (c) => {
  const id = c.req.param('id');
  const batches = await prisma.inventoryBatch.findMany({
    where: { inventoryItemId: id, qtyRemaining: { gt: 0 } },
    orderBy: { receivedAt: 'asc' },
  });
  return ok(c, { batches });
});

// Sprint 21 — POST adjustment (stock opname result).
const adjustSchema = z.object({
  // The physically counted quantity. Decimal-as-string to avoid FP
  // issues on the wire; server coerces to Prisma.Decimal.
  actualQty: z.string().regex(/^\d+(\.\d{1,4})?$/, 'actualQty must be a non-negative decimal (max 4 dp)'),
  reason: z.string().min(3).max(200),
});

inventoryRoutes.post('/:id/adjust', requireRole('MANAGER', 'OWNER'), async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = adjustSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid adjustment payload', 400, parsed.error.issues);
  }
  const { actualQty, reason } = parsed.data;

  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item) return fail(c, 'NotFound', 'Inventory item not found', 404);

  const before = new Prisma.Decimal(item.quantity);
  const after = new Prisma.Decimal(actualQty);
  const delta = after.minus(before);

  if (delta.isZero()) {
    return ok(c, { item, log: null, delta: '0', note: 'No change' });
  }

  // Apply + audit log in a single tx so the two stay consistent.
  const [updated, log] = await prisma.$transaction([
    prisma.inventoryItem.update({
      where: { id },
      data: { quantity: after },
    }),
    prisma.inventoryLog.create({
      data: {
        inventoryItemId: id,
        type: 'ADJUSTMENT',
        // Log the SIGNED delta. POSITIVE = gain (keuntungan),
        // NEGATIVE = loss (kerugian). Magnitude only on the entry;
        // the sign is the audit.
        quantity: delta,
        reason: reason.slice(0, 200),
        reference: `opname:${user.id}:${Date.now()}`,
      },
    }),
  ]);

  return ok(c, {
    item: updated,
    log,
    delta: delta.toFixed(4),
    direction: delta.isPositive() ? 'GAIN' : 'LOSS',
  });
});

// Sprint 21 — recent adjustment log for one item.
inventoryRoutes.get('/:id/adjustments', async (c) => {
  const id = c.req.param('id');
  const logs = await prisma.inventoryLog.findMany({
    where: { inventoryItemId: id, type: 'ADJUSTMENT' },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return ok(c, { logs });
});
