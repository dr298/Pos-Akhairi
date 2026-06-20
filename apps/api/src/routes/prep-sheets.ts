// apps/api/src/routes/prep-sheets.ts
//
// Sprint 9.6 — Prep Sheets (kitchen prep guidance).
//
// Generates a per-day recommendation of what the kitchen should prep,
// based on the last N days of paid order items. Items that historically
// sell more on the same day-of-week get a bump via `dayOfWeekFactor`.
//
// Algorithm:
//   1. Pull all paid OrderItems in [date - lookbackDays, date).
//   2. Per menu item, compute:
//        - avgQtyPerDay   = total qty / lookbackDays
//        - sameDOWQty     = total qty on the same day-of-week as `date`
//        - dowRatio       = max(0.5, sameDOWQty / (avgQtyPerDay * (lookbackDays/7)))
//                           (clamped to avoid extreme values on thin data)
//        - dayOfWeekFactor = dowRatio
//        - last7DayQty    = qty in the last 7 days
//        - recommendedQty = round(avgQtyPerDay * dayOfWeekFactor)
//
// The result is persisted to PrepSheet.itemsJson; the web UI prints it.
//
// Endpoints (all require auth):
//   POST /api/prep-sheets/generate     (OWNER, MANAGER)
//        body: { branchId, date: YYYY-MM-DD, lookbackDays?: number }
//   GET  /api/prep-sheets?branchId=X&date=YYYY-MM-DD
//   GET  /api/prep-sheets/:id

import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { incCounter } from '../middleware/metrics.js';

export const prepSheetRoutes = new Hono<AppEnv>();

prepSheetRoutes.use('*', requireAuth);

// ─── Helpers ───────────────────────────────────────────────────────────────

function userHasBranchAccess(
  branchAccess: Array<{ branchId: string }>,
  branchId: string,
): boolean {
  return branchAccess.some((b) => b.branchId === branchId);
}

function parseDateOnly(input: string): Date {
  // Accepts YYYY-MM-DD. Returns a Date at 00:00:00 local.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!m) throw new Error(`Invalid date string: ${input} (expected YYYY-MM-DD)`);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${input}`);
  return d;
}

function dayOfWeek(d: Date): number {
  return d.getDay(); // 0..6 (Sun..Sat)
}

// ─── Types (mirrored in itemsJson) ────────────────────────────────────────

export interface PrepSheetItem {
  menuItemId: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  avgQtyPerDay: number;
  dayOfWeekFactor: number;
  recommendedQty: number;
  last7DayQty: number;
}

// ─── Schemas ───────────────────────────────────────────────────────────────

const generateSchema = z.object({
  branchId: z.string().min(1).max(50),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lookbackDays: z.number().int().min(3).max(60).optional(),
  notes: z.string().max(500).optional().nullable(),
});

// ─── Generate ──────────────────────────────────────────────────────────────

