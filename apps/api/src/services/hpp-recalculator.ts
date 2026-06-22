// apps/api/src/services/hpp-recalculator.ts
//
// FIFO-based HPP recalculation engine.
//
// Computes `MenuItem.costCents` from the current oldest-available
// `InventoryBatch` rows for each ingredient in the menu's recipe. The
// whole pipeline is in-process (no Redis) because:
//
//   1. The recalc is fast — a single SELECT per menu, no fan-out
//      transactions.
//   2. Crash-loss is acceptable: if a recalc is in flight when the
//      process dies, the next mutation re-triggers it. The
//      `OrderItem.hppCentsUsed` snapshot is what actually protects the
//      accounting — MenuItem.costCents is only used for *current*
//      display.
//
// Public API:
//
//   - `enqueueRecalcForMenuItem(menuItemId)` — non-blocking, debounced.
//   - `enqueueRecalcForInventoryItem(inventoryItemId)` — finds all menus
//     that use this ingredient and re-queues each.
//   - `computeAndSnapshotForOrderItem(orderItem, qty)` — synchronous
//     version used by payment-finalize. Returns the locked HPP value
//     and writes it to OrderItem.hppCentsUsed + batchConsumptions.
//   - `consumeFromBatches(...)` — pure FIFO allocation logic, exported
//     for testing.
//
// Throttle: writes to MenuItem.costCents are skipped if the new HPP
// differs by less than 1% from the current value. This keeps the
// customer-facing menu price display stable even as the per-batch
// composition shifts around.

import { Prisma } from '@pos/db';
import { prisma } from '@pos/db';
import { logger } from '../logger.js';

// How small a delta is considered "noise". 1% by default — so an
// existing Rp 10,000 HPP only updates if the new value differs by more
// than Rp 100. This is the throttle that keeps the menu UI from
// flickering on every sale.
const THROTTLE_PCT = 0.01;

// One job per menu item; the Map collapses repeated triggers into a
// single pending recompute. Keyed by menuItemId.
const pending = new Map<string, Promise<void>>();

// Debounce timer per menuItemId. When the same item is enqueued again
// before the timer fires, we reset the timer.
const debounceTimers = new Map<string, NodeJS.Timeout>();

// How long to wait for the burst to settle before running the recalc.
// Short enough that owner-facing screens feel real-time, long enough
// to collapse 10-order bursts into a single DB write.
const DEBOUNCE_MS = 750;

/**
 * One FIFO batch allocation step. Pulls from the oldest batch first.
 */
export interface BatchConsumption {
  batchId: string;
  inventoryItemId: string;
  qty: number; // raw decimal number (not string)
  costPerUnit: number;
}

export interface ConsumptionResult {
  hppCents: number; // total cost for `qtyNeeded` units, in cents
  consumptions: BatchConsumption[];
  /** True if any batch is exhausted (qtyRemaining would have gone < 0). */
  shortfall: boolean;
}

/**
 * Pure FIFO batch consumption. Returns the per-batch allocation list
 * and the total cost for `qtyNeeded` units of `inventoryItemId`.
 *
 * @param inventoryItemId The ingredient to draw from.
 * @param qtyNeeded       How many units of the ingredient we need.
 * @param tx              Prisma transaction client. Required because we
 *                        update `qtyRemaining` on every batch we touch.
 */
export async function consumeFromBatches(
  tx: Prisma.TransactionClient,
  inventoryItemId: string,
  qtyNeeded: number,
): Promise<ConsumptionResult> {
  const consumptions: BatchConsumption[] = [];
  let totalCostCents = 0;
  let remaining = qtyNeeded;
  let shortfall = false;

  // Pull oldest-first. The index `inventoryItemId, receivedAt` makes
  // this cheap.
  const batches = await tx.inventoryBatch.findMany({
    where: {
      inventoryItemId,
      qtyRemaining: { gt: 0 },
    },
    orderBy: { receivedAt: 'asc' },
  });

  for (const batch of batches) {
    if (remaining <= 0) break;
    const available = Number(batch.qtyRemaining);
    if (available <= 0) continue;

    const take = Math.min(available, remaining);
    const costPerUnit = Number(batch.costPerUnit);
    const costCents = Math.round(take * costPerUnit);

    consumptions.push({
      batchId: batch.id,
      inventoryItemId,
      qty: take,
      costPerUnit,
    });
    totalCostCents += costCents;
    remaining -= take;

    // Decrement the batch. If this empties it, mark closedAt so the
    // audit log shows when the batch transitioned.
    const newRemaining = available - take;
    await tx.inventoryBatch.update({
      where: { id: batch.id },
      data: {
        qtyRemaining: new Prisma.Decimal(newRemaining),
        closedAt: newRemaining <= 0 ? new Date() : null,
      },
    });
  }

  if (remaining > 0) {
    shortfall = true;
  }

  return { hppCents: totalCostCents, consumptions, shortfall };
}

