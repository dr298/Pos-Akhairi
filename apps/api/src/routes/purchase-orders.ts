// apps/api/src/routes/purchase-orders.ts
//
// Sprint 9.5 — Purchase Orders. Single branch-less restaurant.
//
// Status flow:
//   DRAFT  →  SENT  →  PARTIAL → RECEIVED
//                  ↘            ↘
//                   CANCELLED (allowed from DRAFT or SENT)
//
// "Receive" can be called multiple times — each call applies incremental
// inventory + InventoryLog entries. The PO auto-transitions to RECEIVED
// when every line is fully received, or PARTIAL if at least one line
// has been partially received but not all are complete.
//
// Endpoints (all require auth):
//   GET   /api/purchase-orders?status=DRAFT
//   GET   /api/purchase-orders/:id
//   POST  /api/purchase-orders                          (MANAGER+)
//   PATCH /api/purchase-orders/:id                      (MANAGER+)
//   POST  /api/purchase-orders/:id/send                 (MANAGER+)
//   POST  /api/purchase-orders/:id/receive              (MANAGER+)
//   POST  /api/purchase-orders/:id/cancel               (OWNER)
//
// PO numbers are generated as `PO-YYYYMMDD-NNNN` per day. The sequence
// resets daily; uniqueness is enforced by the @@unique([poNumber]) index.

import { Hono } from 'hono';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { incCounter } from '../middleware/metrics.js';

export const purchaseOrderRoutes = new Hono<AppEnv>();

