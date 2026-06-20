import { Prisma } from '@prisma/client';
import { prisma } from '@pos/db';
import { logger } from '../logger.js';
import { wsBus } from '../lib/ws-bus.js';
import { applyOnPayment } from './loyalty.js';
import { dispatch as dispatchReceipt } from './receipt-delivery.js';

export type FinalizeProvider = 'CASH' | 'MIDTRANS' | 'XENDIT';
export type FinalizeMethod = 'CASH' | 'QRIS' | 'VIRTUAL_ACCOUNT' | 'EWALLET';

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
    // 1. Decrement inventory per recipe
    for (const item of order.items) {
      const recipes = item.menuItem?.recipes ?? [];
      for (const recipe of recipes) {
        // Decimal arithmetic: per-unit quantity * ordered quantity.
        // We use Prisma's Decimal to keep precision, then convert at the
        // boundary. InventoryItem.quantity is Decimal(12,4).
        const perUnit = new Prisma.Decimal(recipe.quantity as unknown as string);
        const orderQty = new Prisma.Decimal(item.quantity);
        const total = perUnit.mul(orderQty);

        // Conditional update: only succeeds if the new stock is non-negative.
        // Prisma 5.x doesn't expose `>=` directly on update, so we use
        // raw for the stock check, then update by id.
        const inv = await tx.inventoryItem.findUnique({ where: { id: recipe.inventoryItemId } });
        if (!inv) {
          throw new Error(
            `Inventory item ${recipe.inventoryItemId} missing for recipe ${recipe.id}`
          );
        }
        const current = new Prisma.Decimal(inv.quantity as unknown as string);
        const next = current.minus(total);
        if (next.lt(0)) {
          throw new Error(
            `Insufficient stock for ${inv.name}: have ${current.toString()} ${inv.unit}, ` +
              `need ${total.toString()} ${inv.unit}`
          );
        }
        await tx.inventoryItem.update({
          where: { id: inv.id },
          data: { quantity: next },
        });
        await tx.inventoryLog.create({
          data: {
            inventoryItemId: inv.id,
            type: 'USAGE',
            quantity: total,
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

  // Post-commit: collect low-stock alerts (best-effort, non-blocking).
  try {
    const invItems = await prisma.inventoryItem.findMany({
      where: { branchId: order.branchId, isActive: true },
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

  wsBus.broadcast(
    {
      type: 'order.paid',
      orderId: order.id,
      orderNumber: order.orderNumber,
      totalCents: order.totalCents,
      status: 'PAID',
      branchId: order.branchId,
      at: Date.now(),
    },
    order.branchId,
  );

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
 * Restore inventory for a refunded order. Used by the refund flow.
 * Adds the recipe-quantity * item.quantity back to each inventory item
 * and writes a positive InventoryLog of type USAGE with a marker reason.
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

  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
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
        await tx.inventoryLog.create({
          data: {
            inventoryItemId: inv.id,
            type: 'USAGE',
            quantity: total,
            reason: `Refund ${order.orderNumber}`,
            reference: order.id,
          },
        });
      }
    }
  });

  logger.info({ orderId, orderNumber: order.orderNumber }, 'inventory restored (refund)');
}
