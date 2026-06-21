// apps/api/src/services/loyalty.ts
//
// Sprint 8.8 — Loyalty service. Pure point-math + DB-touching helpers
// consumed by:
//   - payment-finalize (post-commit hook on order paid → earn points)
//   - orders route (optional customerId on POST /api/orders → attach member)
//   - customers route (manual adjust, balance read)
//
// Design notes
// ------------
// The "aggregator push" rule from the brief applies: loyalty is a
// downstream effect of an order being paid. We never fail the order
// for loyalty reasons — every public entry point is wrapped in
// try/catch and logs a warning.
//
// EARN formula (matches the brief):
//   points = floor((amountCents / 100) * pointsPerRupiah)
//
// REDEEM formula:
//   discountCents = points * rupiahPerPoint
//
// Points never go below zero — redeem() throws if the customer doesn't
// have enough.

import { Prisma } from '@prisma/client';
import { prisma } from '@pos/db';
import { logger } from '../logger.js';
import { incCounter } from '../middleware/metrics.js';

// ─── Public types ───────────────────────────────────────────────────────────

export interface EarnConfig {
  pointsPerRupiah: number;
  isActive: boolean;
}

export interface RedeemConfig {
  rupiahPerPoint: number;
  minRedeemPoints: number;
  isActive: boolean;
}

export interface EarnResult {
  customerId: string;
  points: number;
  transactionId: string;
}

export interface RedeemResult {
  customerId: string;
  points: number;
  discountCents: number;
  transactionId: string;
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

/**
 * Compute the number of points earned for a paid amount. Pure: no DB.
 *
 * Formula: floor((amountCents / 100) * pointsPerRupiah).
 * Negative or zero amounts earn zero points.
 */
export function calculateEarn(amountCents: number, cfg: EarnConfig): number {
  if (!cfg.isActive) return 0;
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
  if (cfg.pointsPerRupiah <= 0) return 0;
  return Math.floor((amountCents / 100) * cfg.pointsPerRupiah);
}

/**
 * Compute the discount (in cents) for redeeming `points` points.
 * Pure: no DB. Throws on invalid input.
 */
export function calculateRedeemDiscount(points: number, cfg: RedeemConfig): number {
  if (!cfg.isActive) {
    throw new Error('Loyalty program is inactive');
  }
  if (!Number.isInteger(points) || points <= 0) {
    throw new Error('points must be a positive integer');
  }
  if (points < cfg.minRedeemPoints) {
    throw new Error(`Minimal redeem ${cfg.minRedeemPoints} poin`);
  }
  if (cfg.rupiahPerPoint <= 0) {
    throw new Error('rupiahPerPoint is not configured');
  }
  return points * cfg.rupiahPerPoint;
}

// ─── Config loader (with safe defaults) ─────────────────────────────────────

/**
 * Load the global loyalty config, returning sane defaults if missing or
 * inactive. The caller can branch on `isActive` to decide whether to earn
 * points. We never throw on missing config — loyalty is optional.
 */
export async function loadLoyaltyConfig(): Promise<{
  pointsPerRupiah: number;
  rupiahPerPoint: number;
  minRedeemPoints: number;
  isActive: boolean;
  signupBonusPoints: number;
  birthdayBonusPoints: number;
  raw: Awaited<ReturnType<typeof prisma.loyaltyConfig.findFirst>>;
}> {
  const raw = await prisma.loyaltyConfig.findFirst();
  return {
    pointsPerRupiah: raw?.pointsPerRupiah ?? 1,
    rupiahPerPoint: raw?.rupiahPerPoint ?? 100,
    minRedeemPoints: raw?.minRedeemPoints ?? 100,
    signupBonusPoints: raw?.signupBonusPoints ?? 0,
    birthdayBonusPoints: raw?.birthdayBonusPoints ?? 0,
    isActive: raw?.isActive ?? false,
    raw,
  };
}

// ─── EARN (called from payment-finalize) ────────────────────────────────────

/**
 * Apply loyalty EARN for a freshly paid order. Idempotent at the orderId
 * level: if a LoyaltyTransaction already references this orderId with
 * type=EARN, we skip (so retries on finalize don't double-credit).
 *
 * Defensive: never throws to the caller. All errors are logged and
 * swallowed — loyalty is a downstream effect of the payment, not a
 * precondition.
 */
export async function applyOnPayment(
  orderId: string,
  customerId: string | null | undefined,
  amountCents: number,
  createdById: string | null,
): Promise<EarnResult | null> {
  if (!customerId) return null;
  if (!Number.isFinite(amountCents) || amountCents <= 0) return null;

  try {
    // Find the customer.
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      logger.warn({ orderId, customerId }, 'loyalty.earn: customer not found, skipping');
      return null;
    }
    if (!customer.isActive) {
      logger.warn({ orderId, customerId }, 'loyalty.earn: customer inactive, skipping');
      return null;
    }
    return await earnForOrder({ orderId, customer, amountCents, createdById });
  } catch (e) {
    logger.warn({ err: (e as Error).message, orderId, customerId }, 'loyalty.earn: failed (non-fatal)');
    return null;
  }
}

interface EarnForOrderArgs {
  orderId: string;
  customer: { id: string };
  amountCents: number;
  createdById: string | null;
}