/**
 * Restore batches from a previously-recorded consumption. Used by
 * payment-finalize when an order is voided or refunded.
 *
 * Reverses `consumeFromBatches` — bumps `qtyRemaining` back up on each
 * batch and clears `closedAt` if appropriate.
 */
export async function restoreToBatches(
  tx: Prisma.TransactionClient,
  consumptions: BatchConsumption[],
): Promise<void> {
  for (const c of consumptions) {
    const batch = await tx.inventoryBatch.findUnique({ where: { id: c.batchId } });
    if (!batch) continue;
    const newRemaining = Number(batch.qtyRemaining) + c.qty;
    await tx.inventoryBatch.update({
      where: { id: c.batchId },
      data: {
        qtyRemaining: new Prisma.Decimal(newRemaining),
        closedAt: newRemaining > 0 ? null : batch.closedAt,
      },
    });
  }
}

/**
 * Compute the *current* HPP of a menu item without writing. Walks the
 * recipe, calls consumeFromBatches for each ingredient — but in a
 * read-only pass (we use a regular client, not a transaction, and
 * skip the qtyRemaining decrement by reading batches directly).
 *
 * This is used by:
 *   - The background debounced recalc (then it writes the result).
 *   - The order-time snapshot (writes both MenuItem.costCents and
 *     OrderItem.hppCentsUsed).
 */
export async function computeMenuHpp(
  menuItemId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ hppCents: number; breakdown: Array<{ inventoryItemId: string; name: string; qty: number; costPerUnit: number; cents: number }>; shortfall: boolean }> {
  const recipes = await tx.recipe.findMany({
    where: { menuItemId },
    include: { inventoryItem: true },
  });

  if (recipes.length === 0) {
    return { hppCents: 0, breakdown: [], shortfall: false };
  }

  let totalCents = 0;
  let shortfall = false;
  const breakdown: Array<{ inventoryItemId: string; name: string; qty: number; costPerUnit: number; cents: number }> = [];

  for (const r of recipes) {
    // Read oldest batch directly (read-only path). If multiple batches
    // exist, we use the oldest for "current HPP" display — same as
    // what the FIFO engine would consume first.
    const oldestBatch = await tx.inventoryBatch.findFirst({
      where: {
        inventoryItemId: r.inventoryItemId,
        qtyRemaining: { gt: 0 },
      },
      orderBy: { receivedAt: 'asc' },
    });

    const qty = Number(r.quantity);
    if (!oldestBatch) {
      shortfall = true;
      breakdown.push({
        inventoryItemId: r.inventoryItemId,
        name: r.inventoryItem.name,
        qty,
        costPerUnit: 0,
        cents: 0,
      });
      continue;
    }

    const costPerUnit = Number(oldestBatch.costPerUnit);
    const cents = Math.round(qty * costPerUnit);
    totalCents += cents;
    breakdown.push({
      inventoryItemId: r.inventoryItemId,
      name: r.inventoryItem.name,
      qty,
      costPerUnit,
      cents,
    });
  }

  return { hppCents: totalCents, breakdown, shortfall };
}

/**
 * Debounced, throttled recalc. Non-blocking.
 *
 * Resets the timer if called again for the same menuItemId before
 * `DEBOUNCE_MS` elapses. When the timer fires, runs the actual
 * compute + write.
 */
