// Channel order consolidation service.
//
// Responsibilities:
// - Receive an AggregatorOrder (from webhook or poll), upsert a ChannelOrder
//   row in the database, and emit a WS event so the POS shows it.
// - When a channel order is accepted, create a local Order linked to it.
// - When the aggregator reports status changes, update the linked ChannelOrder
//   + Order status.

import type { Channel, ChannelOrderStatus, Prisma } from '@prisma/client';
import { prisma } from '@pos/db';
import { logger } from '../logger.js';
import { wsBus } from '../lib/ws-bus.js';
import type { AggregatorClient, AggregatorOrder } from '../channels/types.js';

const CHANNEL_STATUS_MAP: Record<AggregatorOrder['status'], ChannelOrderStatus> = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  PICKED_UP: 'PICKED_UP',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
};

export interface ConsolidateInput {
  branchId: string;
  channel: Channel;
  channelConfigId: string;
  order: AggregatorOrder;
}

/**
 * Upsert a channel order. Returns the ChannelOrder row (after DB write).
 */
export async function consolidateChannelOrder(input: ConsolidateInput) {
  const { branchId, channel, channelConfigId, order } = input;
  const status = CHANNEL_STATUS_MAP[order.status] ?? 'PENDING';
  const itemsJson = order.items.map((i) => ({
    externalSku: i.externalSku,
    name: i.name,
    quantity: i.quantity,
    priceCents: i.priceCents,
    notes: i.notes,
    modifiers: i.modifiers,
  }));

  const existing = await prisma.channelOrder.findUnique({
    where: { channel_externalId: { channel, externalId: order.externalId } },
  });

  const data: Prisma.ChannelOrderCreateInput = {
    branch: { connect: { id: branchId } },
    channel,
    channelConfig: channelConfigId ? { connect: { id: channelConfigId } } : undefined,
    externalId: order.externalId,
    externalRef: order.externalRef,
    status,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    deliveryAddress: order.deliveryAddress,
    deliveryLat: order.deliveryLat != null ? order.deliveryLat : null,
    deliveryLng: order.deliveryLng != null ? order.deliveryLng : null,
    deliveryNotes: order.deliveryNotes,
    subtotalCents: order.subtotalCents,
    deliveryFeeCents: order.deliveryFeeCents,
    serviceFeeCents: order.serviceFeeCents,
    discountCents: order.discountCents,
    commissionCents: order.commissionCents,
    totalCents: order.totalCents,
    itemsJson,
    rawPayload: order.raw as Prisma.InputJsonValue,
    receivedAt: new Date(order.orderedAt),
  };

  const updateData: Prisma.ChannelOrderUpdateInput = {
    channelConfig: channelConfigId ? { connect: { id: channelConfigId } } : { disconnect: true },
    externalRef: order.externalRef,
    status,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    deliveryAddress: order.deliveryAddress,
    deliveryLat: order.deliveryLat != null ? order.deliveryLat : null,
    deliveryLng: order.deliveryLng != null ? order.deliveryLng : null,
    deliveryNotes: order.deliveryNotes,
    subtotalCents: order.subtotalCents,
    deliveryFeeCents: order.deliveryFeeCents,
    serviceFeeCents: order.serviceFeeCents,
    discountCents: order.discountCents,
    commissionCents: order.commissionCents,
    totalCents: order.totalCents,
    itemsJson,
    rawPayload: order.raw as Prisma.InputJsonValue,
  };

  let row;
  if (!existing) {
    row = await prisma.channelOrder.create({ data });
    // First event: system received
    await prisma.channelOrderEvent.create({
      data: {
        channelOrder: { connect: { id: row.id } },
        status: 'PENDING',
        actor: 'SYSTEM',
        note: 'received from channel',
        raw: order.raw as Prisma.InputJsonValue,
      },
    });
  } else {
    row = await prisma.channelOrder.update({
      where: { id: existing.id },
      data: {
        ...updateData,
        // Lifecycle timestamps
        acceptedAt: status === 'ACCEPTED' && !existing.acceptedAt ? new Date() : existing.acceptedAt,
        preparedAt: status === 'PREPARING' && !existing.preparedAt ? new Date() : existing.preparedAt,
        deliveredAt: status === 'DELIVERED' && !existing.deliveredAt ? new Date() : existing.deliveredAt,
        cancelledAt: status === 'CANCELLED' && !existing.cancelledAt ? new Date() : existing.cancelledAt,
      },
    });
    if (existing.status !== status) {
      await prisma.channelOrderEvent.create({
        data: {
          channelOrder: { connect: { id: row.id } },
          status,
          actor: 'AGGREGATOR',
          note: `status: ${existing.status} -> ${status}`,
        },
      });
    }
  }

  // If the new status is CANCELLED/REJECTED and there's a linked local order,
  // reverse it (void if still OPEN, refund if PAID).
  if (existing && existing.status !== status && (status === 'CANCELLED' || status === 'REJECTED')) {
    if (existing.orderId) {
      await reverseLocalOrderForChannelCancellation(
        existing.orderId,
        status,
        `channel order ${status.toLowerCase()} by aggregator`,
      ).catch((e) => {
        logger.warn(
          { err: (e as Error).message, channelOrderId: row.id, localOrderId: existing.orderId },
          'failed to reverse local order for channel cancellation',
        );
      });
    }
  }

  // Broadcast WS event
  wsBus.broadcast(
    {
      type: 'order.created',
      orderId: row.id,
      orderNumber: row.externalRef ?? row.externalId,
      totalCents: row.totalCents,
      status: row.status,
      branchId: row.branchId,
      at: Date.now(),
    },
    row.branchId,
  );

  logger.info(
    { channel, externalId: order.externalId, status, branchId },
    'channel order consolidated',
  );
  return row;
}

