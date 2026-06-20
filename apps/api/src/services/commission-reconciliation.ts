// Sprint 4.2 — Commission reconciliation.
//
// On each EOD close, fetch the aggregator's view of commission billed for
// the day, compare it to what we recorded locally, and store the delta in
// CommissionReport. Any non-zero delta is a MISMATCH that ops must resolve.
//
// Sources of mismatch:
//   - Aggregator promo/discount applied that we didn't model
//   - Wrong commission rate configured locally
//   - Order cancelled on aggregator side but not on ours
//   - Float/precision differences in commission calculation
//
// This is the financial safety net — without it, a commission-rate drift
// silently leaks money.

import { prisma } from '@pos/db';
import type { Channel } from '@prisma/client';
import { buildClient } from '../channels/registry.js';
import type { AggregatorDailyReport } from '../channels/types.js';
import { logger } from '../logger.js';
import { wsBus } from '../lib/ws-bus.js';

export interface ReconciliationResult {
  businessDate: string;
  channel: Channel;
  localCommissionCents: number;
  localOrderCount: number;
  aggregatorCommissionCents: number | null;  // null = couldn't fetch
  aggregatorOrderCount: number | null;
  deltaCents: number | null;
  status: 'MATCH' | 'MISMATCH' | 'FETCH_FAILED' | 'NO_DATA';
  notes: string[];
}

/**
 * Reconcile commission for a single (branch, channel, businessDate) triplet.
 *
 * Aggregator fetch is best-effort: if it fails, we record FETCH_FAILED and
 * keep the local number so ops knows the data exists even if the API
 * couldn't be reached.
 */
export async function reconcileChannelCommission(opts: {
  branchId: string;
  channel: Channel;
  businessDate: Date;
  businessDateStr: string;
}): Promise<ReconciliationResult> {
  const { branchId, channel, businessDate, businessDateStr } = opts;
  const startMs = businessDate.getTime();
  const endMs = startMs + 24 * 60 * 60 * 1000;

  // 1. Local totals from channel_orders
  const localRows = await prisma.channelOrder.findMany({
    where: {
      branchId,
      channel,
      receivedAt: { gte: new Date(startMs), lt: new Date(endMs) },
    },
    select: {
      id: true,
      commissionCents: true,
      totalCents: true,
      status: true,
    },
  });

  const localCommissionCents = localRows.reduce(
    (sum, r) => sum + r.commissionCents,
    0,
  );
  const localOrderCount = localRows.length;
  const localBilledCents = localRows
    .filter((r) => ['DELIVERED', 'READY', 'PICKED_UP'].includes(r.status))
    .reduce((sum, r) => sum + r.totalCents, 0);

  // 2. Aggregator report (best-effort)
  let aggregatorCommissionCents: number | null = null;
  let aggregatorOrderCount: number | null = null;
  const notes: string[] = [];

  const config = await prisma.channelConfig.findFirst({
    where: { branchId, channel, enabled: true },
  });

  if (!config) {
    return {
      businessDate: businessDateStr,
      channel,
      localCommissionCents,
      localOrderCount,
      aggregatorCommissionCents: null,
      aggregatorOrderCount: null,
      deltaCents: null,
      status: 'NO_DATA',
      notes: ['no enabled channel config for this branch'],
    };
  }

  let aggregatorBilledCents: number | null = null;
  try {
    const client = buildClient({
      channel,
      storeId: config.storeId,
      apiKeyEncrypted: config.apiKeyEncrypted,
      apiSecretEncrypted: config.apiSecretEncrypted,
    });
    if (!client) {
      throw new Error('buildClient returned null (missing credentials)');
    }
    const report = await client.getDailyReport(businessDateStr);
    aggregatorCommissionCents = report.commissionCents;
    aggregatorOrderCount = report.orderCount;
    aggregatorBilledCents = report.grossCents;
  } catch (e) {
    logger.warn(
      { err: (e as Error).message, channel, businessDate: businessDateStr },
      'commission reconciliation: aggregator fetch failed',
    );
    return {
      businessDate: businessDateStr,
      channel,
      localCommissionCents,
      localOrderCount,
      aggregatorCommissionCents: null,
      aggregatorOrderCount: null,
      deltaCents: null,
      status: 'FETCH_FAILED',
      notes: [`aggregator fetch failed: ${(e as Error).message}`],
    };
  }

  // 3. Compare
  const deltaCents = localCommissionCents - (aggregatorCommissionCents ?? 0);
  const billedDelta = localBilledCents - (aggregatorBilledCents ?? 0);
  const countDelta = localOrderCount - (aggregatorOrderCount ?? 0);

  if (deltaCents !== 0) {
    notes.push(
      `commission delta: local ${localCommissionCents} vs aggregator ${aggregatorCommissionCents} (delta ${deltaCents})`,
    );
  }
  if (billedDelta !== 0) {
    notes.push(
      `billed delta: local ${localBilledCents} vs aggregator ${aggregatorBilledCents} (delta ${billedDelta})`,
    );
  }
  if (countDelta !== 0) {
    notes.push(
      `count delta: local ${localOrderCount} vs aggregator ${aggregatorOrderCount} (delta ${countDelta})`,
    );
  }

  const status: ReconciliationResult['status'] =
    deltaCents === 0 && billedDelta === 0 && countDelta === 0
      ? 'MATCH'
      : 'MISMATCH';

  return {
    businessDate: businessDateStr,
    channel,
    localCommissionCents,
    localOrderCount,
    aggregatorCommissionCents,
    aggregatorOrderCount,
    deltaCents,
    status,
    notes,
  };
}

