// apps/api/src/routes/menu-engineering.ts
//
// Sprint 9.4 — Menu Engineering Matrix (BCG).
//
// Aggregates paid OrderItems over a period, classifies each MenuItem into
// a quadrant (Star / Plowhorse / Puzzle / Dog) based on median split of
// popularity (% of total qty) and margin (% of total margin cents), and
// persists a snapshot row.
//
// Endpoints (all require auth):
//   POST  /api/menu-engineering/snapshot          (OWNER, MANAGER)
//   GET   /api/menu-engineering/snapshots?limit=12
//   GET   /api/menu-engineering/snapshots/:id
//
// Quadrants (Indonesian labels in the web UI):
//   STAR      (Bintang)    — popularity >= median  AND  margin >= median
//   PLOWHORSE (Kuda)       — popularity >= median  AND  margin <  median
//   PUZZLE    (Teka-teki)  — popularity <  median  AND  margin >= median
//   DOG       (Anjing)     — popularity <  median  AND  margin <  median

import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { incCounter } from '../middleware/metrics.js';

export const menuEngineeringRoutes = new Hono<AppEnv>();

menuEngineeringRoutes.use('*', requireAuth);

// ─── Types (mirrored in itemsJson) ─────────────────────────────────────────

export type MenuEngineeringQuadrant = 'STAR' | 'PLOWHORSE' | 'PUZZLE' | 'DOG';

export interface MenuEngineeringItem {
  menuItemId: string;
  name: string;
  totalQty: number;
  totalRevenueCents: number;
  totalCostCents: number;
  marginCents: number;
  popularityPct: number; // % of total qty (0..100, 2 decimals)
  marginPct: number; // % of total margin (0..100, 2 decimals)
  quadrant: MenuEngineeringQuadrant;
}

export interface MenuEngineeringTotals {
  totalOrders: number;
  totalItems: number; // sum of all quantities
  totalRevenueCents: number;
  totalCostCents: number;
  totalMarginCents: number;
  medianPopularityPct: number;
  medianMarginPct: number;
  itemCount: number;
}

// ─── Schemas ───────────────────────────────────────────────────────────────

