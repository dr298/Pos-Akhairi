// Sprint 5.2 — Stock transfers between branches
// DRAFT → IN_TRANSIT (decrement source stock, TRANSFER_OUT log)
// IN_TRANSIT → RECEIVED (increment target stock by qtyReceived, TRANSFER_IN log)
// DRAFT/IN_TRANSIT → CANCELLED (restore source if IN_TRANSIT)
import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';

export const transferRoutes = new Hono<AppEnv>();

transferRoutes.use('*', requireAuth, requireRole('OWNER', 'MANAGER'));

const createSchema = z.object({
  fromBranchId: z.string().min(1),
  toBranchId: z.string().min(1),
  notes: z.string().optional(),
  items: z.array(z.object({
    inventoryItemId: z.string().min(1),
    qtyTransferred: z.number().int().positive(),
  })).min(1),
});

function userHasBranchAccess(branchAccess: { branchId: string }[], branchId: string): boolean {
  return branchAccess.some((b) => b.branchId === branchId);
}

// List inventory for a branch (used by the "create transfer" picker)
transferRoutes.get('/inventory/:branchId', async (c) => {
  const user = c.get('user');
  const branchId = c.req.param('branchId');
  if (!userHasBranchAccess(user.branchAccess, branchId)) {
    return fail(c, 'NoAccess', 'No access to branch', 403);
  }
  const items = await prisma.inventoryItem.findMany({
    where: { branchId, isActive: true },
    select: { id: true, sku: true, name: true, unit: true, quantity: true },
    orderBy: { name: 'asc' },
  });
  return ok(c, { items });
});

