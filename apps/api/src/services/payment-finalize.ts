import { Prisma } from '@prisma/client';
import { prisma } from '@pos/db';
import { logger } from '../logger.js';
import { wsBus } from '../lib/ws-bus.js';
import { applyOnPayment } from './loyalty.js';
import { dispatch as dispatchReceipt } from './receipt-delivery.js';
import {
  computeAndSnapshotForOrderItem,
  restoreToBatches,
  enqueueRecalcForInventoryItem,
} from './hpp-recalculator.js';

export type FinalizeProvider = 'CASH' | 'MIDTRANS' | 'XENDIT' | 'BANK_TRANSFER';
export type FinalizeMethod = 'CASH' | 'QRIS' | 'VIRTUAL_ACCOUNT' | 'EWALLET' | 'MANUAL_TRANSFER';

export interface FinalizeInput {
  orderId: string;
  userId: string;
  payment: {
    provider: FinalizeProvider;
    method: FinalizeMethod;
    externalId: string;
    amountCents: number;
  };
  /** raw provider payload to stash on Payment.providerRaw */
  providerRaw?: Prisma.InputJsonValue;
}

export interface LowStockAlert {
  itemId: string;
  name: string;
  currentStock: number;
  minStock: number;
}

export interface FinalizeResult {
  order: Awaited<ReturnType<typeof prisma.order.findUnique>> & {
    items: Awaited<ReturnType<typeof prisma.orderItem.findMany>>;
    payments: Awaited<ReturnType<typeof prisma.payment.findMany>>;
  };
  payment: Awaited<ReturnType<typeof prisma.payment.create>>;
  lowStockAlerts: LowStockAlert[];
}

/**
 * Atomically:
 *   1. Loads order with items + recipes + inventory items
 *   2. Sets order.status=PAID, closedAt, closedById
 *   3. Creates a Payment row with status=PAID
 *   4. For each OrderItem x Recipe: decrements InventoryItem.quantity
 *      (with conditional check so stock cannot go negative), and writes
 *      an InventoryLog row of type USAGE.
 *   5. Collects low-stock alerts where quantity < reorderPoint.
 *
 * All steps run inside a single prisma.$transaction. If any step throws,
 * the whole operation is rolled back.
 */
