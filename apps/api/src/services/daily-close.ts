// Daily close / EOD auto-close service.
//
// Computes end-of-day totals for a branch on a business date and persists
// them in DailyClose. Run manually (POST /api/daily-close/run) or via cron
// at a configured hour per branch timezone.
//
// The "business date" is the local date in the branch's timezone — not UTC.
// For Asia/Jakarta (UTC+7), the business date 2026-06-20 covers 2026-06-20
// 17:00:00 UTC through 2026-06-21 16:59:59 UTC.

import type { Prisma } from '@prisma/client';
import { prisma } from '@pos/db';
import { logger } from '../logger.js';
import { wsBus } from '../lib/ws-bus.js';

export interface DailyCloseInput {
  branchId: string;
  businessDate: Date; // a date in the branch's local TZ, truncated to midnight
  timezone?: string;
  closedBy?: string; // userId or "AUTO"
  autoCloseShifts?: boolean;
}

export interface DailyCloseResult {
  id: string;
  businessDate: string;
  totals: {
    ordersTotal: number;
    ordersVoided: number;
    ordersRefunded: number;
    grossCents: number;
    discountCents: number;
    taxCents: number;
    netCents: number;
    deliveryFeeCents: number;
    serviceFeeCents: number;
    commissionCents: number;
    netAfterCommCents: number;
  };
  byChannel: Record<string, number>;
  byPayment: Record<string, number>;
  status: string;
}

/**
 * Compute and persist a DailyClose for a (branch, businessDate).
 * Idempotent: re-running the same date updates the same row.
 */
export async function runDailyClose(input: DailyCloseInput): Promise<DailyCloseResult> {
  const { branchId, closedBy = 'AUTO', autoCloseShifts = true } = input;
  const timezone = input.timezone ?? 'Asia/Jakarta';
  const businessDate = truncateToDate(input.businessDate);

  // Compute UTC range covering businessDate in the branch's timezone
  const { startUtc, endUtc } = businessDateRangeUtc(businessDate, timezone);

  logger.info(
    { branchId, businessDate: businessDate.toISOString().slice(0, 10), timezone, closedBy, startUtc, endUtc },
    'running daily close',
  );

  // 1) Pull local orders
  const orders = await prisma.order.findMany({
    where: {
      branchId,
      openedAt: { gte: startUtc, lt: endUtc },
    },
    include: { payments: true },
  });

  // Sprint 10 — channel orders removed (online ordering dropped).
  // byChannel is now derived only from local Order.type (DINE_IN /
  // TAKEAWAY / KIOSK). deliveryFeeCents / serviceFeeCents /
  // commissionCents / netAfterCommCents remain in the schema for
  // historical daily_closes rows but always 0 going forward.

  // 3) Aggregate
  const totals = {
    ordersTotal: orders.length,
    ordersVoided: orders.filter((o) => o.status === 'VOIDED').length,
    ordersRefunded: orders.filter((o) => o.status === 'REFUNDED').length,
    grossCents: 0,
    discountCents: 0,
    taxCents: 0,
    netCents: 0,
    deliveryFeeCents: 0,
    serviceFeeCents: 0,
    commissionCents: 0,
    netAfterCommCents: 0,
  };

  const byChannel: Record<string, number> = {};
  const byPayment: Record<string, number> = {};

  for (const o of orders) {
    if (o.status === 'VOIDED') continue;
    totals.grossCents += o.subtotalCents;
    totals.discountCents += o.discountCents;
    totals.taxCents += o.taxCents;
    if (o.status !== 'REFUNDED') {
      totals.netCents += o.totalCents;
    }
    // Channel: derive from order type
    const ch = o.type; // DINE_IN | TAKEAWAY | KIOSK
    byChannel[ch] = (byChannel[ch] ?? 0) + o.totalCents;
    // Payment
    for (const p of o.payments) {
      if (p.status === 'PAID' || p.status === 'REFUNDED') {
        const key = p.provider + ':' + p.method;
        byPayment[key] = (byPayment[key] ?? 0) + p.amountCents;
      }
    }
  }

  totals.netAfterCommCents = totals.netCents;

  // 5) Auto-close any open shifts for this branch
  let closedShiftId: string | null = null;
  if (autoCloseShifts) {
    const openShifts = await prisma.shift.findMany({
      where: { branchId, status: 'OPEN' },
    });
    for (const s of openShifts) {
      if (s.openedAt >= startUtc && s.openedAt < endUtc) {
        await prisma.shift.update({
          where: { id: s.id },
          data: {
            status: 'CLOSED',
            closedAt: endUtc,
            notes: (s.notes ?? '') + ' [auto-closed by daily close]',
          },
        });
        if (!closedShiftId) closedShiftId = s.id;
      }
    }
  }

  // 6) Persist
  const data: Prisma.DailyCloseUncheckedCreateInput = {
    branchId,
    shiftId: closedShiftId,
    businessDate,
    timezone,
    status: 'CLOSED',
    closedAt: new Date(),
    closedBy,
    ordersTotal: totals.ordersTotal,
    ordersVoided: totals.ordersVoided,
    ordersRefunded: totals.ordersRefunded,
    grossCents: totals.grossCents,
    discountCents: totals.discountCents,
    taxCents: totals.taxCents,
    netCents: totals.netCents,
    deliveryFeeCents: totals.deliveryFeeCents,
    serviceFeeCents: totals.serviceFeeCents,
    commissionCents: totals.commissionCents,
    netAfterCommCents: totals.netAfterCommCents,
    byPaymentJson: byPayment as Prisma.InputJsonValue,
    byChannelJson: byChannel as Prisma.InputJsonValue,
  };

  const row = await prisma.dailyClose.upsert({
    where: { branchId_businessDate: { branchId, businessDate } },
    create: data,
    update: data,
  });

  logger.info(
    { id: row.id, branchId, businessDate, totals, byChannel, byPayment, closedShiftId },
    'daily close completed',
  );

  // 7) WS broadcast
  wsBus.broadcast(
    {
      type: 'day.closed',
      dailyCloseId: row.id,
      branchId,
      businessDate: businessDate.toISOString().slice(0, 10),
      totals,
      at: Date.now(),
    },
    branchId,
  );

  return {
    id: row.id,
    businessDate: businessDate.toISOString().slice(0, 10),
    totals,
    byChannel,
    byPayment,
    status: row.status,
  };
}