/**
 * Create a local Order from an accepted ChannelOrder.
 *
 * Maps SKUs from the aggregator to local MenuItem by SKU (MenuItem.sku).
 * Items that cannot be mapped are logged and dropped. The created Order is
 * linked back to the ChannelOrder via orderId.
 */
export async function createLocalOrderFromChannel(channelOrderId: string): Promise<string> {
  const co = await prisma.channelOrder.findUnique({
    where: { id: channelOrderId },
  });
  if (!co) throw new Error('ChannelOrder not found');
  if (co.orderId) {
    // already linked
    return co.orderId;
  }
  const items = (co.itemsJson as Array<{ externalSku: string; quantity: number; priceCents: number; notes?: string }>) || [];

  // Find menu items by SKU in the same branch
  const skus = items.map((i) => i.externalSku);
  const menuItems = await prisma.menuItem.findMany({
    where: { branchId: co.branchId, sku: { in: skus } },
  });
  const menuBySku = new Map(menuItems.map((m) => [m.sku, m]));

  // Build order items; skip unmapped SKUs (with warning)
  const orderItems: Prisma.OrderItemCreateWithoutOrderInput[] = [];
  for (const it of items) {
    const m = menuBySku.get(it.externalSku);
    if (!m) {
      logger.warn(
        { channelOrderId, sku: it.externalSku },
        'channel item: no matching menu item by SKU, skipping',
      );
      continue;
    }
    orderItems.push({
      menuItem: { connect: { id: m.id } },
      nameSnapshot: m.name,
      priceCents: m.priceCents,
      quantity: it.quantity,
      notes: it.notes,
      lineTotalCents: m.priceCents * it.quantity,
    });
  }

  if (orderItems.length === 0) {
    throw new Error('No mappable items — cannot create local order');
  }

  // Generate order number
  const orderNumber = await generateOrderNumber(co.branchId);

  // Compute totals — we use the channel's pricing for the customer-facing
  // total, but the local subtotal uses MenuItem priceCents. Tax defaults to
  // 11% (Indonesian PPN) if any item has taxRateBp.
  const subtotal = orderItems.reduce((s, i) => s + (i.lineTotalCents ?? 0), 0);
  const tax = Math.round((subtotal * 1100) / 10000);
  const total = subtotal + tax;

  const order = await prisma.order.create({
    data: {
      branchId: co.branchId,
      orderNumber,
      type: 'DELIVERY',
      status: 'OPEN',
      customerName: co.customerName,
      notes: co.deliveryNotes,
      subtotalCents: subtotal,
      taxCents: tax,
      totalCents: total,
      openedById: (await prisma.user.findFirst({ where: { branchId: co.branchId, role: 'OWNER' } }))!.id,
      items: { create: orderItems },
    },
  });

  await prisma.channelOrder.update({
    where: { id: co.id },
    data: { orderId: order.id, acceptedAt: new Date() },
  });

  // Emit WS event
  wsBus.broadcast(
    {
      type: 'order.created',
      orderId: order.id,
      orderNumber: order.orderNumber,
      totalCents: order.totalCents,
      status: order.status,
      branchId: order.branchId,
      at: Date.now(),
    },
    order.branchId,
  );

  logger.info(
    { channelOrderId, orderId: order.id, orderNumber },
    'local order created from channel order',
  );
  return order.id;
}

