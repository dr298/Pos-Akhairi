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
  const user = c.get('user');
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10);
  const branchId = c.req.query('branchId') || user.branchId;
  if (!branchId) return fail(c, 'NoBranch', 'No branch context', 400);

  const cacheKey = `daily:${branchId}:${date}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return ok(c, { ...cached, cached: true });

  const { start, end } = dayRange(date);
  const [orderAgg, payments, topItems, hourlyRaw] = await Promise.all([
    prisma.order.aggregate({
      where: { branchId, status: 'PAID', closedAt: { gte: start, lte: end } },
      _count: { _all: true },
      _sum: { totalCents: true },
    }),
    prisma.payment.groupBy({
      by: ['method'],
      where: {
        status: 'PAID',
        paidAt: { gte: start, lte: end },
        order: { branchId },
      },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    prisma.orderItem.groupBy({
      by: ['menuItemId'],
      where: {
        order: { branchId, status: 'PAID', closedAt: { gte: start, lte: end } },
      },
      _sum: { lineTotalCents: true, quantity: true },
      orderBy: { _sum: { lineTotalCents: 'desc' } },
      take: 10,
    }),
    prisma.order.findMany({
      where: { branchId, status: 'PAID', closedAt: { gte: start, lte: end } },
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
    branchId,
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
  const user = c.get('user');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const branchId = c.req.query('branchId') || user.branchId;
  if (!from || !to) return fail(c, 'ValidationError', 'from and to are required (YYYY-MM-DD)', 400);
  if (!branchId) return fail(c, 'NoBranch', 'No branch context', 400);

  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return fail(c, 'ValidationError', 'Invalid date range', 400);
  }

  const [agg, payments, ordersInRange] = await Promise.all([
    prisma.order.aggregate({
      where: { branchId, status: 'PAID', closedAt: { gte: start, lte: end } },
      _count: { _all: true },
      _sum: { totalCents: true },
    }),
    prisma.payment.groupBy({
      by: ['method'],
      where: {
        status: 'PAID',
        paidAt: { gte: start, lte: end },
        order: { branchId },
      },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    prisma.order.findMany({
      where: { branchId, status: 'PAID', closedAt: { gte: start, lte: end } },
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
    branchId,
    totalDays,
    totalOrders: agg._count._all,
    totalRevenueCents: totalRevenue,
    averageDailyCents: averageDaily,
    byPayment,
    byDay,
  });
});

reportRoutes.get('/items', async (c) => {
  const user = c.get('user');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const branchId = c.req.query('branchId') || user.branchId;
  if (!from || !to) return fail(c, 'ValidationError', 'from and to are required (YYYY-MM-DD)', 400);
  if (!branchId) return fail(c, 'NoBranch', 'No branch context', 400);

  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);

  const grouped = await prisma.orderItem.groupBy({
    by: ['menuItemId'],
    where: {
      order: { branchId, status: 'PAID', closedAt: { gte: start, lte: end } },
    },
    _sum: { lineTotalCents: true, quantity: true },
  });
  const menuMap = new Map(
    (
      await prisma.menuItem.findMany({
        where: { id: { in: grouped.map((g) => g.menuItemId) } },
        select: { id: true, name: true },
      })
    ).map((m) => [m.id, m.name])
  );
  const items = grouped
    .map((g) => ({
      menuItemId: g.menuItemId,
      name: menuMap.get(g.menuItemId) || '(unknown)',
      qty: g._sum.quantity ?? 0,
      revenueCents: g._sum.lineTotalCents ?? 0,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents);

  return ok(c, { period: { from, to, branchId }, items });
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
  const user = c.get('user');
  const type = c.req.query('type') || 'daily';
  const format = (c.req.query('format') || 'csv').toLowerCase();
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10);
  const branchId = c.req.query('branchId') || user.branchId;
  if (!branchId) return fail(c, 'NoBranch', 'No branch context', 400);

  if (type !== 'daily') {
    return fail(c, 'ValidationError', "Only type=daily export supported in Sprint 1", 400);
  }
  const { start, end } = dayRange(date);

  if (format === 'csv') {
    const orders = await prisma.order.findMany({
      where: { branchId, status: 'PAID', closedAt: { gte: start, lte: end } },
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
    // Sprint 1: return printable HTML with content-disposition
    const orders = await prisma.order.findMany({
      where: { branchId, status: 'PAID', closedAt: { gte: start, lte: end } },
      include: { items: true, payments: true },
      orderBy: { closedAt: 'asc' },
    });
    const totalRevenue = orders.reduce((s, o) => s + o.totalCents, 0);
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Daily Report ${date}</title>
<style>body{font-family:system-ui,sans-serif;padding:24px}h1{margin:0 0 8px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ddd;padding:6px;text-align:left;font-size:12px}th{background:#f4f4f4}td.r,th.r{text-align:right}</style>
</head><body>
<h1>Daily Report — ${date}</h1>
<div>Branch: ${branchId}</div>
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
    c.header('Content-Type', format === 'pdf' ? 'text/html; charset=utf-8' : 'text/html; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="daily-${date}.${format === 'pdf' ? 'html' : 'html'}"`);
    return c.body(html, 200);
  }

  return fail(c, 'ValidationError', "format must be 'csv' or 'pdf' (or 'html')", 400);
});