prepSheetRoutes.post(
  '/generate',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = generateSchema.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid generate payload', 400, parsed.error.issues);
    }
    const input = parsed.data;
    if (!userHasBranchAccess(user.branchAccess, input.branchId)) {
      return fail(c, 'NoAccess', `No access to branch ${input.branchId}`, 403);
    }
    const targetDate = parseDateOnly(input.date);
    const lookbackDays = input.lookbackDays ?? 14;
    const windowStart = new Date(targetDate);
    windowStart.setDate(windowStart.getDate() - lookbackDays);
    const targetDow = dayOfWeek(targetDate);
    // Per-day-of-week count in the lookback window (how many of each DOW
    // are present). e.g. 14 days usually = 2 of each DOW, but a 10-day
    // window might miss one. Use this to normalize the DOW-specific avg.
    const dowCounts: Record<number, number> = {};
    for (let i = 0; i < lookbackDays; i++) {
      const d = new Date(windowStart);
      d.setDate(d.getDate() + i);
      const dow = dayOfWeek(d);
      dowCounts[dow] = (dowCounts[dow] ?? 0) + 1;
    }
    const targetDowCount = dowCounts[targetDow] ?? 0;

    // Pull paid orders in the window
    const orders = await prisma.order.findMany({
      where: {
        branchId: input.branchId,
        status: 'PAID',
        closedAt: { gte: windowStart, lt: targetDate },
      },
      include: { items: true },
    });

    // Aggregate per menu item
    interface Agg {
      menuItemId: string;
      name: string;
      totalQty: number;
      last7Qty: number;
      sameDowQty: number;
    }
    const aggMap = new Map<string, Agg>();
    const sevenDayCutoff = new Date(targetDate);
    sevenDayCutoff.setDate(sevenDayCutoff.getDate() - 7);

    for (const o of orders) {
      if (!o.closedAt) continue;
      for (const li of o.items) {
        const existing = aggMap.get(li.menuItemId);
        const baseQty = li.quantity;
        if (existing) {
          existing.totalQty += baseQty;
          if (o.closedAt >= sevenDayCutoff) existing.last7Qty += baseQty;
          if (dayOfWeek(o.closedAt) === targetDow) existing.sameDowQty += baseQty;
        } else {
          aggMap.set(li.menuItemId, {
            menuItemId: li.menuItemId,
            name: li.nameSnapshot,
            totalQty: baseQty,
            last7Qty: o.closedAt >= sevenDayCutoff ? baseQty : 0,
            sameDowQty: dayOfWeek(o.closedAt) === targetDow ? baseQty : 0,
          });
        }
      }
    }

    // Enrich with current menu item names + category
    const itemIds = Array.from(aggMap.keys());
    const menuItems = itemIds.length
      ? await prisma.menuItem.findMany({
          where: { id: { in: itemIds } },
          select: {
            id: true,
            name: true,
            categoryId: true,
            category: { select: { id: true, name: true } },
          },
        })
      : [];
    const menuMap = new Map(menuItems.map((m) => [m.id, m]));

    // Build recommendations
    const items: PrepSheetItem[] = [];
    for (const agg of aggMap.values()) {
      const m = menuMap.get(agg.menuItemId);
      const avg = agg.totalQty / lookbackDays;
      // DOW-specific avg (per occurrence of this DOW in the window)
      const dowAvg = targetDowCount > 0 ? agg.sameDowQty / targetDowCount : avg;
      // dayOfWeekFactor: ratio of DOW avg to overall avg, clamped 0.5..1.5
      // to avoid extreme values on thin data. If we have no DOW data,
      // factor = 1.0.
      const rawFactor = avg > 0 ? dowAvg / avg : 1.0;
      const factor = Math.max(0.5, Math.min(1.5, Math.round(rawFactor * 100) / 100));
      const recommended = Math.max(0, Math.round(avg * factor));
      items.push({
        menuItemId: agg.menuItemId,
        name: m?.name ?? agg.name,
        categoryId: m?.categoryId ?? null,
        categoryName: m?.category?.name ?? null,
        avgQtyPerDay: Math.round(avg * 100) / 100,
        dayOfWeekFactor: factor,
        recommendedQty: recommended,
        last7DayQty: agg.last7Qty,
      });
    }
    // Sort: highest recommended first
    items.sort((a, b) => b.recommendedQty - a.recommendedQty);

    const sheet = await prisma.prepSheet.create({
      data: {
        branchId: input.branchId,
        date: targetDate,
        lookbackDays,
        itemsJson: items as unknown as object,
        generatedById: user.id,
        notes: input.notes ?? null,
      },
    });
    incCounter('pos_prep_sheets_generated_total', 'Prep sheets generated', {
      branchId: input.branchId,
    });
    logger.info(
      { sheetId: sheet.id, branchId: input.branchId, itemCount: items.length, lookbackDays },
      'prep sheet generated',
    );
    return ok(
      c,
      { ...sheet, items },
      201,
    );
  },
);

// ─── List ──────────────────────────────────────────────────────────────────

prepSheetRoutes.get('/', async (c) => {
  const user = c.get('user');
  const branchId = c.req.query('branchId') || user.branchId;
  if (!branchId) return fail(c, 'NoBranch', 'No branch context', 400);
  if (!userHasBranchAccess(user.branchAccess, branchId)) {
    return fail(c, 'NoAccess', `No access to branch ${branchId}`, 403);
  }
  const dateStr = c.req.query('date');
  let dateFilter: Date | undefined;
  if (dateStr) {
    try {
      dateFilter = parseDateOnly(dateStr);
    } catch (e) {
      return fail(c, 'ValidationError', (e as Error).message, 400);
    }
  }
  const sheets = await prisma.prepSheet.findMany({
    where: {
      branchId,
      ...(dateFilter ? { date: dateFilter } : {}),
    },
    orderBy: [{ date: 'desc' }, { generatedAt: 'desc' }],
    take: 60,
  });
  return ok(c, { prepSheets: sheets });
});

// ─── Detail ────────────────────────────────────────────────────────────────

prepSheetRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const sheet = await prisma.prepSheet.findUnique({ where: { id } });
  if (!sheet) return fail(c, 'NotFound', 'Prep sheet not found', 404);
  if (!userHasBranchAccess(user.branchAccess, sheet.branchId)) {
    return fail(c, 'NoAccess', 'No access to this prep sheet', 403);
  }
  return ok(c, sheet);
});
