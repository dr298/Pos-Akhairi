import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { cacheGet, cacheSet } from '../lib/cache.js';
import type { Context } from 'hono';

export const reportRoutes = new Hono<AppEnv>();

reportRoutes.use('*', requireAuth, requireRole('OWNER', 'MANAGER'));

function dayRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${date}T23:59:59.999Z`);
  return { start, end };
}

reportRoutes.get('/daily', async (c) => {
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10);

  const cacheKey = `daily:${date}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return ok(c, { ...cached, cached: true });

  const { start, end } = dayRange(date);
  const [orderAgg, payments, topItems, hourlyRaw] = await Promise.all([
    prisma.order.aggregate({
      where: { status: 'PAID', closedAt: { gte: start, lte: end } },
      _count: { _all: true },
      _sum: { totalCents: true },
    }),
    prisma.payment.groupBy({
      by: ['method'],
      where: {
        status: 'PAID',
        paidAt: { gte: start, lte: end },
      },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    prisma.orderItem.groupBy({
      by: ['menuItemId'],
      where: {
        order: { status: 'PAID', closedAt: { gte: start, lte: end } },
      },
      _sum: { lineTotalCents: true, quantity: true },
      orderBy: { _sum: { lineTotalCents: 'desc' } },
      take: 10,
    }),
    prisma.order.findMany({
      where: { status: 'PAID', closedAt: { gte: start, lte: end } },
      select: { closedAt: true, totalCents: true },
    }),
  ]);

  const menuMap = new Map(
    (
      await prisma.menuItem.findMany({
        where: { id: { in: topItems.map((t) => t.menuItemId) } },
        select: { id: true, name: true },
      })
    ).map((m) => [m.id, m.name])
  );

  // hourly buckets
  const hourly = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    orders: 0,
    revenueCents: 0,
  }));
  for (const o of hourlyRaw) {
    if (!o.closedAt) continue;
    const h = o.closedAt.getUTCHours();
    hourly[h].orders += 1;
    hourly[h].revenueCents += o.totalCents;
  }

  const paymentBreakdown: Record<string, { count: number; amountCents: number }> = {};
  for (const p of payments) {
    paymentBreakdown[p.method] = {
      count: p._count._all,
      amountCents: p._sum.amountCents ?? 0,
    };
  }

  const result = {
    date,
    totalOrders: orderAgg._count._all,
    totalRevenueCents: orderAgg._sum.totalCents ?? 0,
    paymentBreakdown,
    topItems: topItems.map((t) => ({
      menuItemId: t.menuItemId,
      name: menuMap.get(t.menuItemId) || '(unknown)',
      qty: t._sum.quantity ?? 0,
      revenueCents: t._sum.lineTotalCents ?? 0,
    })),
    hourly,
  };
  cacheSet(cacheKey, result, 60_000);
  return ok(c, result);
});

reportRoutes.get('/range', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) return fail(c, 'ValidationError', 'from and to are required (YYYY-MM-DD)', 400);

  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return fail(c, 'ValidationError', 'Invalid date range', 400);
  }

  const [agg, payments, ordersInRange] = await Promise.all([
    prisma.order.aggregate({
      where: { status: 'PAID', closedAt: { gte: start, lte: end } },
      _count: { _all: true },
      _sum: { totalCents: true },
    }),
    prisma.payment.groupBy({
      by: ['method'],
      where: {
        status: 'PAID',
        paidAt: { gte: start, lte: end },
      },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    prisma.order.findMany({
      where: { status: 'PAID', closedAt: { gte: start, lte: end } },
      select: { closedAt: true, totalCents: true },
    }),
  ]);

  // group by date
  const byDayMap = new Map<string, { orders: number; revenueCents: number }>();
  for (const o of ordersInRange) {
    if (!o.closedAt) continue;
    const key = o.closedAt.toISOString().slice(0, 10);
    const cur = byDayMap.get(key) || { orders: 0, revenueCents: 0 };
    cur.orders += 1;
    cur.revenueCents += o.totalCents;
    byDayMap.set(key, cur);
  }
  const byDay = Array.from(byDayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));

  const totalDays = byDay.length;
  const totalRevenue = agg._sum.totalCents ?? 0;
  const averageDaily = totalDays > 0 ? Math.round(totalRevenue / totalDays) : 0;

  const byPayment: Record<string, { count: number; amountCents: number }> = {};
  for (const p of payments) {
    byPayment[p.method] = {
      count: p._count._all,
      amountCents: p._sum.amountCents ?? 0,
    };
  }

  return ok(c, {
    from,
    to,
    totalDays,
    totalOrders: agg._count._all,
    totalRevenueCents: totalRevenue,
    averageDailyCents: averageDaily,
    byPayment,
    byDay,
  });
});

