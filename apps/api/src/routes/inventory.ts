// apps/api/src/routes/inventory.ts
//
// Sprint 12 — Inventory items + batch listing endpoint.
// Exposes a small read-only REST surface so the web client (and E2E
// scripts) can iterate over inventory items and their active FIFO
// batches. Batches are only listed when at least one row exists for
// the requested inventoryItemId — otherwise an empty array is
// returned.
//
// Endpoints:
//   GET /api/inventory                           (any role)
//   GET /api/inventory/:id                       (any role)
//   GET /api/inventory/:id/batches               (any role) — FIFO order

import { Hono } from 'hono';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, ok, fail } from '../middleware/auth.js';

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