export function enqueueRecalcForMenuItem(menuItemId: string): void {
  const existing = debounceTimers.get(menuItemId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    debounceTimers.delete(menuItemId);
    void runRecalcForMenuItem(menuItemId);
  }, DEBOUNCE_MS);
  debounceTimers.set(menuItemId, timer);
}

/**
 * Reverse-lookup: which menu items use this ingredient? Enqueue each.
 * Called from the InventoryBatch / InventoryItem mutation paths.
 */
export async function enqueueRecalcForInventoryItem(inventoryItemId: string): Promise<void> {
  const recipes = await prisma.recipe.findMany({
    where: { inventoryItemId },
    select: { menuItemId: true },
  });
  for (const r of recipes) {
    enqueueRecalcForMenuItem(r.menuItemId);
  }
}

async function runRecalcForMenuItem(menuItemId: string): Promise<void> {
  // Coalesce concurrent runs. If a recalc is already in flight for
  // this menuItem, wait for it before re-running (but don't enqueue
  // another run — the in-flight one already used the latest data).
  const prior = pending.get(menuItemId);
  if (prior) {
    await prior.catch(() => undefined);
  }

  const job = (async () => {
    try {
      const current = await prisma.menuItem.findUnique({
        where: { id: menuItemId },
        select: { costCents: true },
      });
      if (!current) return;

      const { hppCents, shortfall } = await computeMenuHpp(menuItemId);
      const oldCents = current.costCents;

      // Throttle: skip writes for tiny deltas. We still log a "would
      // have updated" trace for ops visibility.
      if (oldCents > 0 && Math.abs(hppCents - oldCents) / oldCents < THROTTLE_PCT) {
        logger.debug(
          { menuItemId, oldCents, newCents: hppCents },
          'hpp_recalc_throttled',
        );
        return;
      }

      await prisma.menuItem.update({
        where: { id: menuItemId },
        data: { costCents: hppCents },
      });

      logger.info(
        { menuItemId, oldCents, newCents: hppCents, shortfall },
        'hpp_recalc_done',
      );
    } catch (err) {
      logger.error({ err, menuItemId }, 'hpp_recalc_failed');
    }
  })();

  pending.set(menuItemId, job);
  try {
    await job;
  } finally {
    if (pending.get(menuItemId) === job) {
      pending.delete(menuItemId);
    }
  }
}

/**
 * Synchronous HPP snapshot for an order line. Called from
 * payment-finalize, inside the payment transaction. Returns the value
 * to write to `OrderItem.hppCentsUsed` and the per-batch audit trail.
 *
 * Does NOT update MenuItem.costCents — the post-commit debounced
 * recalc will pick that up. The snapshot is locked at the order's
 * payment time and never changes.
 */
export async function computeAndSnapshotForOrderItem(
  tx: Prisma.TransactionClient,
  orderItemId: string,
  menuItemId: string,
  quantity: number,
): Promise<{ hppCents: number; consumptions: BatchConsumption[]; shortfall: boolean }> {
  const recipes = await tx.recipe.findMany({
    where: { menuItemId },
    include: { inventoryItem: true },
  });

  if (recipes.length === 0) {
    // No recipe defined — fall back to MenuItem.costCents (legacy /
    // override). This keeps existing orders working until their recipe
    // is set up.
    const menuItem = await tx.menuItem.findUnique({
      where: { id: menuItemId },
      select: { costCents: true },
    });
    const fallback = (menuItem?.costCents ?? 0) * quantity;
    return { hppCents: fallback, consumptions: [], shortfall: false };
  }

  // Combine all consumptions across all ingredients in this order line.
  const allConsumptions: BatchConsumption[] = [];
  let totalCents = 0;
  let shortfall = false;

  for (const r of recipes) {
    const needed = Number(r.quantity) * quantity;
    const result = await consumeFromBatches(tx, r.inventoryItemId, needed);
    allConsumptions.push(...result.consumptions);
    totalCents += result.hppCents;
    if (result.shortfall) shortfall = true;
  }

  await tx.orderItem.update({
    where: { id: orderItemId },
    data: {
      hppCentsUsed: totalCents,
      batchConsumptions: allConsumptions as unknown as Prisma.InputJsonValue,
    },
  });

  return { hppCents: totalCents, consumptions: allConsumptions, shortfall };
}