async function earnForOrder(args: EarnForOrderArgs): Promise<EarnResult | null> {
  const { orderId, customer, amountCents, createdById } = args;

  // Idempotency: skip if we already have an EARN row for this order.
  const existing = await prisma.loyaltyTransaction.findFirst({
    where: { orderId, type: 'EARN', customerId: customer.id },
  });
  if (existing) {
    logger.info({ orderId, customerId: customer.id, existingId: existing.id }, 'loyalty.earn: already credited, skip');
    return {
      customerId: customer.id,
      points: existing.pointsDelta,
      transactionId: existing.id,
    };
  }

  const cfg = await loadLoyaltyConfig();
  const points = calculateEarn(amountCents, cfg);
  if (points <= 0) {
    return null;
  }

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const txRow = await tx.loyaltyTransaction.create({
      data: {
        customerId: customer.id,
        orderId,
        type: 'EARN',
        pointsDelta: points,
        amountCents,
        createdById: createdById ?? undefined,
      },
    });
    await tx.customer.update({
      where: { id: customer.id },
      data: {
        loyaltyPoints: { increment: points },
        totalSpentCents: { increment: amountCents },
        visitCount: { increment: 1 },
        lastVisitAt: new Date(),
      },
    });
    return txRow;
  });

  incCounter('pos_loyalty_earn_total', 'Loyalty points earned');
  logger.info(
    { orderId, customerId: customer.id, points, amountCents },
    'loyalty.earn: points credited',
  );
  return {
    customerId: customer.id,
    points,
    transactionId: result.id,
  };
}

// ─── REDEEM ─────────────────────────────────────────────────────────────────

/**
 * Redeem `points` from a customer. Returns the discount (in cents) that
 * should be applied to the next order, and the LoyaltyTransaction id.
 *
 * Throws on:
 *   - customer not found
 *   - insufficient points
 *   - below minRedeemPoints
 *   - loyalty inactive
 *
 * Callers (customers route, order creation) are responsible for translating
 * the discount into Order.discountCents / Order.totalCents.
 */
export async function redeem(
  customerId: string,
  points: number,
  opts: { orderId?: string; createdById?: string; notes?: string } = {},
): Promise<RedeemResult> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    throw new Error('Pelanggan tidak ditemukan');
  }
  if (!customer.isActive) {
    throw new Error('Pelanggan tidak aktif');
  }
  const cfg = await loadLoyaltyConfig();
  const discountCents = calculateRedeemDiscount(points, cfg);
  if (customer.loyaltyPoints < points) {
    throw new Error(`Poin tidak cukup (${customer.loyaltyPoints} < ${points})`);
  }

  const tx = await prisma.$transaction(async (t: Prisma.TransactionClient) => {
    const row = await t.loyaltyTransaction.create({
      data: {
        customerId: customer.id,
        orderId: opts.orderId,
        type: 'REDEEM',
        pointsDelta: -points,
        amountCents: discountCents,
        notes: opts.notes,
        createdById: opts.createdById,
      },
    });
    await t.customer.update({
      where: { id: customer.id },
      data: { loyaltyPoints: { decrement: points } },
    });
    return row;
  });

  incCounter('pos_loyalty_redeem_total', 'Loyalty points redeemed');
  logger.info(
    { customerId, points, discountCents },
    'loyalty.redeem: points debited',
  );
  return {
    customerId: customer.id,
    points,
    discountCents,
    transactionId: tx.id,
  };
}

// ─── Manual adjust (called from customers route) ────────────────────────────

/**
 * Manually adjust a customer's points (e.g. for a complaint or correction).
 * Records an ADJUST LoyaltyTransaction. Throws on validation failure.
 */
export async function manualAdjust(
  customerId: string,
  delta: number,
  notes: string,
  createdById: string,
): Promise<{ customerId: string; points: number; transactionId: string; newBalance: number }> {
  if (!Number.isInteger(delta) || delta === 0) {
    throw new Error('delta harus bilangan bulat non-nol');
  }
  if (!notes || notes.trim().length === 0) {
    throw new Error('notes wajib diisi untuk penyesuaian manual');
  }
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    throw new Error('Pelanggan tidak ditemukan');
  }
  if (!customer.isActive) {
    throw new Error('Pelanggan tidak aktif');
  }
  if (customer.loyaltyPoints + delta < 0) {
    throw new Error('Penyesuaian akan membuat saldo poin negatif');
  }

  const result = await prisma.$transaction(async (t: Prisma.TransactionClient) => {
    const row = await t.loyaltyTransaction.create({
      data: {
        customerId: customer.id,
        type: 'ADJUST',
        pointsDelta: delta,
        notes: notes.trim(),
        createdById,
      },
    });
    const updated = await t.customer.update({
      where: { id: customer.id },
      data: { loyaltyPoints: { increment: delta } },
    });
    return { row, updated };
  });

  incCounter('pos_loyalty_adjust_total', 'Manual loyalty adjustments', {
    direction: delta > 0 ? 'credit' : 'debit',
  });
  logger.info(
    { customerId, delta, newBalance: result.updated.loyaltyPoints, by: createdById },
    'loyalty.adjust: points adjusted',
  );
  return {
    customerId: customer.id,
    points: delta,
    transactionId: result.row.id,
    newBalance: result.updated.loyaltyPoints,
  };
}

// ─── Balance read ───────────────────────────────────────────────────────────

/**
 * Read the current loyalty balance for a customer. Defensive: returns
 * { points: 0 } on missing customer.
 */
export async function getBalance(customerId: string): Promise<{ customerId: string; points: number; updatedAt: Date | null }> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, loyaltyPoints: true, updatedAt: true },
  });
  if (!customer) {
    return { customerId, points: 0, updatedAt: null };
  }
  return { customerId: customer.id, points: customer.loyaltyPoints, updatedAt: customer.updatedAt };
}

// Suppress unused warning for Prisma namespace import (kept for future use).
void Prisma;