export async function finalizeOrderPayment(input: FinalizeInput): Promise<FinalizeResult> {
  const { orderId, userId, payment } = input;

  // Load outside the transaction (read-only); the transaction re-reads
  // inventory rows and uses updateMany with a stock guard.
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          menuItem: {
            include: {
              recipes: { include: { inventoryItem: true } },
            },
          },
        },
      },
      payments: true,
    },
  });
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }
  if (order.status === 'PAID') {
    throw new Error(`Order ${orderId} is already PAID`);
  }
  if (order.status === 'VOIDED' || order.status === 'REFUNDED' || order.status === 'CANCELLED') {
    throw new Error(`Order ${orderId} is closed (${order.status})`);
  }

  const lowStockAlerts: LowStockAlert[] = [];

  const result = await prisma.$transaction(async (tx) => {
    // 1. Consume inventory per recipe using FIFO batches + snapshot
    //    the per-order HPP for audit / margin reporting. The
    //    `consumeFromBatches` call also handles the per-ingredient
    //    shortfall error (when a batch is exhausted) and the
    //    `computeAndSnapshotForOrderItem` helper writes the locked
    //    HPP value to OrderItem.hppCentsUsed plus the
    //    batchConsumptions audit trail.
    for (const item of order.items) {
      const recipes = item.menuItem?.recipes ?? [];
      if (recipes.length === 0) {
        // No recipe — still snapshot, fall back to MenuItem.costCents
        // in the helper. Don't fail the order; legacy items just
        // contribute zero HPP and the report flags them.
        await computeAndSnapshotForOrderItem(tx, item.id, item.menuItemId, item.quantity);
        continue;
      }

      // Compute HPP + write the locked snapshot in one shot. The
      // helper also drives the per-ingredient FIFO consumption.
      const result = await computeAndSnapshotForOrderItem(
        tx,
        item.id,
        item.menuItemId,
        item.quantity,
      );
      if (result.shortfall) {
        // Stock ran out mid-recipe. Surface the same hard error the
        // legacy code did — better to fail the order than to ship a
        // dish with no record of cost.
        throw new Error(
          `Insufficient stock for ${item.nameSnapshot} (order ${order.orderNumber})`,
        );
      }

      // Mirror batch consumption back to InventoryItem.quantity +
      // InventoryLog for backward-compat with the pre-batch
      // reporting/UI. The authoritative stock is the sum of
      // InventoryBatch.qtyRemaining, but other parts of the app still
      // read InventoryItem.quantity directly.
      const perInv = new Map<string, { qty: number; costPerUnit: number; batches: number }>();
      for (const c of result.consumptions) {
        const prev = perInv.get(c.inventoryItemId);
        if (prev) {
          prev.qty += c.qty;
          prev.costPerUnit = c.costPerUnit; // weighted by consumption, simplified
          prev.batches += 1;
        } else {
          perInv.set(c.inventoryItemId, { qty: c.qty, costPerUnit: c.costPerUnit, batches: 1 });
        }
      }
      for (const [invId, agg] of perInv.entries()) {
        const totalRemaining = await tx.inventoryBatch.aggregate({
          where: { inventoryItemId: invId, qtyRemaining: { gt: 0 } },
          _sum: { qtyRemaining: true },
        });
        const sum = totalRemaining._sum.qtyRemaining ?? new Prisma.Decimal(0);
        await tx.inventoryItem.update({
          where: { id: invId },
          data: { quantity: sum },
        });
        await tx.inventoryLog.create({
          data: {
            inventoryItemId: invId,
            type: 'USAGE',
            quantity: new Prisma.Decimal(agg.qty),
            unitCostCents: Math.round(agg.costPerUnit),
            reason: `Order ${order.orderNumber}`,
            reference: order.id,
          },
        });
      }
    }

    // 2. Create Payment. The Prisma `PaymentMethod` enum does not
    // include VIRTUAL_ACCOUNT in the current migration, so we cast to
    // the closest known method. Once a future migration adds the new
    // enum value, the cast can be removed.
    const paymentMethodMap: Record<FinalizeMethod, string> = {
      CASH: 'CASH',
      QRIS: 'QRIS',
      VIRTUAL_ACCOUNT: 'EWALLET',
      EWALLET: 'EWALLET',
      MANUAL_TRANSFER: 'MANUAL_TRANSFER',
    };
    const created = await tx.payment.create({
      data: {
        orderId: order.id,
        provider: payment.provider,
        method: paymentMethodMap[payment.method] as any,
        status: 'PAID',
        amountCents: payment.amountCents,
        reference: payment.externalId,
        providerRaw: input.providerRaw ?? Prisma.JsonNull,
        paidAt: new Date(),
      },
    });

    // 3. Close order
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        closedAt: new Date(),
        closedById: userId,
      },
      include: { items: true, payments: true },
    });

    return { updated, payment: created };
  });

  // Post-commit: enqueue HPP recalc for every menu item in this order
  // (the FIFO consumption may have closed batches, which can shift the
  // "current HPP" of remaining menus).
  for (const item of order.items) {
    for (const recipe of item.menuItem?.recipes ?? []) {
      void enqueueRecalcForInventoryItem(recipe.inventoryItemId);
    }
  }

  // Post-commit: collect low-stock alerts (best-effort, non-blocking).
  try {
    const invItems = await prisma.inventoryItem.findMany({
      where: { isActive: true },
    });
    for (const i of invItems) {
      const q = new Prisma.Decimal(i.quantity as unknown as string);
      const rp = new Prisma.Decimal(i.reorderPoint as unknown as string);
      if (q.lt(rp)) {
        lowStockAlerts.push({
          itemId: i.id,
          name: i.name,
          currentStock: q.toNumber(),
          minStock: rp.toNumber(),
        });
      }
    }
  } catch (e) {
    logger.warn({ err: e }, 'low stock check failed (non-fatal)');
  }

  logger.info(
    {
      orderId: order.id,
      orderNumber: order.orderNumber,
      paymentId: result.payment.id,
      lowStockCount: lowStockAlerts.length,
    },
    'event: order.paid (finalized)'
  );

  wsBus.broadcast({
    type: 'order.paid',
    orderId: order.id,
    orderNumber: order.orderNumber,
    totalCents: order.totalCents,
    status: 'PAID',
    at: Date.now(),
  });

  // Sprint 8.8 — loyalty earn hook. Defensive: loyalty is a downstream
  // effect of the payment, never a precondition. Wrap in try/catch and
  // log a warn if anything fails; the order is still considered paid.
  try {
    await applyOnPayment(order.id, order.customerId ?? null, order.totalCents, userId);
  } catch (e) {
    logger.warn(
      { err: (e as Error).message, orderId: order.id, customerId: order.customerId },
      'loyalty earn hook failed (non-fatal)',
    );
  }

  // Sprint 8.9 — digital receipt hook. Defensive: delivery is a downstream
  // effect of the payment, never a precondition. We kick off a non-blocking
  // attempt if the order is linked to a customer that has a phone or
  // email. Failures (incl. WA/SMTP not configured) only land in
  // ReceiptDelivery rows; the order is still considered paid.
  if (order.customerId) {
    void (async () => {
      try {
        const customer = await prisma.customer.findUnique({
          where: { id: order.customerId! },
          select: { phone: true, email: true },
        });
        const channels: Array<'WHATSAPP' | 'EMAIL'> = [];
        if (customer?.phone) channels.push('WHATSAPP');
        if (customer?.email) channels.push('EMAIL');
        if (channels.length === 0) return;
        await dispatchReceipt(order.id, channels);
      } catch (e) {
        logger.warn(
          { err: (e as Error).message, orderId: order.id },
          'receipt delivery hook failed (non-fatal)',
        );
      }
    })();
  }

  return {
    order: result.updated as FinalizeResult['order'],
    payment: result.payment,
    lowStockAlerts,
  };
}