reportRoutes.get('/items', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) return fail(c, 'ValidationError', 'from and to are required (YYYY-MM-DD)', 400);

  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);

  const grouped = await prisma.orderItem.groupBy({
    by: ['menuItemId'],
    where: {
      order: { status: 'PAID', closedAt: { gte: start, lte: end } },
    },
    _sum: { lineTotalCents: true, quantity: true, hppCentsUsed: true },
  });
  const menuRows = await prisma.menuItem.findMany({
    where: { id: { in: grouped.map((g) => g.menuItemId) } },
    select: { id: true, name: true, category: { select: { name: true } } },
  });
  const menuMap = new Map(menuRows.map((m) => [m.id, { name: m.name, category: m.category.name }]));
  const items = grouped
    .map((g) => {
      const info = menuMap.get(g.menuItemId);
      return {
        menuItemId: g.menuItemId,
        name: info?.name || '(unknown)',
        category: info?.category || null,
        qty: g._sum.quantity ?? 0,
        revenueCents: g._sum.lineTotalCents ?? 0,
        hppPerPcs: (g._sum.hppCentsUsed ?? 0) / (g._sum.quantity || 1),
      };
    })
    .sort((a, b) => b.revenueCents - a.revenueCents);

  return ok(c, { period: { from, to }, items });
});