function truncateToDate(d: Date): Date {
  // Normalize to UTC midnight; consumer treats the date as a calendar day
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Given a calendar date (in a TZ), return the [startUtc, endUtc) range.
 * Default TZ offset for Asia/Jakarta is +7, but for general support we use
 * the Intl API to compute the offset for the given date.
 */
function businessDateRangeUtc(date: Date, timezone: string): { startUtc: Date; endUtc: Date } {
  // Format date in the target TZ, parse offset
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  // Local midnight in TZ = ?
  // Strategy: figure out the UTC offset at noon of that date, then midnight = noon - 12h
  // Simpler: use Intl to get offset string
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  // Local date components
  const localDateStr = `${yyyy}-${mm}-${dd}`;
  // Get local time for "midnight" of that date
  const localMidnight = new Date(`${localDateStr}T00:00:00Z`); // interpret as UTC
  // Adjust by the TZ offset at that local time
  const offsetMin = getTzOffsetMinutes(timezone, localMidnight);
  // Local midnight in UTC = localMidnight - offsetMin*60s
  const startUtc = new Date(localMidnight.getTime() - offsetMin * 60 * 1000);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc, endUtc };
}

function getTzOffsetMinutes(tz: string, date: Date): number {
  // Returns the offset in minutes of `date` in `tz` from UTC
  // Positive means tz is ahead of UTC
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  const y = get('year');
  const mo = get('month');
  const d = get('day');
  let h = get('hour');
  if (h === 24) h = 0; // Intl quirk
  const mi = get('minute');
  const s = get('second');
  // Date in TZ (as if UTC)
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  // Difference (in min) from the original `date` (which is UTC)
  return Math.round((asUtc - date.getTime()) / 60000);
}