const snapshotCreate = z.object({
  periodStart: z.string().min(1).max(40), // ISO date
  periodEnd: z.string().min(1).max(40),
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseDate(input: string): Date {
  const d = new Date(input);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date string: ${input}`);
  }
  return d;
}

/** Median of a numeric array. Returns 0 for empty arrays. */
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Snapshot generation ───────────────────────────────────────────────────

menuEngineeringRoutes.post(
  '/snapshot',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = snapshotCreate.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid snapshot payload', 400, parsed.error.issues);
    }
    let periodStart: Date;
    let periodEnd: Date;
    try {
      periodStart = parseDate(parsed.data.periodStart);
      periodEnd = parseDate(parsed.data.periodEnd);
    } catch (e) {
      return fail(c, 'ValidationError', (e as Error).message, 400);
    }
    if (periodEnd.getTime() < periodStart.getTime()) {
      return fail(c, 'ValidationError', 'periodEnd harus setelah periodStart', 400);
    }

    // Load paid orders in the period
    const orders = await prisma.order.findMany({
      where: {
        status: 'PAID',
        closedAt: { gte: periodStart, lte: periodEnd },
      },
      include: { items: true },
    });

    // Aggregate per menu item
    interface Agg {
      menuItemId: string;
      name: string;
      totalQty: number;
      totalRevenueCents: number;
      totalCostCents: number;
    }
    const aggMap = new Map<string, Agg>();

    for (const o of orders) {
      for (const li of o.items) {
        const existing = aggMap.get(li.menuItemId);
        if (existing) {
          existing.totalQty += li.quantity;
          existing.totalRevenueCents += li.lineTotalCents;
        } else {
          aggMap.set(li.menuItemId, {
            menuItemId: li.menuItemId,
            name: li.nameSnapshot,
            totalQty: li.quantity,
            totalRevenueCents: li.lineTotalCents,
            // Cost is per-item snapshot — we need the current menu item's
            // costCents; missing means treat as 0.
            totalCostCents: 0,
          });
        }
      }
    }

    // Load menu item costs in one shot
    const itemIds = Array.from(aggMap.keys());
    const menuItems = itemIds.length
      ? await prisma.menuItem.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, costCents: true, name: true },
        })
      : [];
    const menuMap = new Map(menuItems.map((m) => [m.id, m]));

    for (const [, agg] of aggMap) {
      const m = menuMap.get(agg.menuItemId);
      if (m) {
        agg.totalCostCents = (m.costCents ?? 0) * agg.totalQty;
        // Use the canonical name from MenuItem if available
        agg.name = m.name;
      }
    }

    // Compute totals
    let totalItems = 0;
    let totalRevenueCents = 0;
    let totalCostCents = 0;
    let totalMarginCents = 0;
    const rows: Array<Omit<MenuEngineeringItem, 'quadrant' | 'popularityPct' | 'marginPct'>> = [];
    for (const agg of aggMap.values()) {
      const marginCents = agg.totalRevenueCents - agg.totalCostCents;
      totalItems += agg.totalQty;
      totalRevenueCents += agg.totalRevenueCents;
      totalCostCents += agg.totalCostCents;
      totalMarginCents += marginCents;
      rows.push({
        menuItemId: agg.menuItemId,
        name: agg.name,
        totalQty: agg.totalQty,
        totalRevenueCents: agg.totalRevenueCents,
        totalCostCents: agg.totalCostCents,
        marginCents,
      });
    }

    // Compute popularity% and margin% per row (guard divide-by-zero)
    const denom = (n: number) => (n > 0 ? n : 1);
    const enriched: Array<Omit<MenuEngineeringItem, 'quadrant'>> = rows.map((r) => ({
      ...r,
      popularityPct: round2((r.totalQty / denom(totalItems)) * 100),
      marginPct: round2((r.marginCents / denom(totalMarginCents || totalRevenueCents)) * 100),
    }));

    // Median split (only meaningful with >= 2 items)
    const medianPopPct = median(enriched.map((r) => r.popularityPct));
    const medianMarPct = median(enriched.map((r) => r.marginPct));

    // Classify
    const items: MenuEngineeringItem[] = enriched.map((r) => {
      const highPop = r.popularityPct >= medianPopPct;
      const highMar = r.marginPct >= medianMarPct;
      let quadrant: MenuEngineeringQuadrant;
      if (highPop && highMar) quadrant = 'STAR';
      else if (highPop && !highMar) quadrant = 'PLOWHORSE';
      else if (!highPop && highMar) quadrant = 'PUZZLE';
      else quadrant = 'DOG';
      return { ...r, quadrant };
    });

    const totals: MenuEngineeringTotals = {
      totalOrders: orders.length,
      totalItems,
      totalRevenueCents,
      totalCostCents,
      totalMarginCents,
      medianPopularityPct: round2(medianPopPct),
      medianMarginPct: round2(medianMarPct),
      itemCount: items.length,
    };

    const snapshot = await prisma.menuEngineeringSnapshot.create({
      data: {
        periodStart,
        periodEnd,
        itemsJson: items as unknown as object,
        totalsJson: totals as unknown as object,
        createdById: user.id,
      },
    });

    incCounter('pos_menu_engineering_snapshots_total', 'Menu engineering snapshots');
    logger.info(
      {
        snapshotId: snapshot.id,
        itemCount: items.length,
        totalRevenueCents,
      },
      'menu engineering snapshot created',
    );

    return ok(c, { ...snapshot, items, totals }, 201);
  },
);

// ─── List snapshots ────────────────────────────────────────────────────────

menuEngineeringRoutes.get('/snapshots', async (c) => {
  const limitStr = c.req.query('limit');
  const limit = Math.min(Math.max(parseInt(limitStr || '12', 10) || 12, 1), 100);

  const snapshots = await prisma.menuEngineeringSnapshot.findMany({
    orderBy: { generatedAt: 'desc' },
    take: limit,
  });
  // Normalize JSON columns so the web client gets `items`/`totals` keys
  // (matching the type contract on create endpoint).
  return ok(
    c,
    snapshots.map((s) => ({
      ...s,
      items: s.itemsJson as unknown as MenuEngineeringItem[],
      totals: s.totalsJson as unknown as MenuEngineeringTotals,
    })),
  );
});

// ─── Detail snapshot ───────────────────────────────────────────────────────

menuEngineeringRoutes.get('/snapshots/:id', async (c) => {
  const id = c.req.param('id');
  const snapshot = await prisma.menuEngineeringSnapshot.findUnique({ where: { id } });
  if (!snapshot) return fail(c, 'NotFound', 'Snapshot not found', 404);
  // Normalize JSON columns to match the type contract used by the create
  // endpoint and the web UI.
  return ok(c, {
    ...snapshot,
    items: snapshot.itemsJson as unknown as MenuEngineeringItem[],
    totals: snapshot.totalsJson as unknown as MenuEngineeringTotals,
  });
});
