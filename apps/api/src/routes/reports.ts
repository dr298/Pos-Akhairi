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
