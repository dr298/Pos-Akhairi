// Sprint 4.3 — Daily close (EOD) routes.
// MANAGER+ only.

import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { runDailyClose } from '../services/daily-close.js';
import { logger } from '../logger.js';

export const dailyCloseRoutes = new Hono();
dailyCloseRoutes.use('*', requireAuth);

const runSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1).optional(),
  autoCloseShifts: z.boolean().default(true),
});

// POST /api/daily-close/run — manually trigger a daily close for a date
dailyCloseRoutes.post('/run', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = runSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);
  }
  const businessDate = new Date(parsed.data.businessDate + 'T00:00:00Z');
  try {
    const result = await runDailyClose({
      businessDate,
      timezone: parsed.data.timezone,
      closedBy: user.id ?? 'AUTO',
      autoCloseShifts: parsed.data.autoCloseShifts,
    });
    return ok(c, result);
  } catch (e) {
    logger.error({ err: (e as Error).message, businessDate }, 'daily close run failed');
    return fail(c, 'DailyCloseError', (e as Error).message, 500);
  }
});

// GET /api/daily-close — list daily closes
dailyCloseRoutes.get('/', requireRole('OWNER', 'MANAGER'), async (c) => {
  const limit = parseInt(c.req.query('limit') ?? '30', 10);
  const rows = await prisma.dailyClose.findMany({
    orderBy: { businessDate: 'desc' },
    take: Math.min(limit, 365),
  });
  return ok(c, rows);
});

// GET /api/daily-close/:id — single daily close
dailyCloseRoutes.get('/:id', requireRole('OWNER', 'MANAGER'), async (c) => {
  const id = c.req.param('id');
  const row = await prisma.dailyClose.findUnique({ where: { id } });
  if (!row) return fail(c, 'NotFound', 'Daily close not found', 404);
  return ok(c, row);
});

// GET /api/daily-close/:id/export.csv — CSV export
dailyCloseRoutes.get('/:id/export.csv', requireRole('OWNER', 'MANAGER'), async (c) => {
  const id = c.req.param('id');
  const row = await prisma.dailyClose.findUnique({ where: { id } });
  if (!row) return fail(c, 'NotFound', 'Daily close not found', 404);
  const byChannel = (row.byChannelJson as Record<string, number>) ?? {};
  const byPayment = (row.byPaymentJson as Record<string, number>) ?? {};
  const lines: string[] = [];
  lines.push(`Bakmie POS — Daily Close — ${row.businessDate.toISOString().slice(0, 10)}`);
  lines.push(`Status: ${row.status}`);
  lines.push(`Closed at: ${row.closedAt?.toISOString() ?? '—'}`);
  lines.push(`Closed by: ${row.closedBy ?? '—'}`);
  lines.push('');
  lines.push('Orders');
  lines.push(`  Total,${row.ordersTotal}`);
  lines.push(`  Voided,${row.ordersVoided}`);
  lines.push(`  Refunded,${row.ordersRefunded}`);
  lines.push('');
  lines.push('Totals (cents)');
  lines.push(`  Gross,${row.grossCents}`);
  lines.push(`  Discount,${row.discountCents}`);
  lines.push(`  Tax,${row.taxCents}`);
  lines.push(`  Net,${row.netCents}`);
  lines.push(`  Delivery fee,${row.deliveryFeeCents}`);
  lines.push(`  Service fee,${row.serviceFeeCents}`);
  lines.push(`  Commission,${row.commissionCents}`);
  lines.push(`  Net after commission,${row.netAfterCommCents}`);
  lines.push('');
  lines.push('By channel (cents)');
  for (const [k, v] of Object.entries(byChannel)) lines.push(`  ${k},${v}`);
  lines.push('');
  lines.push('By payment (cents)');
  for (const [k, v] of Object.entries(byPayment)) lines.push(`  ${k},${v}`);

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header(
    'Content-Disposition',
    `attachment; filename="daily-close-${row.businessDate.toISOString().slice(0, 10)}.csv"`,
  );
  return c.text(lines.join('\n'));
});