purchaseOrderRoutes.use('*', requireAuth);

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtDateOnly(d: Date): string {
  // YYYYMMDD in local time (Asia/Jakarta is the system TZ, so this is fine).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Generate the next PO number for a given day.
 * Format: `PO-YYYYMMDD-NNNN`. Sequence is per-day and resets daily.
 * The `poNumber` unique index guarantees we never collide even under
 * concurrent creation — we retry on P2002.
 */
async function generatePoNumber(tx: Prisma.TransactionClient): Promise<string> {
  const today = new Date();
  const dayPart = fmtDateOnly(today);
  const prefix = `PO-${dayPart}-`;
  // Look at existing PO numbers for today to find the highest seq.
  const todays = await tx.purchaseOrder.findMany({
    where: { poNumber: { startsWith: prefix } },
    select: { poNumber: true },
  });
  let maxSeq = 0;
  for (const p of todays) {
    const seq = parseInt(p.poNumber.slice(prefix.length), 10);
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
}

// ─── Schemas ───────────────────────────────────────────────────────────────

const itemSchema = z.object({
  inventoryItemId: z.string().min(1).max(50),
  // qtyOrdered is forward-compatible with decimal quantities — the DB
  // stores it as String. Accept any positive finite number.
  qtyOrdered: z.number().positive().finite(),
  unitCostCents: z.number().int().nonnegative(),
  notes: z.string().max(200).optional().nullable(),
});

const createSchema = z.object({
  supplierId: z.string().min(1).max(50),
  notes: z.string().max(1000).optional().nullable(),
  expectedAt: z.string().max(40).optional().nullable(),
  items: z.array(itemSchema).min(1).max(200),
});

const updateSchema = z.object({
  notes: z.string().max(1000).optional().nullable(),
  expectedAt: z.string().max(40).optional().nullable(),
  // Items can be replaced on a DRAFT only. Applied as a delete+create.
  items: z.array(itemSchema).min(1).max(200).optional(),
});

const receiveSchema = z.object({
  items: z
    .array(
      z.object({
        poItemId: z.string().min(1).max(50),
        qtyReceived: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

// ─── List ──────────────────────────────────────────────────────────────────

purchaseOrderRoutes.get('/', async (c) => {
  const status = c.req.query('status');
  const supplierId = c.req.query('supplierId');

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: {
      ...(status ? { status: status as 'DRAFT' | 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED' } : {}),
      ...(supplierId ? { supplierId } : {}),
    },
    include: {
      supplier: { select: { id: true, name: true, contactName: true, phone: true } },
      createdBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return ok(c, { purchaseOrders });
});

// ─── Detail ────────────────────────────────────────────────────────────────

purchaseOrderRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      createdBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      items: {
        include: {
          // We don't have a direct Prisma relation PurchaseOrderItem ->
          // InventoryItem (intentionally — Sprint 9.5 is additive and we
          // don't want to change InventoryItem). Look it up in a batch.
        },
      },
    },
  });
  if (!po) return fail(c, 'NotFound', 'Purchase order not found', 404);
  // Enrich items with inventory item summary (name, sku, unit).
  const invIds = Array.from(new Set(po.items.map((i) => i.inventoryItemId)));
  const invItems = invIds.length
    ? await prisma.inventoryItem.findMany({
        where: { id: { in: invIds } },
        select: { id: true, sku: true, name: true, unit: true, costPerUnit: true },
      })
    : [];
  const invMap = new Map(invItems.map((i) => [i.id, i]));
  const enrichedItems = po.items.map((it) => ({
    ...it,
    // qtyOrdered stored as String; surface as number for the web.
    qtyOrderedNum: Number(it.qtyOrdered),
    inventoryItem: invMap.get(it.inventoryItemId) ?? null,
  }));
  return ok(c, {
    purchaseOrder: {
      ...po,
      // BigInt → string for JSON serialization
      subtotalCents: po.subtotalCents.toString(),
      totalCents: po.totalCents.toString(),
      items: enrichedItems,
    },
  });
});

// ─── Create ────────────────────────────────────────────────────────────────

purchaseOrderRoutes.post(
  '/',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid PO payload', 400, parsed.error.issues);
    }
    const input = parsed.data;
    // Validate supplier exists and is active
    const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) return fail(c, 'NotFound', 'Supplier not found', 404);
    if (!supplier.isActive) {
      return fail(c, 'ValidationError', 'Supplier is inactive', 400);
    }
    // Validate inventory items exist
    const invIds = input.items.map((i) => i.inventoryItemId);
    const invItems = await prisma.inventoryItem.findMany({
      where: { id: { in: invIds } },
    });
    if (invItems.length !== new Set(invIds).size) {
      return fail(c, 'ValidationError', 'Some inventory items not found', 400);
    }
    // Compute totals
    let subtotal = 0;
    for (const it of input.items) {
      // qtyOrdered * unitCostCents (in cents). Subtotal in cents.
      subtotal += Math.round(it.qtyOrdered * it.unitCostCents);
    }
    const total = subtotal; // No tax/discount at v1
    const expectedAt = input.expectedAt ? new Date(input.expectedAt) : null;
    if (expectedAt && isNaN(expectedAt.getTime())) {
      return fail(c, 'ValidationError', 'Invalid expectedAt date', 400);
    }

    // Create inside a transaction; retry on PO-number collision.
    let purchaseOrder;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        purchaseOrder = await prisma.$transaction(async (tx) => {
          const poNumber = await generatePoNumber(tx);
          return tx.purchaseOrder.create({
            data: {
              poNumber,
              supplierId: input.supplierId,
              status: 'DRAFT',
              subtotalCents: BigInt(subtotal),
              totalCents: BigInt(total),
              expectedAt,
              notes: input.notes ?? null,
              createdById: user.id,
              items: {
                create: input.items.map((i) => ({
                  inventoryItemId: i.inventoryItemId,
                  qtyOrdered: String(i.qtyOrdered),
                  qtyReceived: 0,
                  unitCostCents: i.unitCostCents,
                  notes: i.notes ?? null,
                })),
              },
            },
            include: { items: true },
          });
        });
        break;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          // PO number collision — retry with a fresh sequence.
          logger.warn({ attempt }, 'PO number collision, retrying');
          continue;
        }
        throw e;
      }
    }
    if (!purchaseOrder) {
      return fail(c, 'Internal', 'Failed to generate unique PO number', 500);
    }
    incCounter('pos_purchase_orders_created_total', 'POs created');
    logger.info(
      { poId: purchaseOrder.id, poNumber: purchaseOrder.poNumber },
      'purchase order created',
    );
    return ok(
      c,
      {
        purchaseOrder: {
          ...purchaseOrder,
          subtotalCents: purchaseOrder.subtotalCents.toString(),
          totalCents: purchaseOrder.totalCents.toString(),
        },
      },
      201,
    );
  },
);