/**
 * Restore inventory for a refunded/voided order. Used by the refund flow.
 *
 * Two-layer model:
 *   1. Re-allocate InventoryBatch.qtyRemaining from the saved
 *      OrderItem.batchConsumptions audit row (authoritative).
 *   2. Mirror the new total back to InventoryItem.quantity for
 *      backward-compat with the pre-batch reporting/UI.
 */
export async function restoreInventoryForOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          menuItem: { include: { recipes: { include: { inventoryItem: true } } } },
        },
      },
    },
  });
  if (!order) throw new Error(`Order ${orderId} not found`);

  const invIdsTouched = new Set<string>();

  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      // Prefer the saved batch consumption audit trail — it tells us
      // *exactly* which batches to restore. Falls back to the legacy
      // recipe-only path for orders paid before the column existed.
      const consumptions = (item.batchConsumptions as unknown as Array<{
        batchId: string;
        inventoryItemId: string;
        qty: number;
        costPerUnit: number;
      }> | null) ?? null;

      if (consumptions && consumptions.length > 0) {
        await restoreToBatches(tx, consumptions);
        for (const c of consumptions) {
          invIdsTouched.add(c.inventoryItemId);
        }
      } else {
        const recipes = item.menuItem?.recipes ?? [];
        for (const recipe of recipes) {
          const perUnit = new Prisma.Decimal(recipe.quantity as unknown as string);
          const orderQty = new Prisma.Decimal(item.quantity);
          const total = perUnit.mul(orderQty);

          const inv = await tx.inventoryItem.findUnique({ where: { id: recipe.inventoryItemId } });
          if (!inv) continue;
          const current = new Prisma.Decimal(inv.quantity as unknown as string);
          const next = current.plus(total);
          await tx.inventoryItem.update({
            where: { id: inv.id },
            data: { quantity: next },
          });
          invIdsTouched.add(recipe.inventoryItemId);
        }
      }
    }

    // One InventoryLog per inventory item, summarizing the refund
    for (const invId of invIdsTouched) {
      await tx.inventoryLog.create({
        data: {
          inventoryItemId: invId,
          type: 'USAGE', // type reuse — sign of quantity carries the meaning
          quantity: new Prisma.Decimal(0), // batch restoration does the real delta
          reason: `Refund ${order.orderNumber}`,
          reference: order.id,
        },
      });
    }

    // Mirror back to InventoryItem.quantity
    for (const invId of invIdsTouched) {
      const totalRemaining = await tx.inventoryBatch.aggregate({
        where: { inventoryItemId: invId, qtyRemaining: { gt: 0 } },
        _sum: { qtyRemaining: true },
      });
      const sum = totalRemaining._sum.qtyRemaining ?? new Prisma.Decimal(0);
      await tx.inventoryItem.update({
        where: { id: invId },
        data: { quantity: sum },
      });
    }
  });

  // Post-commit: enqueue HPP recalc for the restored items
  for (const invId of invIdsTouched) {
    void enqueueRecalcForInventoryItem(invId);
  }

  logger.info({ orderId, orderNumber: order.orderNumber }, 'inventory restored (refund)');
}