/**
 * Reconcile all enabled channels for a branch on a given date.
 * Persists each result as a CommissionReport row.
 */
export async function reconcileAllChannels(opts: {
  branchId: string;
  businessDate: Date;
  businessDateStr: string;
  createdBy: string;
}): Promise<ReconciliationResult[]> {
  const configs = await prisma.channelConfig.findMany({
    where: { branchId: opts.branchId, enabled: true },
    select: { channel: true },
    distinct: ['channel'],
  });

  const results: ReconciliationResult[] = [];
  for (const { channel } of configs) {
    const r = await reconcileChannelCommission({
      branchId: opts.branchId,
      channel,
      businessDate: opts.businessDate,
      businessDateStr: opts.businessDateStr,
    });
    results.push(r);
  }

  // Persist
  for (const r of results) {
    await prisma.commissionReport.upsert({
      where: {
        branchId_channel_businessDate: {
          branchId: opts.branchId,
          channel: r.channel,
          businessDate: new Date(r.businessDate + 'T00:00:00Z'),
        },
      },
      create: {
        branchId: opts.branchId,
        channel: r.channel,
        businessDate: new Date(r.businessDate + 'T00:00:00Z'),
        localCommissionCents: r.localCommissionCents,
        localOrderCount: r.localOrderCount,
        localBilledCents:
          r.localCommissionCents === 0 && r.localOrderCount === 0
            ? 0
            : null,
        aggregatorCommissionCents: r.aggregatorCommissionCents,
        aggregatorOrderCount: r.aggregatorOrderCount,
        aggregatorBilledCents:
          r.aggregatorCommissionCents === null ? null : r.aggregatorCommissionCents,
        deltaCents: r.deltaCents,
        status: r.status,
        notes: r.notes.join(' | '),
        resolvedBy: null,
        resolvedAt: null,
        createdBy: opts.createdBy,
      },
      update: {
        localCommissionCents: r.localCommissionCents,
        localOrderCount: r.localOrderCount,
        aggregatorCommissionCents: r.aggregatorCommissionCents,
        aggregatorOrderCount: r.aggregatorOrderCount,
        deltaCents: r.deltaCents,
        status: r.status,
        notes: r.notes.join(' | '),
      },
    });
  }

  const mismatchCount = results.filter((r) => r.status === 'MISMATCH').length;
  const fetchFailed = results.filter((r) => r.status === 'FETCH_FAILED').length;
  wsBus.broadcast({
    type: 'order.created', // reuse — same bus; clients that care about reconciliation filter on dailyCloseId/deltaCents
    at: Date.now(),
    branchId: opts.branchId,
    orderId: '',
    orderNumber: '',
    totalCents: 0,
    status: 'reconciled',
  });

  logger.info(
    {
      branchId: opts.branchId,
      businessDate: opts.businessDateStr,
      total: results.length,
      match: results.filter((r) => r.status === 'MATCH').length,
      mismatch: mismatchCount,
      fetchFailed,
    },
    'commission reconciliation complete',
  );

  return results;
}
