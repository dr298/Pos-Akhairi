// Sprint 7.2 — Error events API (OWNER read).
// Query recent errors with filters.
import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { requireRole } from '../middleware/auth.js';

export const errorRoutes = new Hono();

const querySchema = z.object({
  severity: z.enum(['ERROR', 'WARN', 'FATAL']).optional(),
  route: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  since: z.string().datetime().optional(),
});

errorRoutes.get('/', requireRole('OWNER'), async (c) => {
  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'BadRequest', details: parsed.error.flatten() }, 400);
  }
  const { severity, route, limit, since } = parsed.data;
  const where: any = {};
  if (severity) where.severity = severity;
  if (route) where.route = { contains: route };
  if (since) where.createdAt = { gte: new Date(since) };

  const [items, total, bySeverity, byRoute] = await Promise.all([
    prisma.errorEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.errorEvent.count({ where }),
    prisma.errorEvent.groupBy({
      by: ['severity'],
      _count: { _all: true },
    }),
    prisma.errorEvent.groupBy({
      by: ['route'],
      _count: { _all: true },
      orderBy: { _count: { route: 'desc' } },
      take: 10,
    }),
  ]);

  return c.json({
    data: {
      items,
      total,
      summary: {
        bySeverity: bySeverity.map((s) => ({ severity: s.severity, count: s._count._all })),
        topRoutes: byRoute.map((r) => ({ route: r.route, count: r._count._all })),
      },
    },
  });
});

errorRoutes.get('/stats', requireRole('OWNER'), async (c) => {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [total24h, total7d, bySeverity24h] = await Promise.all([
    prisma.errorEvent.count({ where: { createdAt: { gte: oneDayAgo } } }),
    prisma.errorEvent.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
    prisma.errorEvent.groupBy({
      by: ['severity'],
      where: { createdAt: { gte: oneDayAgo } },
      _count: { _all: true },
    }),
  ]);

  return c.json({
    data: {
      total24h,
      total7d,
      bySeverity24h: bySeverity24h.map((s) => ({ severity: s.severity, count: s._count._all })),
    },
  });
});