// ─── Update (DRAFT only) ───────────────────────────────────────────────────

purchaseOrderRoutes.patch(
  '/:id',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid PO payload', 400, parsed.error.issues);
    }
    const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!existing) return fail(c, 'NotFound', 'PO not found', 404);
    if (existing.status !== 'DRAFT') {
      return fail(c, 'InvalidState', `Cannot edit PO in status ${existing.status}`, 409);
    }
    const data: Record<string, unknown> = {};
    if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
    if (parsed.data.expectedAt !== undefined) {
      data.expectedAt = parsed.data.expectedAt ? new Date(parsed.data.expectedAt) : null;
    }
    let newItems: { inventoryItemId: string; qtyOrdered: string; unitCostCents: number; notes: string | null }[] | undefined;
    if (parsed.data.items) {
      // Validate inventory items exist
      const invIds = parsed.data.items.map((i) => i.inventoryItemId);
      const invItems = await prisma.inventoryItem.findMany({
        where: { id: { in: invIds } },
      });
      if (invItems.length !== new Set(invIds).size) {
        return fail(c, 'ValidationError', 'Some inventory items not found', 400);
      }
      let subtotal = 0;
      for (const it of parsed.data.items) {
        subtotal += Math.round(it.qtyOrdered * it.unitCostCents);
      }
      data.subtotalCents = BigInt(subtotal);
      data.totalCents = BigInt(subtotal);
      newItems = parsed.data.items.map((i) => ({
        inventoryItemId: i.inventoryItemId,
        qtyOrdered: String(i.qtyOrdered),
        unitCostCents: i.unitCostCents,
        notes: i.notes ?? null,
      }));
    }
    const updated = await prisma.$transaction(async (tx) => {
      if (newItems) {
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseOrderItem.createMany({
          data: newItems.map((ni) => ({ ...ni, purchaseOrderId: id })),
        });
      }
      return tx.purchaseOrder.update({ where: { id }, data });
    });
    return ok(c, {
      purchaseOrder: {
        ...updated,
        subtotalCents: updated.subtotalCents.toString(),
        totalCents: updated.totalCents.toString(),
      },
    });
  },
);

// ─── Send (DRAFT → SENT) ───────────────────────────────────────────────────

purchaseOrderRoutes.post(
  '/:id/send',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const po = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) return fail(c, 'NotFound', 'PO not found', 404);
    if (po.status !== 'DRAFT') {
      return fail(c, 'InvalidState', `Cannot send PO in status ${po.status}`, 409);
    }
    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'SENT' },
    });
    incCounter('pos_purchase_orders_sent_total', 'POs sent');
    logger.info({ poId: id, by: user.id }, 'PO sent');
    return ok(c, {
      purchaseOrder: {
        ...updated,
        subtotalCents: updated.subtotalCents.toString(),
        totalCents: updated.totalCents.toString(),
      },
    });
  },
);

// ─── Receive (SENT/PARTIAL → PARTIAL/RECEIVED) ─────────────────────────────