async function generateOrderNumber(branchId: string): Promise<string> {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const prefix = `ORD-${y}${m}${d}`;
  // Find the highest suffix for today
  const last = await prisma.order.findFirst({
    where: { branchId, orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: 'desc' },
  });
  let n = 1;
  if (last) {
    const parts = last.orderNumber.split('-');
    const lastN = parseInt(parts[parts.length - 1] ?? '0', 10);
    if (!isNaN(lastN)) n = lastN + 1;
  }
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

/**
 * Update a channel order's status (from the POS side, e.g. kitchen marks
 * ready). Optionally pushes the status to the aggregator.
 */
export async function updateChannelOrderStatus(
  channelOrderId: string,
  status: ChannelOrderStatus,
  actor: string,
  note?: string,
  client?: AggregatorClient,
): Promise<void> {
  const co = await prisma.channelOrder.findUnique({
    where: { id: channelOrderId },
  });
  if (!co) throw new Error('ChannelOrder not found');

  const now = new Date();
  const data: Prisma.ChannelOrderUpdateInput = { status };
  if (status === 'ACCEPTED' && !co.acceptedAt) data.acceptedAt = now;
  if (status === 'PREPARING' && !co.preparedAt) data.preparedAt = now;
  if (status === 'DELIVERED' && !co.deliveredAt) data.deliveredAt = now;
  if (status === 'CANCELLED' && !co.cancelledAt) data.cancelledAt = now;

  await prisma.$transaction([
    prisma.channelOrder.update({ where: { id: co.id }, data }),
    prisma.channelOrderEvent.create({
      data: { channelOrderId: co.id, status, actor, note },
    }),
  ]);

  // If we're cancelling/rejecting, also reverse the local order (void if OPEN,
  // refund if PAID). Best-effort — never throw out of here.
  if ((status === 'CANCELLED' || status === 'REJECTED') && co.orderId) {
    try {
      await reverseLocalOrderForChannelCancellation(
        co.orderId,
        status,
        note ?? `channel order ${status.toLowerCase()} by ${actor}`,
      );
    } catch (e) {
      logger.warn(
        { err: (e as Error).message, channelOrderId: co.id, localOrderId: co.orderId },
        'failed to reverse local order on channel cancellation',
      );
    }
  }

  // Push to aggregator (best-effort)
  if (client) {
    try {
      switch (status) {
        case 'ACCEPTED':
          await client.acceptOrder(co.externalId, 15);
          break;
        case 'READY':
          await client.markReady(co.externalId);
          break;
        case 'CANCELLED':
          await client.cancelOrder(co.externalId, note ?? 'cancelled by merchant');
          break;
        case 'REJECTED':
          await client.rejectOrder(co.externalId, note ?? 'rejected by merchant');
          break;
        default:
          // PREPARING / PICKED_UP / DELIVERED are typically aggregator-driven
          break;
      }
    } catch (e) {
      // Best-effort: local status is already updated. Surface failure via
      // a warning event so ops can see the aggregator is desynced.
      logger.warn(
        { err: (e as Error).message, channelOrderId: co.id, status, channel: co.channel },
        'failed to push status to aggregator (local state still updated)',
      );
      try {
        await prisma.channelOrderEvent.create({
          data: {
            channelOrderId: co.id,
            status,
            actor: 'SYSTEM',
            note: `aggregator push failed: ${(e as Error).message}`,
          },
        });
      } catch {
        // best-effort
      }
    }
  }

  wsBus.broadcast(
    {
      type: 'order.paid',
      orderId: co.id,
      orderNumber: co.externalRef ?? co.externalId,
      totalCents: co.totalCents,
      status,
      branchId: co.branchId,
      at: Date.now(),
    },
    co.branchId,
  );
}

/**
 * Reverse a local Order because the aggregator cancelled the underlying
 * channel order. If the order is still OPEN, void it. If PAID, refund it.
 * No-op if already VOIDED/REFUNDED.
 *
 * Called automatically by consolidateChannelOrder when an aggregator reports
 * CANCELLED/REJECTED on an already-accepted channel order.
 */
export async function reverseLocalOrderForChannelCancellation(
  orderId: string,
  channelStatus: 'CANCELLED' | 'REJECTED',
  reason: string,
): Promise<{ action: 'voided' | 'refunded' | 'noop'; status: string }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: true },
  });
  if (!order) {
    logger.warn({ orderId }, 'reverseLocalOrder: order not found');
    return { action: 'noop', status: 'not_found' };
  }
  if (order.status === 'VOIDED' || order.status === 'REFUNDED') {
    return { action: 'noop', status: order.status };
  }

  const actor = (await prisma.user.findFirst({ where: { branchId: order.branchId, role: 'OWNER' } }))?.id
    ?? order.openedById;

  if (order.status === 'OPEN') {
    // Void it
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'VOIDED',
        voidedAt: new Date(),
        voidedById: actor,
        voidReason: reason,
      },
    });
    logger.info(
      { orderId, channelStatus, reason },
      'local order voided (channel cancellation)',
    );
    wsBus.broadcast(
      {
        type: 'order.voided',
        orderId,
        orderNumber: order.orderNumber,
        totalCents: order.totalCents,
        status: 'VOIDED',
        branchId: order.branchId,
        at: Date.now(),
      },
      order.branchId,
    );
    return { action: 'voided', status: 'VOIDED' };
  }

  if (order.status === 'PAID') {
    // Refund it via CASH (or mark original as REFUNDED)
    // For channel cancellations we always refund the full amount back to the
    // aggregator — they will handle the customer refund. So we mark the
    // original payment as REFUNDED rather than create a new CASH payment.
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'REFUNDED',
          voidedAt: new Date(),
          voidedById: actor,
          voidReason: reason,
        },
      });
      // Mark all PAID payments as REFUNDED
      await tx.payment.updateMany({
        where: { orderId, status: 'PAID' },
        data: { status: 'REFUNDED' },
      });
    });
    logger.info(
      { orderId, channelStatus, reason },
      'local order refunded (channel cancellation)',
    );
    wsBus.broadcast(
      {
        type: 'order.refunded',
        orderId,
        orderNumber: order.orderNumber,
        totalCents: order.totalCents,
        status: 'REFUNDED',
        branchId: order.branchId,
        at: Date.now(),
      },
      order.branchId,
    );
    return { action: 'refunded', status: 'REFUNDED' };
  }

  // PREP / DONE / etc — too late to fully reverse. Just record the event.
  logger.warn(
    { orderId, currentStatus: order.status, channelStatus },
    'channel cancellation arrived for non-reversible order status; manual review needed',
  );
  return { action: 'noop', status: order.status };
}