function csvEscape(s: any): string {
  if (s === null || s === undefined) return '';
  const str = String(s);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function csvResponse(c: Context, filename: string, rows: (string | number)[][]) {
  const body = rows.map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
  return c.body(body, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
}

reportRoutes.get('/export', async (c) => {
  const type = c.req.query('type') || 'daily';
  const format = (c.req.query('format') || 'csv').toLowerCase();
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10);

  if (type !== 'daily') {
    return fail(c, 'ValidationError', "Only type=daily export supported", 400);
  }
  const { start, end } = dayRange(date);

  if (format === 'csv') {
    const orders = await prisma.order.findMany({
      where: { status: 'PAID', closedAt: { gte: start, lte: end } },
      include: { items: true, payments: true },
      orderBy: { closedAt: 'asc' },
    });
    const rows: (string | number)[][] = [];
    rows.push(['order_number', 'opened_at', 'closed_at', 'item', 'qty', 'line_total_cents', 'payment_method', 'total_cents']);
    for (const o of orders) {
      const pay = o.payments[0]?.method || '';
      if (o.items.length === 0) {
        rows.push([o.orderNumber, o.openedAt.toISOString(), (o.closedAt || o.openedAt).toISOString(), '', 0, 0, pay, o.totalCents]);
      } else {
        for (const it of o.items) {
          rows.push([
            o.orderNumber,
            o.openedAt.toISOString(),
            (o.closedAt || o.openedAt).toISOString(),
            it.nameSnapshot,
            it.quantity,
            it.lineTotalCents,
            pay,
            o.totalCents,
          ]);
        }
      }
    }
    return csvResponse(c, `daily-${date}.csv`, rows);
  }

  if (format === 'pdf' || format === 'html') {
    const orders = await prisma.order.findMany({
      where: { status: 'PAID', closedAt: { gte: start, lte: end } },
      include: { items: true, payments: true },
      orderBy: { closedAt: 'asc' },
    });
    const totalRevenue = orders.reduce((s, o) => s + o.totalCents, 0);
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Daily Report ${date}</title>
<style>body{font-family:system-ui,sans-serif;padding:24px}h1{margin:0 0 8px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ddd;padding:6px;text-align:left;font-size:12px}th{background:#f4f4f4}td.r,th.r{text-align:right}</style>
</head><body>
<h1>Daily Report — ${date}</h1>
<div>Orders: <b>${orders.length}</b> &nbsp; Revenue: <b>Rp ${(totalRevenue/100).toLocaleString('id-ID')}</b></div>
<table><thead><tr><th>#</th><th>Order</th><th>Closed</th><th>Items</th><th class=r>Total (IDR)</th><th>Payment</th></tr></thead>
<tbody>
${orders
  .map(
    (o, i) => `<tr><td>${i + 1}</td><td>${o.orderNumber}</td><td>${(o.closedAt || o.openedAt).toISOString()}</td><td>${o.items.length}</td><td class=r>${(o.totalCents / 100).toLocaleString('id-ID')}</td><td>${o.payments[0]?.method || '-'}</td></tr>`
  )
  .join('\n')}
</tbody></table>
</body></html>`;
    c.header('Content-Type', 'text/html; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="daily-${date}.html"`);
    return c.body(html, 200);
  }

  return fail(c, 'ValidationError', "format must be 'csv' or 'pdf' (or 'html')", 400);
});

// Sprint 5.7 — Z-report (full end-of-day report for the single restaurant).
// Includes every section a manager needs to reconcile the day: gross/net
// sales, void/refund, tax, payment method breakdown, order types, top
// items, category breakdown, hourly chart, and shift drawer reconciliation.
reportRoutes.get('/z-report', async (c) => {
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(c, 'ValidationError', 'Invalid date', 400);

  const cacheKey = `zreport:${date}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return ok(c, { ...cached, cached: true });

  const { start, end } = dayRange(date);

  // Parallel aggregates. We fetch flat rows for breakdowns (orderType,
  // item, category) and aggregate counts/sums separately.
  const [
    paidAgg,
    voidAgg,
    refundAgg,
    voidRefunds,
    payments,
    paidItemsRaw,
    shifts,
    dailyClose,
  ] = await Promise.all([
    prisma.order.aggregate({
      where: { status: 'PAID', closedAt: { gte: start, lte: end } },
      _count: { _all: true },
      _sum: { subtotalCents: true, discountCents: true, taxCents: true, totalCents: true },
    }),
    prisma.order.aggregate({
      where: { status: 'VOIDED', voidedAt: { gte: start, lte: end } },
      _count: { _all: true },
      _sum: { totalCents: true },
    }),
    prisma.order.aggregate({
      where: { status: 'REFUNDED', refundedAt: { gte: start, lte: end } },
      _count: { _all: true },
      _sum: { totalCents: true },
    }),
    prisma.order.findMany({
      where: {
        status: { in: ['VOIDED', 'REFUNDED'] },
        OR: [
          { voidedAt: { gte: start, lte: end } },
          { refundedAt: { gte: start, lte: end } },
        ],
      },
      select: { id: true, orderNumber: true, status: true, totalCents: true, voidedAt: true, refundedAt: true },
      orderBy: [{ voidedAt: 'desc' }, { refundedAt: 'desc' }],
    }),
    prisma.payment.groupBy({
      by: ['method'],
      where: { status: 'PAID', paidAt: { gte: start, lte: end } },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    // All items in PAID orders for top items + category + hourly
    prisma.orderItem.findMany({
      where: { order: { status: 'PAID', closedAt: { gte: start, lte: end } } },
      select: {
        menuItemId: true,
        nameSnapshot: true,
        quantity: true,
        lineTotalCents: true,
        orderId: true,
        order: { select: { type: true, totalCents: true, closedAt: true } },
      },
    }),
    prisma.shift.findMany({
      where: { openedAt: { gte: start, lte: end } },
      select: {
        id: true, userId: true, status: true,
        openingCents: true, closingCents: true, expectedCents: true, varianceCents: true,
        openedAt: true, closedAt: true,
        user: { select: { name: true } },
      },
      orderBy: { openedAt: 'asc' },
    }),
    prisma.dailyClose.findFirst({ where: { businessDate: start } }),
  ]);

  // Menu map for category breakdown
  const menuIds = Array.from(new Set(paidItemsRaw.map((i) => i.menuItemId)));
  const menus = await prisma.menuItem.findMany({
    where: { id: { in: menuIds } },
    select: { id: true, name: true, categoryId: true, category: { select: { name: true } } },
  });
  const menuMap = new Map(menus.map((m) => [m.id, m]));

  // Top items (top 20)
  const itemAggMap = new Map<string, { name: string; qty: number; revenueCents: number }>();
  for (const it of paidItemsRaw) {
    const cur = itemAggMap.get(it.menuItemId) || {
      name: it.nameSnapshot || menuMap.get(it.menuItemId)?.name || '(unknown)',
      qty: 0,
      revenueCents: 0,
    };
    cur.qty += it.quantity;
    cur.revenueCents += it.lineTotalCents;
    itemAggMap.set(it.menuItemId, cur);
  }
  const topItems = Array.from(itemAggMap.entries())
    .map(([menuItemId, v]) => ({ menuItemId, ...v }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 20);

  // Category breakdown — join each item with its menu's category
  const catAgg = new Map<string, { name: string; qty: number; revenueCents: number }>();
  for (const it of paidItemsRaw) {
    const m = menuMap.get(it.menuItemId);
    const catId = m?.categoryId || '__none__';
    const cat = m?.category;
    const cur = catAgg.get(catId) || { name: cat?.name || '(uncategorized)', qty: 0, revenueCents: 0 };
    cur.qty += it.quantity;
    cur.revenueCents += it.lineTotalCents;
    catAgg.set(catId, cur);
  }
  const categoryBreakdown = Array.from(catAgg.entries())
    .map(([categoryId, v]) => ({ categoryId, ...v }))
    .sort((a, b) => b.revenueCents - a.revenueCents);

  // Hourly breakdown (UTC hours; client reformats with restaurant timezone).
  // Use orderId from the item to count each order once.
  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0, revenueCents: 0 }));
  const orderHourSeen = new Set<string>();
  for (const it of paidItemsRaw) {
    const closed = it.order.closedAt;
    if (!closed) continue;
    const h = closed.getUTCHours();
    hourly[h].revenueCents += it.lineTotalCents;
    const k = `${h}|${it.orderId}`;
    if (!orderHourSeen.has(k)) {
      orderHourSeen.add(k);
      hourly[h].orders += 1;
    }
  }

  // Payment method breakdown
  const paymentBreakdown: Record<string, { count: number; amountCents: number }> = {};
  for (const p of payments) {
    paymentBreakdown[p.method] = {
      count: p._count._all,
      amountCents: p._sum.amountCents ?? 0,
    };
  }

  // Order type breakdown.
  const orderTypeBreakdown: Record<string, { count: number; revenueCents: number }> = {};
  const seenOrderType = new Set<string>();
  for (const it of paidItemsRaw) {
    const ot = it.order.type;
    if (!seenOrderType.has(it.orderId)) {
      seenOrderType.add(it.orderId);
      const t = orderTypeBreakdown[ot] || { count: 0, revenueCents: 0 };
      t.count += 1;
      t.revenueCents += it.order.totalCents;
      orderTypeBreakdown[ot] = t;
    }
  }

  // Channel breakdown (Sprint 10 — online ordering dropped). For legacy
  // compatibility we still emit a single POS bucket covering all orders.
  const channelBreakdown: Record<string, { count: number; revenueCents: number }> = {
    POS: { count: 0, revenueCents: 0 },
  };
  for (const it of paidItemsRaw) {
    if (!seenOrderType.has(it.orderId)) continue;
    const cur = channelBreakdown['POS']!;
    cur.count += 1;
    cur.revenueCents += it.order.totalCents;
  }

  const grossRevenueCents = paidAgg._sum.subtotalCents ?? 0;
  const discountCents = paidAgg._sum.discountCents ?? 0;
  const netRevenueCents = grossRevenueCents - discountCents;
  const taxCents = paidAgg._sum.taxCents ?? 0;
  const totalRevenueCents = paidAgg._sum.totalCents ?? 0;
  const voidCount = voidAgg._count._all;
  const voidAmountCents = voidAgg._sum.totalCents ?? 0;
  const refundCount = refundAgg._count._all;
  const refundAmountCents = refundAgg._sum.totalCents ?? 0;

  const result = {
    date,
    summary: {
      grossRevenueCents,
      discountCents,
      netRevenueCents,
      taxCents,
      totalRevenueCents,
      paidOrderCount: paidAgg._count._all,
      voidCount,
      voidAmountCents,
      refundCount,
      refundAmountCents,
    },
    paymentBreakdown,
    orderTypeBreakdown,
    channelBreakdown,
    topItems,
    categoryBreakdown,
    hourly,
    shifts,
    voidRefunds,
    dailyClose: dailyClose ?? null,
    generatedAt: new Date().toISOString(),
  };
  cacheSet(cacheKey, result, 60_000);
  return ok(c, result);
});

// Stub: Sprint 5.x — Commission report per channel (shopee, grab, gojek).
// Channel-ordering was removed in the no-branch refactor, so the commission
// data is no longer produced. We keep a stable 410 endpoint so the web admin
// can detect the missing feature and stop calling it.
reportRoutes.get('/chain', async (c) => {
  return fail(
    c,
    'Deprecated',
    'Commission report per channel has been retired. The /api/reports/chain endpoint is no longer available now that online channels have been removed.',
    410,
  );
});

// Sprint 21 — Profit & Loss summary over a date range.
//
// Numbers flow (top → bottom):
//   Gross revenue      = sum(orders.totalCents) for PAID orders in range
//   - Discounts         = sum(orders.discountCents)
//   Net revenue        = gross - discounts
//   - COGS (HPP)        = sum(orderItems.hppCentsUsed * orderItems.quantity)
//                          for items in PAID orders in range. hppCentsUsed
//                          is the locked-in per-unit cost at the moment
//                          the order was paid (Sprint 12).
//   Gross profit       = net revenue - COGS
//
//   Operating expenses (OpEx) — kept simple for now:
//   - Stock opname LOSS (negative adjustments) treated as shrinkage
//   - Waste entries cost (qty * costPerUnit)
//   - Purchase orders received in range (cash going OUT to suppliers)
//
//   Net profit         = gross profit - OpEx
//
// Note: this is a "manager-level" P&L, not a tax filing. PPN tax
// reporting is handled separately via /api/accounting-export.
reportRoutes.get('/pnl', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) {
    return fail(c, 'ValidationError', 'from and to are required (YYYY-MM-DD)', 400);
  }
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return fail(c, 'ValidationError', 'Invalid date range', 400);
  }

  // Revenue: PAID orders closed in range
  const [paidAgg, itemHppAgg, paidOrderIds] = await Promise.all([
    prisma.order.aggregate({
      where: { status: 'PAID', closedAt: { gte: start, lte: end } },
      _count: { _all: true },
      _sum: {
        totalCents: true,
        subtotalCents: true,
        discountCents: true,
        taxCents: true,
      },
    }),
    // COGS via OrderItem.hppCentsUsed * quantity. We sum in JS because
    // Prisma's aggregate can't multiply across two fields. We only
    // touch PAID orders in range, indexed by closedAt.
    prisma.orderItem.findMany({
      where: {
        order: { status: 'PAID', closedAt: { gte: start, lte: end } },
      },
      select: { quantity: true, hppCentsUsed: true },
    }),
    prisma.order.findMany({
      where: { status: 'PAID', closedAt: { gte: start, lte: end } },
      select: { id: true },
    }),
  ]);

  let cogsCents = 0;
  for (const it of itemHppAgg) {
    if (it.hppCentsUsed == null) continue;
    // quantity is Decimal; multiply by integer hppCents. To avoid
    // float drift we do the multiply as integer (round to nearest) —
    // for typical food items quantity < 1000, rounding error << 1 cent.
    cogsCents += Math.round(Number(it.quantity) * it.hppCentsUsed);
  }

  // OpEx
  const [lossLogs, wasteAgg, poAgg, refundAgg] = await Promise.all([
    // Stock opname losses (negative adjustment logs) in range
    prisma.inventoryLog.findMany({
      where: {
        type: 'ADJUSTMENT',
        createdAt: { gte: start, lte: end },
      },
      select: { quantity: true, unitCostCents: true, inventoryItemId: true },
    }),
    prisma.wasteEntry.aggregate({
      where: { createdAt: { gte: start, lte: end } },
      _sum: { totalCostCents: true },
      _count: { _all: true },
    }),
    // PO receipts: cash going out. RECEIVED = fully received, PARTIAL =
    // partial delivery. DRAFT/SENT/CANCELLED don't count.
    prisma.purchaseOrder.aggregate({
      where: {
        status: { in: ['RECEIVED', 'PARTIAL'] },
        receivedAt: { gte: start, lte: end },
      },
      _sum: { totalCents: true },
      _count: { _all: true },
    }),
    prisma.order.aggregate({
      where: { status: 'REFUNDED', closedAt: { gte: start, lte: end } },
      _sum: { totalCents: true },
      _count: { _all: true },
    }),
  ]);

  // Inventory shrinkage cost: only NEGATIVE deltas count as loss. We
  // need the unit cost — pull per-item costPerUnit in a second pass.
  const lossItemIds = Array.from(new Set(lossLogs.map((l) => l.inventoryItemId)));
  const itemCostMap = new Map<string, number>();
  if (lossItemIds.length) {
    const items = await prisma.inventoryItem.findMany({
      where: { id: { in: lossItemIds } },
      select: { id: true, costPerUnit: true },
    });
    for (const it of items) {
      // costPerUnit is Decimal (Rupiah per unit). Use unitCostCents
      // captured at log time if present, else fall back to current cost.
      itemCostMap.set(it.id, Math.round(Number(it.costPerUnit) * 100));
    }
  }
  let shrinkageCents = 0;
  for (const l of lossLogs) {
    if (Number(l.quantity) >= 0) continue; // skip gains
    const unitCents = l.unitCostCents ?? itemCostMap.get(l.inventoryItemId) ?? 0;
    shrinkageCents += Math.round(Math.abs(Number(l.quantity)) * unitCents);
  }

  const grossRevenueCents = paidAgg._sum.subtotalCents ?? 0;
  const discountCents = paidAgg._sum.discountCents ?? 0;
  const taxCents = paidAgg._sum.taxCents ?? 0;
  const netRevenueCents = grossRevenueCents - discountCents;
  const totalRevenueCents = paidAgg._sum.totalCents ?? 0;
  const grossProfitCents = netRevenueCents - cogsCents;
  const wasteCents = wasteAgg._sum.totalCostCents ?? 0;
  const poCents = poAgg._sum.totalCents ? Number(poAgg._sum.totalCents) : 0;
  const refundCents = refundAgg._sum.totalCents ?? 0;
  const totalOpExCents = shrinkageCents + wasteCents + poCents + refundCents;
  const netProfitCents = grossProfitCents - totalOpExCents;

  return ok(c, {
    from,
    to,
    paidOrderCount: paidAgg._count._all,
    revenue: {
      gross: grossRevenueCents,
      discount: discountCents,
      net: netRevenueCents,
      tax: taxCents,
      total: totalRevenueCents,
    },
    cogsCents,
    grossProfitCents,
    grossMarginPct: netRevenueCents > 0
      ? Number(((grossProfitCents / netRevenueCents) * 100).toFixed(2))
      : 0,
    opex: {
      shrinkage: shrinkageCents,
      waste: wasteCents,
      purchaseOrders: poCents,
      refunds: refundCents,
      total: totalOpExCents,
    },
    netProfitCents,
    netMarginPct: netRevenueCents > 0
      ? Number(((netProfitCents / netRevenueCents) * 100).toFixed(2))
      : 0,
  });
});


// Sales report export — CSV with date range + product breakdown.
// GET /api/reports/sales-export?from=2026-06-26&to=2026-06-28
reportRoutes.get('/sales-export', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) return fail(c, 'ValidationError', 'from and to are required (YYYY-MM-DD)', 400);

  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return fail(c, 'ValidationError', 'Invalid date range', 400);
  }

  // Get order items with category + cost
  const orderItems = await prisma.orderItem.findMany({
    where: {
      order: { status: 'PAID', closedAt: { gte: start, lte: end } },
    },
    include: {
      order: { select: { closedAt: true, totalCents: true } },
      menuItem: { select: { name: true, costCents: true, category: { select: { name: true } } } },
    },
    orderBy: { order: { closedAt: 'asc' } },
  });

  const rows: (string | number)[][] = [];
  rows.push(['Tanggal', 'Kategori', 'Menu', 'Qty', 'Harga Satuan', 'Total', 'HPP/pcs', 'Total HPP', 'Profit']);

  let totalQty = 0;
  let totalRevenue = 0;
  let totalHpp = 0;
  let totalProfit = 0;

  for (const item of orderItems) {
    const date = item.order.closedAt ? item.order.closedAt.toISOString().slice(0, 10) : '';
    const category = item.menuItem?.category?.name || '-';
    const menuName = item.menuItem?.name || item.nameSnapshot;
    const qty = item.quantity;
    const priceCents = item.priceCents;
    const lineTotal = item.lineTotalCents;
    const hppPerPcs = item.menuItem?.costCents || 0;
    const totalHppCents = hppPerPcs * qty;
    const profitCents = lineTotal - totalHppCents;

    totalQty += qty;
    totalRevenue += lineTotal;
    totalHpp += totalHppCents;
    totalProfit += profitCents;

    rows.push([
      date,
      category,
      menuName,
      qty,
      priceCents / 100,
      lineTotal / 100,
      hppPerPcs / 100,
      totalHppCents / 100,
      profitCents / 100,
    ]);
  }

  // Total row
  rows.push([]);
  rows.push(['TOTAL', '', '', totalQty, '', totalRevenue / 100, '', totalHpp / 100, totalProfit / 100]);

  return csvResponse(c, `sales-${from}-to-${to}.csv`, rows);
});