// List transfers — show only transfers the user has branch access to.
transferRoutes.get('/', async (c) => {
  const user = c.get('user');
  const status = c.req.query('status');
  const branchId = c.req.query('branchId'); // optional filter: transfers where this branch is from OR to
  const branchIds = user.branchAccess.map((b) => b.branchId);
  if (branchIds.length === 0) return ok(c, { transfers: [] });

  const where: any = {
    OR: [
      { fromBranchId: { in: branchIds } },
      { toBranchId: { in: branchIds } },
    ],
  };
  if (status) where.status = status;
  if (branchId) {
    where.OR = [
      { fromBranchId: branchId },
      { toBranchId: branchId },
    ];
  }
  const transfers = await prisma.stockTransfer.findMany({
    where,
    include: {
      fromBranch: { select: { id: true, code: true, name: true } },
      toBranch: { select: { id: true, code: true, name: true } },
      createdBy: { select: { name: true } },
      sentBy: { select: { name: true } },
      receivedBy: { select: { name: true } },
      items: {
        include: { inventoryItem: { select: { id: true, sku: true, name: true, unit: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return ok(c, { transfers });
});

transferRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const t = await prisma.stockTransfer.findUnique({
    where: { id },
    include: {
      fromBranch: { select: { id: true, code: true, name: true } },
      toBranch: { select: { id: true, code: true, name: true } },
      createdBy: { select: { name: true } },
      sentBy: { select: { name: true } },
      receivedBy: { select: { name: true } },
      items: {
        include: { inventoryItem: { select: { id: true, sku: true, name: true, unit: true, branchId: true } } },
      },
    },
  });
  if (!t) return fail(c, 'NotFound', 'Transfer not found', 404);
  if (!userHasBranchAccess(user.branchAccess, t.fromBranchId) &&
      !userHasBranchAccess(user.branchAccess, t.toBranchId)) {
    return fail(c, 'NoAccess', 'No access to this transfer', 403);
  }
  return ok(c, { transfer: t });
});

// Create a DRAFT transfer. Validates from/to branches differ, items are
// in the source branch, and the user has access to the source branch.
transferRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return fail(c, 'ValidationError', parsed.error.message, 400);
  const input = parsed.data;
  if (input.fromBranchId === input.toBranchId) {
    return fail(c, 'ValidationError', 'from and to branch must differ', 400);
  }
  if (!userHasBranchAccess(user.branchAccess, input.fromBranchId)) {
    return fail(c, 'NoAccess', 'No access to source branch', 403);
  }

  // Validate items exist in source branch
  const invIds = input.items.map((i) => i.inventoryItemId);
  const invItems = await prisma.inventoryItem.findMany({
    where: { id: { in: invIds }, branchId: input.fromBranchId },
  });
  if (invItems.length !== invIds.length) {
    return fail(c, 'ValidationError', 'Some items not in source branch', 400);
  }
  // Check sufficient stock
  for (const it of input.items) {
    const inv = invItems.find((i) => i.id === it.inventoryItemId)!;
    if (Number(inv.quantity) < it.qtyTransferred) {
      return fail(c, 'InsufficientStock', `${inv.name}: have ${inv.quantity}, need ${it.qtyTransferred}`, 400);
    }
  }

  const transfer = await prisma.stockTransfer.create({
    data: {
      fromBranchId: input.fromBranchId,
      toBranchId: input.toBranchId,
      notes: input.notes,
      createdById: user.id,
      items: { create: input.items.map((i) => ({ inventoryItemId: i.inventoryItemId, qtyTransferred: i.qtyTransferred })) },
    },
    include: { items: true },
  });
  return ok(c, { transfer });
});

// Send a DRAFT transfer. Decrements source inventory, TRANSFER_OUT log per item.
transferRoutes.post('/:id/send', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const t = await prisma.stockTransfer.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!t) return fail(c, 'NotFound', 'Transfer not found', 404);
  if (t.status !== 'DRAFT') return fail(c, 'InvalidState', `Transfer is ${t.status}, not DRAFT`, 400);
  if (!userHasBranchAccess(user.branchAccess, t.fromBranchId)) {
    return fail(c, 'NoAccess', 'No access to source branch', 403);
  }
  // Re-validate stock
  const invItems = await prisma.inventoryItem.findMany({
    where: { id: { in: t.items.map((i) => i.inventoryItemId) }, branchId: t.fromBranchId },
  });
  for (const it of t.items) {
    const inv = invItems.find((i) => i.id === it.inventoryItemId)!;
    if (Number(inv.quantity) < it.qtyTransferred) {
      return fail(c, 'InsufficientStock', `${inv.name}: have ${inv.quantity}, need ${it.qtyTransferred}`, 400);
    }
  }
  // Apply: decrement source + TRANSFER_OUT log
  const updated = await prisma.$transaction(async (tx) => {
    for (const it of t.items) {
      const inv = invItems.find((i) => i.id === it.inventoryItemId)!;
      const newQty = Number(inv.quantity) - it.qtyTransferred;
      await tx.inventoryItem.update({
        where: { id: inv.id },
        data: { quantity: newQty },
      });
      await tx.inventoryLog.create({
        data: {
          inventoryItemId: inv.id,
          type: 'TRANSFER_OUT',
          quantity: -it.qtyTransferred,
          reason: `Transfer to ${t.toBranchId}: ${t.id}`,
          reference: t.id,
        },
      });
    }
    return tx.stockTransfer.update({
      where: { id: t.id },
      data: { status: 'IN_TRANSIT', sentAt: new Date(), sentById: user.id },
      include: {
        items: { include: { inventoryItem: { select: { id: true, sku: true, name: true, unit: true } } } },
        fromBranch: { select: { id: true, code: true, name: true } },
        toBranch: { select: { id: true, code: true, name: true } },
      },
    });
  });
  return ok(c, { transfer: updated });
});

// Receive an IN_TRANSIT transfer. Body: { items: [{ transferItemId, qtyReceived }] }
// If no items given, assume full qty received for all.
const receiveSchema = z.object({
  items: z.array(z.object({
    transferItemId: z.string(),
    qtyReceived: z.number().int().nonnegative(),
  })).optional(),
});

transferRoutes.post('/:id/receive', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = receiveSchema.safeParse(body);
  if (!parsed.success) return fail(c, 'ValidationError', parsed.error.message, 400);
  const overrides = new Map(
    (parsed.data.items || []).map((i) => [i.transferItemId, i.qtyReceived]),
  );
  const t = await prisma.stockTransfer.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!t) return fail(c, 'NotFound', 'Transfer not found', 404);
  if (t.status !== 'IN_TRANSIT') return fail(c, 'InvalidState', `Transfer is ${t.status}, not IN_TRANSIT`, 400);
  if (!userHasBranchAccess(user.branchAccess, t.toBranchId)) {
    return fail(c, 'NoAccess', 'No access to destination branch', 403);
  }

  // For each item, find the matching InventoryItem in the destination
  // (same SKU) or create one if absent.
  const sourceItems = await prisma.inventoryItem.findMany({
    where: { id: { in: t.items.map((i) => i.inventoryItemId) } },
  });
  const updated = await prisma.$transaction(async (tx) => {
    for (const it of t.items) {
      const qty = overrides.get(it.id) ?? it.qtyTransferred;
      if (qty < 0 || qty > it.qtyTransferred) {
        throw new Error(`Bad qtyReceived for item ${it.id}: ${qty} (max ${it.qtyTransferred})`);
      }
      const src = sourceItems.find((s) => s.id === it.inventoryItemId)!;
      // Find or upsert destination inventory item by SKU
      const dest = await tx.inventoryItem.upsert({
        where: { branchId_sku: { branchId: t.toBranchId, sku: src.sku } },
        update: {},
        create: {
          branchId: t.toBranchId,
          sku: src.sku,
          name: src.name,
          unit: src.unit,
          costPerUnit: src.costPerUnit,
        },
      });
      await tx.inventoryItem.update({
        where: { id: dest.id },
        data: { quantity: { increment: qty } },
      });
      await tx.inventoryLog.create({
        data: {
          inventoryItemId: dest.id,
          type: 'TRANSFER_IN',
          quantity: qty,
          reason: `Transfer from ${t.fromBranchId}: ${t.id}`,
          reference: t.id,
        },
      });
      await tx.stockTransferItem.update({
        where: { id: it.id },
        data: { qtyReceived: qty },
      });
    }
    return tx.stockTransfer.update({
      where: { id: t.id },
      data: { status: 'RECEIVED', receivedAt: new Date(), receivedById: user.id },
      include: {
        items: { include: { inventoryItem: { select: { id: true, sku: true, name: true, unit: true } } } },
        fromBranch: { select: { id: true, code: true, name: true } },
        toBranch: { select: { id: true, code: true, name: true } },
      },
    });
  });
  return ok(c, { transfer: updated });
});

