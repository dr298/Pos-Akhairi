// Sprint 4.2 — Commission reconciliation routes.
// MANAGER+ only. All routes scoped to caller's branch.

import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { reconcileAllChannels, reconcileChannelCommission } from '../services/commission-reconciliation.js';
import { logger } from '../logger.js';

export const commissionRoutes = new Hono();
commissionRoutes.use('*', requireAuth);

const runSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  channel: z.enum(['GOFOOD', 'GRABFOOD', 'SHOPEEFOOD']).optional(),
});

// POST /api/commissions/reconcile — run reconciliation for a date
commissionRoutes.post('/reconcile', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  const branchId = user.branchId ?? '';
  if (!branchId) return fail(c, 'NoBranch', 'User has no branch assigned', 400);
  const body = await c.req.json().catch(() => ({}));
  const parsed = runSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);
  }
  const businessDate = new Date(parsed.data.businessDate + 'T00:00:00Z');
  try {
    if (parsed.data.channel) {
      const r = await reconcileChannelCommission({
        branchId,
        channel: parsed.data.channel,
        businessDate,
        businessDateStr: parsed.data.businessDate,
      });
      return ok(c, [r]);
    }
    const results = await reconcileAllChannels({
      branchId,
      businessDate,
      businessDateStr: parsed.data.businessDate,
      createdBy: user.id ?? 'SYSTEM',
    });
    return ok(c, results);
  } catch (e) {
    logger.error({ err: (e as Error).message, branchId, businessDate }, 'commission reconciliation failed');
    return fail(c, 'ReconcileError', (e as Error).message, 500);
  }
});

// GET /api/commissions — list recent reports for this branch
commissionRoutes.get('/', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  const branchId = user.branchId ?? '';
  if (!branchId) return fail(c, 'NoBranch', 'User has no branch assigned', 400);
  const status = c.req.query('status');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '30', 10), 365);
  const rows = await prisma.commissionReport.findMany({
    where: {
      branchId,
      ...(status ? { status } : {}),
    },
    orderBy: { businessDate: 'desc' },
    take: limit,
  });
  return ok(c, rows);
});

// GET /api/commissions/mismatches — list unresolved mismatches only
commissionRoutes.get('/mismatches', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  const branchId = user.branchId ?? '';
  if (!branchId) return fail(c, 'NoBranch', 'User has no branch assigned', 400);
  const rows = await prisma.commissionReport.findMany({
    where: {
      branchId,
      status: 'MISMATCH',
      resolvedAt: null,
    },
    orderBy: { businessDate: 'desc' },
    take: 100,
  });
  return ok(c, rows);
});

// GET /api/commissions/:id — single report
commissionRoutes.get('/:id', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const row = await prisma.commissionReport.findUnique({ where: { id } });
  if (!row) return fail(c, 'NotFound', 'Report not found', 404);
  if (row.branchId !== user.branchId) {
    return fail(c, 'Forbidden', 'Not your branch', 403);
  }
  return ok(c, row);
});

// POST /api/commissions/:id/resolve — mark a MISMATCH as resolved
commissionRoutes.post('/:id/resolve', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const existing = await prisma.commissionReport.findUnique({ where: { id } });
  if (!existing) return fail(c, 'NotFound', 'Report not found', 404);
  if (existing.branchId !== user.branchId) {
    return fail(c, 'Forbidden', 'Not your branch', 403);
  }
  const body = await c.req.json().catch(() => ({}));
  const resolutionNote = typeof body.note === 'string' ? body.note.slice(0, 1000) : '';
  const updated = await prisma.commissionReport.update({
    where: { id },
    data: {
      resolvedBy: user.id ?? 'UNKNOWN',
      resolvedAt: new Date(),
      notes: existing.notes
        ? `${existing.notes} | RESOLVED: ${resolutionNote}`
        : `RESOLVED: ${resolutionNote}`,
    },
  });
  return ok(c, updated);
});
