// Channel analytics: aggregate order counts, revenue, and commissions
// by channel × time range. Manager+ only.

import { Hono } from 'hono';
import { prisma } from '@pos/db';
import { requireAuth, requireRole, ok, fail, type AppEnv } from '../middleware/auth.js';
import type { Prisma } from '@prisma/client';

export const channelAnalyticsRoutes = new Hono<AppEnv>();

channelAnalyticsRoutes.use('*', requireAuth);
channelAnalyticsRoutes.use('*', requireRole('OWNER', 'MANAGER'));

// GET /api/channel-analytics/summary?days=7
channelAnalyticsRoutes.get('/summary', async (c) => {
  const user = c.get('user');
  if (!user.branchId) return fail(c, 'NoBranch', 'User has no branch', 400);
  const days = Math.min(parseInt(c.req.query('days') ?? '7', 10), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const where: Prisma.ChannelOrderWhereInput = {
    branchId: user.branchId,
    receivedAt: { gte: since },
  };

  // Group by channel
  const grouped = await prisma.channelOrder.groupBy({
    by: ['channel', 'status'],
    where,
    _count: { _all: true },
    _sum: {
      totalCents: true,
      commissionCents: true,
      deliveryFeeCents: true,
    },
  });

  // Pivot by channel
  const byChannel: Record<string, any> = {};
  for (const r of grouped) {
    if (!byChannel[r.channel]) {
      byChannel[r.channel] = {
        channel: r.channel,
        orderCount: 0,
        totalRevenueCents: 0,
        totalCommissionCents: 0,
        totalDeliveryFeeCents: 0,
        byStatus: {} as Record<string, number>,
      };
    }
    byChannel[r.channel].orderCount += r._count._all;
    byChannel[r.channel].totalRevenueCents += r._sum.totalCents ?? 0;
    byChannel[r.channel].totalCommissionCents += r._sum.commissionCents ?? 0;
    byChannel[r.channel].totalDeliveryFeeCents += r._sum.deliveryFeeCents ?? 0;
    byChannel[r.channel].byStatus[r.status] =
      (byChannel[r.channel].byStatus[r.status] || 0) + r._count._all;
  }

  // Daily series (last N days)
  const daily = await prisma.$queryRaw<
    Array<{ day: Date; channel: string; order_count: bigint; revenue_cents: bigint }>
  >`
    SELECT
      date_trunc('day', "received_at") AS day,
      channel,
      COUNT(*) AS order_count,
      COALESCE(SUM("total_cents"), 0) AS revenue_cents
    FROM channel_orders
    WHERE "branch_id" = ${user.branchId}
      AND "received_at" >= ${since}
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `;

  return ok(c, {
    windowDays: days,
    byChannel: Object.values(byChannel),
    daily: daily.map((d) => ({
      day: d.day,
      channel: d.channel,
      orderCount: Number(d.order_count),
      revenueCents: Number(d.revenue_cents),
    })),
  });
});