// Cancel a DRAFT or IN_TRANSIT transfer. If IN_TRANSIT, restore source stock.
transferRoutes.post('/:id/cancel', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const t = await prisma.stockTransfer.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!t) return fail(c, 'NotFound', 'Transfer not found', 404);
  if (t.status === 'RECEIVED' || t.status === 'CANCELLED') {
    return fail(c, 'InvalidState', `Transfer is ${t.status}, cannot cancel`, 400);
  }
  if (!userHasBranchAccess(user.branchAccess, t.fromBranchId) &&
      !userHasBranchAccess(user.branchAccess, t.toBranchId)) {
    return fail(c, 'NoAccess', 'No access to this transfer', 403);
  }
  const updated = await prisma.$transaction(async (tx) => {
    if (t.status === 'IN_TRANSIT') {
      // Restore source inventory
      for (const it of t.items) {
        await tx.inventoryItem.update({
          where: { id: it.inventoryItemId },
          data: { quantity: { increment: it.qtyTransferred } },
        });
        await tx.inventoryLog.create({
          data: {
            inventoryItemId: it.inventoryItemId,
            type: 'TRANSFER_IN',
            quantity: it.qtyTransferred,
            reason: `Transfer ${t.id} cancelled, stock returned`,
            reference: t.id,
          },
        });
      }
    }
    return tx.stockTransfer.update({
      where: { id: t.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      include: { items: true },
    });
  });
  void user; // user id can be recorded in reason if desired
  return ok(c, { transfer: updated });
});