// Sprint 5.7 — Z-report (full end-of-day report per branch).
// Includes every section a manager needs to reconcile the day: gross/net
// sales, void/refund, tax, payment method breakdown, order types, top
// items, category breakdown, hourly chart, and shift drawer reconciliation.
reportRoutes.get('/z-report', async (c) => {
  const user = c.get('user');
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10);
  const branchId = c.req.query('branchId') || user.branchId;
  if (!branchId) return fail(c, 'NoBranch', 'No branch context', 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(c, 'ValidationError', 'Invalid date', 400);

  const cacheKey = `zreport:${branchId}:${date}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return ok(c, { ...cached, cached: true });

  const { start, end } = dayRange(date);

  // Parallel aggregates. We fetch flat rows for breakdowns (orderType,
  // channel, item, category) and aggregate counts/sums separately.
  const [
    paidAgg,
    voidAgg,
    refundAgg,
    voidRefunds,
    payments,
    paidItemsRaw,
    shifts,
    branch,
    dailyClose,
  ] = await Promise.all([
    prisma.order.aggregate({
      where: { branchId, status: 'PAID', closedAt: { gte: start, lte: end } },
      _count: { _all: true },
      _sum: { subtotalCents: true, discountCents: true, taxCents: true, totalCents: true },
    }),
    prisma.order.aggregate({
      where: { branchId, status: 'VOIDED', voidedAt: { gte: start, lte: end } },
      _count: { _all: true },
      _sum: { totalCents: true },
    }),
    prisma.order.aggregate({
      where: { branchId, status: 'REFUNDED', refundedAt: { gte: start, lte: end } },
      _count: { _all: true },
      _sum: { totalCents: true },
    }),
    prisma.order.findMany({
      where: {
        branchId,
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
      where: { status: 'PAID', paidAt: { gte: start, lte: end }, order: { branchId } },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    // All items in PAID orders for top items + category + hourly
    prisma.orderItem.findMany({
      where: { order: { branchId, status: 'PAID', closedAt: { gte: start, lte: end } } },
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
      where: { branchId, openedAt: { gte: start, lte: end } },
      select: {
        id: true, userId: true, status: true,
        openingCents: true, closingCents: true, expectedCents: true, varianceCents: true,
        openedAt: true, closedAt: true,
        user: { select: { name: true } },
      },
      orderBy: { openedAt: 'asc' },
    }),
    prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, code: true, name: true, city: true, timezone: true } }),
    prisma.dailyClose.findFirst({ where: { branchId, businessDate: start } }),
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

  // Hourly breakdown (UTC hours; client reformats with branch timezone).
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

  // Order type breakdown. Channel breakdown needs the separate ChannelOrder
  // join (one-to-many) so we fetch those rows too.
  const [channelOrderRows] = await Promise.all([
    prisma.channelOrder.findMany({
      where: { order: { branchId, status: 'PAID', closedAt: { gte: start, lte: end } } },
      select: { orderId: true, channel: true, order: { select: { totalCents: true } } },
    }),
  ]);

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
  const channelBreakdown: Record<string, { count: number; revenueCents: number }> = {
    POS: { count: 0, revenueCents: 0 },
  };
  // Orders that have a ChannelOrder link are external aggregator orders
  const externalOrderIds = new Set(channelOrderRows.map((c) => c.orderId));
  // Walk channelOrderRows to populate per-channel
  for (const c of channelOrderRows) {
    if (!c.order) continue;
    const cur = channelBreakdown[c.channel] || { count: 0, revenueCents: 0 };
    cur.count += 1;
    cur.revenueCents += c.order.totalCents;
    channelBreakdown[c.channel] = cur;
  }
  // POS = paid orders that are NOT external (walk paidItemsRaw)
  for (const it of paidItemsRaw) {
    if (externalOrderIds.has(it.orderId)) continue;
    const cur = channelBreakdown.POS!;
    cur.count += 1;
    cur.revenueCents += it.order.totalCents;
  }

  // Shift cash reconciliation (use openingCents/closingCents/expectedCents/varianceCents)
  const shiftReconciliation = shifts.map((s) => ({
    shiftId: s.id,
    cashier: s.user.name,
    openedAt: s.openedAt,
    closedAt: s.closedAt,
    status: s.status,
    openingCents: s.openingCents,
    closingCents: s.closingCents,
    expectedCents: s.expectedCents,
    varianceCents: s.varianceCents,
  }));

  // Void/refund log
  const voidRefundLog = voidRefunds.map((o) => ({
    orderId: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    totalCents: o.totalCents,
    occurredAt: (o.voidedAt || o.refundedAt)?.toISOString() ?? null,
  }));

  const grossCents = paidAgg._sum.subtotalCents ?? 0;
  const discountCents = paidAgg._sum.discountCents ?? 0;
  const taxCents = paidAgg._sum.taxCents ?? 0;
  const netCents = paidAgg._sum.totalCents ?? 0;

  const result = {
    date,
    branchId,
    branch,
    summary: {
      grossCents,
      discountCents,
      taxCents,
      netCents,
      paidOrders: paidAgg._count._all,
      voidedOrders: voidAgg._count._all,
      voidedCents: voidAgg._sum.totalCents ?? 0,
      refundedOrders: refundAgg._count._all,
      refundedCents: refundAgg._sum.totalCents ?? 0,
      avgTicketCents: paidAgg._count._all > 0 ? Math.round(netCents / paidAgg._count._all) : 0,
    },
    paymentBreakdown,
    orderTypeBreakdown,
    channelBreakdown,
    topItems,
    categoryBreakdown,
    hourly,
    shiftReconciliation,
    voidRefundLog,
    dailyClose: dailyClose
      ? {
          status: dailyClose.status,
          grossCents: dailyClose.grossCents,
          netCents: dailyClose.netCents,
          closedAt: dailyClose.createdAt,
        }
      : null,
    generatedAt: new Date().toISOString(),
  };
  cacheSet(cacheKey, result, 60_000);
  return ok(c, result);
});

// Sprint 5.7 — Z-report CSV export
reportRoutes.get('/z-report/export.csv', async (c) => {
  const user = c.get('user');
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10);
  const branchId = c.req.query('branchId') || user.branchId;
  if (!branchId) return fail(c, 'NoBranch', 'No branch context', 400);

  const { start, end } = dayRange(date);
  const [branch, paidAgg, voidAgg, refundAgg, payments, orderItems] = await Promise.all([
    prisma.branch.findUnique({ where: { id: branchId }, select: { name: true, code: true } }),
    prisma.order.aggregate({
      where: { branchId, status: 'PAID', closedAt: { gte: start, lte: end } },
      _count: { _all: true },
      _sum: { subtotalCents: true, discountCents: true, taxCents: true, totalCents: true },
    }),
    prisma.order.aggregate({
      where: { branchId, status: 'VOIDED', voidedAt: { gte: start, lte: end } },
      _count: { _all: true },
      _sum: { totalCents: true },
    }),
    prisma.order.aggregate({
      where: { branchId, status: 'REFUNDED', refundedAt: { gte: start, lte: end } },
      _count: { _all: true },
      _sum: { totalCents: true },
    }),
    prisma.payment.groupBy({
      by: ['method'],
      where: { status: 'PAID', paidAt: { gte: start, lte: end }, order: { branchId } },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    prisma.orderItem.groupBy({
      by: ['menuItemId'],
      where: { order: { branchId, status: 'PAID', closedAt: { gte: start, lte: end } } },
      _sum: { lineTotalCents: true, quantity: true },
    }),
  ]);

  const menuMap = new Map(
    (
      await prisma.menuItem.findMany({
        where: { id: { in: orderItems.map((o) => o.menuItemId) } },
        select: { id: true, name: true },
      })
    ).map((m) => [m.id, m.name])
  );

  const rows: (string | number)[][] = [];
  rows.push([`Z-Report — ${date}`]);
  rows.push([`Branch: ${branch?.name || ''} (${branch?.code || ''})`]);
  rows.push([]);
  rows.push(['SECTION', 'METRIC', 'VALUE_CENTS', 'COUNT']);
  rows.push(['Summary', 'Gross', paidAgg._sum.subtotalCents ?? 0, '']);
  rows.push(['Summary', 'Discount', paidAgg._sum.discountCents ?? 0, '']);
  rows.push(['Summary', 'Tax (PPN)', paidAgg._sum.taxCents ?? 0, '']);
  rows.push(['Summary', 'Net Sales', paidAgg._sum.totalCents ?? 0, paidAgg._count._all]);
  rows.push(['Summary', 'Voided', voidAgg._sum.totalCents ?? 0, voidAgg._count._all]);
  rows.push(['Summary', 'Refunded', refundAgg._sum.totalCents ?? 0, refundAgg._count._all]);
  rows.push([]);
  rows.push(['Payment', 'Method', 'Amount', 'Count']);
  for (const p of payments) {
    rows.push(['Payment', p.method, p._sum.amountCents ?? 0, p._count._all]);
  }
  rows.push([]);
  rows.push(['Items', 'Name', 'Qty', 'Revenue']);
  for (const i of orderItems
    .map((i) => ({ name: menuMap.get(i.menuItemId) || '(unknown)', qty: i._sum.quantity ?? 0, rev: i._sum.lineTotalCents ?? 0 }))
    .sort((a, b) => b.rev - a.rev)) {
    rows.push(['Items', i.name, i.qty, i.rev]);
  }

  return csvResponse(c, `z-report-${date}.csv`, rows);
});

// Sprint 4.4: chain report (OWNER only, aggregates across all branches)
reportRoutes.get('/chain', requireRole('OWNER'), async (c) => {
  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${date}T23:59:59.999Z`);

  const [branches, orders, allOrderIds, dailyCloses, commissionMismatches] = await Promise.all([
    prisma.branch.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    }),
    prisma.order.findMany({
      where: { openedAt: { gte: start, lte: end } },
      select: { id: true, branchId: true, status: true, totalCents: true },
    }),
    prisma.order.findMany({
      where: { openedAt: { gte: start, lte: end } },
      select: { id: true },
    }),
    prisma.dailyClose.findMany({
      where: { businessDate: start },
      select: { branchId: true, grossCents: true, netCents: true, status: true },
    }),
    prisma.commissionReport.findMany({
      where: { businessDate: start, status: 'MISMATCH', resolvedAt: null },
      select: { branchId: true, channel: true, deltaCents: true },
    }),
  ]);
  const orderIdToBranch = new Map(orders.map((o) => [o.id, o.branchId]));
  const payments = allOrderIds.length
    ? await prisma.payment.findMany({
        where: {
          paidAt: { gte: start, lte: end },
          orderId: { in: allOrderIds.map((o) => o.id) },
        },
        select: { orderId: true, method: true, amountCents: true },
      })
    : [];
  const paymentsWithBranch = payments.map((p) => ({
    ...p,
    branchId: orderIdToBranch.get(p.orderId) ?? '',
  }));

  const byBranch = branches.map((b) => {
    const branchOrders = orders.filter((o) => o.branchId === b.id);
    const branchPayments = paymentsWithBranch.filter((p) => p.branchId === b.id);
    const branchClose = dailyCloses.find((dc) => dc.branchId === b.id);
    const branchMismatches = commissionMismatches.filter((cm) => cm.branchId === b.id);
    return {
      branch: { id: b.id, code: b.code, name: b.name, city: b.city },
      orders: {
        total: branchOrders.length,
        paid: branchOrders.filter((o) => o.status === 'PAID').length,
        voided: branchOrders.filter((o) => o.status === 'VOIDED').length,
        refunded: branchOrders.filter((o) => o.status === 'REFUNDED').length,
        grossCents: branchOrders
          .filter((o) => o.status === 'PAID' || o.status === 'REFUNDED')
          .reduce((s, o) => s + o.totalCents, 0),
      },
      payments: branchPayments.reduce(
        (acc, p) => {
          acc[p.method] = (acc[p.method] ?? 0) + p.amountCents;
          return acc;
        },
        {} as Record<string, number>,
      ),
      dailyClose: branchClose
        ? {
            status: branchClose.status,
            grossCents: branchClose.grossCents,
            netCents: branchClose.netCents,
          }
        : null,
      mismatches: branchMismatches.length,
    };
  });

  const totals = {
    branches: branches.length,
    orders: orders.length,
    grossCents: orders
      .filter((o) => o.status === 'PAID' || o.status === 'REFUNDED')
      .reduce((s, o) => s + o.totalCents, 0),
    mismatches: commissionMismatches.length,
  };

  return ok(c, { date, totals, branches: byBranch });
});