purchaseOrderRoutes.post(
  '/:id/receive',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const parsed = receiveSchema.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid receive payload', 400, parsed.error.issues);
    }
    const overrides = new Map(parsed.data.items.map((i) => [i.poItemId, i.qtyReceived]));

    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!po) return fail(c, 'NotFound', 'PO not found', 404);
    if (po.status !== 'SENT' && po.status !== 'PARTIAL') {
      return fail(c, 'InvalidState', `Cannot receive PO in status ${po.status}`, 409);
    }

    // Validate that every override targets a real PO item and is within
    // (qtyReceived, qtyOrdered]. Skip items not in the override list.
    for (const it of po.items) {
      if (!overrides.has(it.id)) continue;
      const q = overrides.get(it.id)!;
      const qtyOrdered = Number(it.qtyOrdered);
      if (q < it.qtyReceived + 1) {
        return fail(
          c,
          'ValidationError',
          `Item ${it.id}: qtyReceived must exceed current (${it.qtyReceived})`,
          400,
        );
      }
      if (q > qtyOrdered) {
        return fail(
          c,
          'ValidationError',
          `Item ${it.id}: qtyReceived (${q}) exceeds qtyOrdered (${qtyOrdered})`,
          400,
        );
      }
    }

    // Load inventory items in bulk
    const invIds = po.items.map((i) => i.inventoryItemId);
    const invItems = await prisma.inventoryItem.findMany({
      where: { id: { in: invIds } },
    });
    const invMap = new Map(invItems.map((i) => [i.id, i]));

    const result = await prisma.$transaction(async (tx) => {
      let allComplete = true;
      let anyReceived = false;
      for (const it of po.items) {
        const q = overrides.get(it.id) ?? it.qtyReceived;
        if (q === it.qtyReceived) continue; // unchanged
        const inc = q - it.qtyReceived;
        if (inc <= 0) continue;
        const inv = invMap.get(it.inventoryItemId);
        if (!inv) throw new Error(`Inventory item ${it.inventoryItemId} not found`);
        // Bump inventory quantity
        const newQty = Number(inv.quantity) + inc;
        await tx.inventoryItem.update({
          where: { id: inv.id },
          data: { quantity: newQty },
        });
        // Log as PURCHASE movement
        await tx.inventoryLog.create({
          data: {
            inventoryItemId: inv.id,
            type: 'PURCHASE',
            quantity: inc,
            unitCostCents: it.unitCostCents,
            reason: `PO ${po.poNumber} received`,
            reference: po.id,
          },
        });
        // Update PO item qtyReceived
        await tx.purchaseOrderItem.update({
          where: { id: it.id },
          data: { qtyReceived: q },
        });
        anyReceived = true;
      }
      // Recompute status from the new line state
      const refreshedItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: po.id },
      });
      for (const it of refreshedItems) {
        if (it.qtyReceived < Number(it.qtyOrdered)) {
          allComplete = false;
        }
      }
      let newStatus: 'SENT' | 'PARTIAL' | 'RECEIVED';
      if (allComplete) {
        newStatus = 'RECEIVED';
      } else if (anyReceived) {
        newStatus = 'PARTIAL';
      } else {
        // Nothing changed (no overrides matched) — keep current status.
        newStatus = po.status === 'SENT' ? 'SENT' : 'PARTIAL';
      }
      const updated = await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status: newStatus,
          receivedAt: newStatus === 'RECEIVED' ? new Date() : po.receivedAt,
        },
        include: { items: true },
      });
      return updated;
    });

    incCounter('pos_purchase_orders_received_total', 'PO receives', {
      status: result.status,
    });
    logger.info(
      { poId: po.id, newStatus: result.status, by: user.id },
      'PO received',
    );
    return ok(c, {
      purchaseOrder: {
        ...result,
        subtotalCents: result.subtotalCents.toString(),
        totalCents: result.totalCents.toString(),
      },
    });
  },
);

// ─── Cancel (DRAFT/SENT → CANCELLED) ────────────────────────────────────────

purchaseOrderRoutes.post(
  '/:id/cancel',
  requireRole('OWNER'),
  async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const po = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) return fail(c, 'NotFound', 'PO not found', 404);
    if (po.status !== 'DRAFT' && po.status !== 'SENT') {
      return fail(c, 'InvalidState', `Cannot cancel PO in status ${po.status}`, 409);
    }
    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    incCounter('pos_purchase_orders_cancelled_total', 'POs cancelled');
    logger.info({ poId: id, by: user.id }, 'PO cancelled');
    return ok(c, {
      purchaseOrder: {
        ...updated,
        subtotalCents: updated.subtotalCents.toString(),
        totalCents: updated.totalCents.toString(),
      },
    });
  },
);
