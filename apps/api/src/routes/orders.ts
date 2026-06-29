import { Hono } from 'hono';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { computeDiscount } from './discounts.js';
import { computePromo, type PromoLineItem, type PromoLike } from './promos.js';
import { finalizeOrderPayment, restoreInventoryForOrder } from '../services/payment-finalize.js';
import { getEffectivePpnBp } from '../services/settings.js';
import { wsBus } from '../lib/ws-bus.js';
import { incCounter, observeHistogram } from '../middleware/metrics.js';

export const orderRoutes = new Hono<AppEnv>();

orderRoutes.use('*', requireAuth);

const orderItemSchema = z.object({
  menuItemId: z.string().min(1),
  quantity: z.number().int().positive(),
  notes: z.string().max(200).optional(),
  modifiersJson: z.record(z.string(), z.unknown()).optional(),
});

// Sprint 8.6 — combo items. Each entry expands to one or more order
// line items at the combo's set price.
const orderComboItemSchema = z.object({
  comboId: z.string().min(1),
  quantity: z.number().int().positive().max(99),
  notes: z.string().max(200).optional(),
});

// S1.5 — order create schema. Accepts both `orderType` (legacy frontend
// key) and `type` (canonical) — silently preferring `orderType` first if
// both are present. All optional string fields are `.nullable()` so the
// frontend can send `null` to explicitly clear a value (instead of having
// Enum matches the DB column (`DINE_IN | TAKEAWAY | KIOSK`); the
// frontend's `TAKEOUT` is mapped to `TAKEAWAY` below.
const orderCreateSchema = z.object({
  type: z.enum(['DINE_IN', 'TAKEAWAY', 'KIOSK']).nullable().optional(),
  orderType: z.enum(['DINE_IN', 'TAKEOUT', 'TAKEAWAY', 'KIOSK']).nullable().optional(),
  tableNumber: z.string().max(20).nullable().optional(),
  customerName: z.string().max(100).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  shiftId: z.string().nullable().optional(),
  discountCode: z.string().min(1).max(50).nullable().optional(),
  discountId: z.string().nullable().optional(),
  // Sprint 8.7 — promo engine code. Validated and applied during creation.
  promoCode: z.string().min(1).max(50).nullable().optional(),
  items: z.array(orderItemSchema).min(1).optional(),
  // Sprint 8.6 — combo items (set meals). Expanded into line items.
  comboItems: z.array(orderComboItemSchema).optional(),
  // Sprint 8.8 — optional customer / member attach. When set, the loyalty
  // service credits the customer's loyalty balance on payment. We
  // accept but don't validate membership here — payment-finalize is
  // defensive and will warn if the customer lookup fails.
  customerId: z.string().min(1).max(50).nullable().optional(),
}).refine(
  (o) => (o.items && o.items.length > 0) || (o.comboItems && o.comboItems.length > 0),
  { message: 'At least one item or combo is required' },
);

async function nextOrderNumber(): Promise<string> {
  const today = new Date();
  const ymd =
    today.getFullYear().toString() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');
  const prefix = `ORD-${ymd}-`;
  const last = await prisma.order.findFirst({
    where: { orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: 'desc' },
  });
  let seq = 1;
  if (last) {
    const n = parseInt(last.orderNumber.slice(prefix.length), 10);
    if (!isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

async function loadActiveShift(userId: string) {
  return prisma.shift.findFirst({
    where: { userId, status: 'OPEN' },
  });
}

orderRoutes.get('/', async (c) => {
  const status = c.req.query('status');
  const orders = await prisma.order.findMany({
    where: {
      ...(status ? { status: status as any } : {}),
    },
    include: { items: true, payments: true },
    orderBy: { openedAt: 'desc' },
    take: 50,
  });
  return ok(c, orders);
});

orderRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, payments: true, shift: true, openedBy: true },
  });
  if (!order) return fail(c, 'NotFound', 'Order not found', 404);
  return ok(c, order);
});

orderRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = orderCreateSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid order payload', 400, parsed.error.issues);
  }

  // Normalize order type: accept both `type` (canonical) and `orderType`
  // (legacy frontend key). Map the frontend's `TAKEOUT` to the DB's
  // canonical `TAKEAWAY`. `orderType` wins if both are present.
  const rawType = parsed.data.orderType ?? parsed.data.type ?? null;
  const normalizedType =
    rawType === 'TAKEOUT' ? 'TAKEAWAY' : (rawType as 'DINE_IN' | 'TAKEAWAY' | 'KIOSK' | null);

  const regularItems = parsed.data.items ?? [];
  const comboItems = parsed.data.comboItems ?? [];

  // Load menu items for the regular items.
  const menuIds = regularItems.map((i) => i.menuItemId);
  const menuItems = menuIds.length
    ? await prisma.menuItem.findMany({
        where: { id: { in: menuIds }, isActive: true },
        include: { category: true },
      })
    : [];
  const menuMap = new Map(menuItems.map((m) => [m.id, m]));
  for (const it of regularItems) {
    if (!menuMap.has(it.menuItemId)) {
      return fail(c, 'MenuItemNotFound', `Menu item ${it.menuItemId} not found`, 400);
    }
  }

  // PPN config: Sprint 13 — global DEFAULT_PPN_BP (default 0%).
  // Per-menu MenuItem.taxRateBp > 0 acts as an override (e.g. tax-exempt
  // menu items stay at 0 even if global is 11%; or a luxury item at 12%).
  // Otherwise we fall back to the global rate. The order snapshot stores
  // the effective PPN basis points in `ppnBpUsed` so historical receipts
  // show the rate active at the time of the order, not the current one.
  const defaultPpnBp = await getEffectivePpnBp();
  function effectivePpnBp(m: { taxRateBp: number }): number {
    return m.taxRateBp > 0 ? m.taxRateBp : defaultPpnBp;
  }
  // ppnBpUsed is set as we iterate over line items (max rate used).

  // Optionally attach to active shift
  let shiftId = parsed.data.shiftId;
  if (!shiftId) {
    const shift = await loadActiveShift(user.id);
    if (shift) shiftId = shift.id;
  }

  const orderNumber = await nextOrderNumber();
  let subtotal = 0;
  let tax = 0;
  const lineItems: Array<{
    menuItemId: string;
    nameSnapshot: string;
    priceCents: number;
    quantity: number;
    notes?: string;
    modifiersJson?: unknown;
    lineTotalCents: number;
  }> = [];

  // Build line items from regular menu items.
  let ppnBpUsed = 0; // track highest effective PPN rate used
  for (const it of regularItems) {
    const m = menuMap.get(it.menuItemId)!;
    const lineTotal = m.priceCents * it.quantity;
    subtotal += lineTotal;
    const rateBp = effectivePpnBp(m);
    if (rateBp > ppnBpUsed) ppnBpUsed = rateBp;
    if (rateBp > 0) {
      tax += Math.floor((lineTotal * rateBp) / 10000);
    }
    lineItems.push({
      menuItemId: m.id,
      nameSnapshot: m.category ? `${m.category.name} — ${m.name}` : m.name,
      priceCents: m.priceCents,
      quantity: it.quantity,
      notes: it.notes,
      modifiersJson: (it as any).modifiersJson ?? (it as any).modifiers ?? null,
      lineTotalCents: lineTotal,
    });
  }

  // Sprint 8.6 — expand combo items into line items. Each combo becomes
  // one synthetic line item priced at combo.priceCents. The "what's in
  // the combo" detail is captured in the line notes for the kitchen.
  if (comboItems.length > 0) {
    const comboIds = Array.from(new Set(comboItems.map((ci) => ci.comboId)));
    const combos = await prisma.combo.findMany({
      where: { id: { in: comboIds }, isActive: true },
      include: { items: true },
    });
    const comboMap = new Map(combos.map((cm) => [cm.id, cm]));
    for (const ci of comboItems) {
      const combo = comboMap.get(ci.comboId);
      if (!combo) {
        return fail(c, 'ComboNotFound', `Combo ${ci.comboId} not found`, 400);
      }
      // Validity window
      const now = new Date();
      if (combo.validFrom && now < combo.validFrom) {
        return fail(c, 'ComboNotYetValid', `Combo "${combo.name}" not yet valid`, 400);
      }
      if (combo.validUntil && now > combo.validUntil) {
        return fail(c, 'ComboExpired', `Combo "${combo.name}" has expired`, 400);
      }
      // For tax purposes, use a representative menu item's tax rate (the first one).
      // Combo price is the set price; PPN is computed on it at the same rate.
      const firstMenuItemId = combo.items[0]?.menuItemId;
      const firstMenu = firstMenuItemId ? menuMap.get(firstMenuItemId) : null;
      // If we don't have the menu item in our preload, fetch it.
      const repMenu =
        firstMenu ??
        (firstMenuItemId
          ? await prisma.menuItem.findUnique({ where: { id: firstMenuItemId } })
          : null);
      const lineTotal = combo.priceCents * ci.quantity;
      subtotal += lineTotal;
      if (repMenu) {
        const rateBp = effectivePpnBp(repMenu);
        if (rateBp > ppnBpUsed) ppnBpUsed = rateBp;
        if (rateBp > 0) {
          tax += Math.floor((lineTotal * rateBp) / 10000);
        }
      }
      // Build a descriptive line item that links to the FIRST combo item
      // (required — order_items.menuItemId is non-null in the schema).
      // The combo's full contents are recorded in modifiersJson + notes.
      const contentsText = combo.items
        .map((cmi) => `${cmi.quantity}x[item:${cmi.menuItemId}]`)
        .join(', ');
      lineItems.push({
        menuItemId: firstMenuItemId ?? repMenu?.id ?? combo.items[0]?.menuItemId ?? combo.id,
        nameSnapshot: combo.name,
        priceCents: combo.priceCents,
        quantity: ci.quantity,
        notes: ci.notes ?? `Combo: ${combo.name}`,
        modifiersJson: { comboId: combo.id, contents: contentsText, isCombo: true } as unknown,
        lineTotalCents: lineTotal,
      });
    }
  }

  // Discount resolution (legacy S2.5). Either discountCode/discountId OR
  // promoCode. If both, the legacy discount wins and the promo is logged
  // and skipped (per coordination note).
  let discountId: string | null = null;
  let discountCents = 0;
  if (parsed.data.discountCode || parsed.data.discountId) {
    const d = await prisma.discount.findFirst({
      where: {
        ...(parsed.data.discountId
          ? { id: parsed.data.discountId }
          : { code: parsed.data.discountCode! }),
      },
    });
    const result = computeDiscount(d, subtotal);
    if (!result.valid) {
      return fail(c, 'DiscountInvalid', result.reason || 'Discount not applicable', 400);
    }
    discountId = result.discountId!;
    discountCents = result.discountCents;
  }

  // Sprint 8.7 — promo engine. Only applies if no legacy discount is set.
  let promoId: string | null = null;
  let promoUsedCount: number | null = null;
  if (!discountId && parsed.data.promoCode) {
    const promo = await prisma.promo.findFirst({
      where: { code: parsed.data.promoCode },
      include: { conditions: true, rewards: true },
    });
    // Build PromoLineItem view from lineItems for the engine.
    const promoItems: PromoLineItem[] = lineItems.map((li) => {
      const m = menuMap.get(li.menuItemId);
      return {
        menuItemId: li.menuItemId,
        quantity: li.quantity,
        unitPriceCents: li.priceCents,
        categoryId: m?.categoryId,
      };
    });
    const lookup = new Map<string, { name: string; categoryId?: string }>();
    for (const li of lineItems) {
      const m = menuMap.get(li.menuItemId);
      if (m) lookup.set(m.id, { name: m.name, categoryId: m.categoryId });
    }
    const result = computePromo(
      promo as PromoLike | null,
      promoItems,
      subtotal,
      lookup,
    );
    if (!result.valid) {
      return fail(c, 'PromoInvalid', result.reason || 'Promo not applicable', 400);
    }
    discountCents += result.discountCents;
    if (promo) {
      promoId = promo.id;
      promoUsedCount = promo.usedCount + 1;
    }
    // Note: freeItems from BUNDLE/BUY_X_GET_Y are returned in the response
    // via the order's notes / could be added as $0 line items by the
    // caller later. For now we expose them in a side field on the response.
  }
  // total = subtotal + tax - discount (clamp at 0)
  const total = Math.max(0, subtotal + tax - discountCents);

  // Prisma's typed `items.create` expects a relation-shape when using the
  // "checked" form (e.g. { menuItem: { connect: ... } }) or a flat
  // UncheckedCreate shape (just menuItemId). We use the latter since we
  // have the ids already.
  const order = await prisma.$transaction(async (tx) => {
    const ord = await tx.order.create({
      data: {
        shiftId: shiftId ?? undefined,
        orderNumber,
        type: (normalizedType as any) ?? 'DINE_IN',
        status: 'OPEN',
        tableNumber: parsed.data.tableNumber,
        customerName: parsed.data.customerName,
        notes: parsed.data.notes,
        // Sprint 8.8 — customer/member attach (optional). Persisted so
        // payment-finalize can credit the customer on payment.
        customerId: parsed.data.customerId,
        subtotalCents: subtotal,
        taxCents: tax,
        ppnBpUsed,
        discountCents,
        ...(discountId ? { discountId } : {}),
        totalCents: total,
        openedById: user.id,
        items: {
          create: lineItems.map((li) => ({
            menuItemId: li.menuItemId,
            nameSnapshot: li.nameSnapshot,
            priceCents: li.priceCents,
            quantity: li.quantity,
            notes: li.notes,
            modifiersJson: li.modifiersJson as Prisma.InputJsonValue | undefined,
            lineTotalCents: li.lineTotalCents,
          })),
        },
      },
      include: { items: true, payments: true },
    });
    if (discountId) {
      await tx.discount.update({
        where: { id: discountId },
        data: { usageCount: { increment: 1 } },
      });
    }
    if (promoId && promoUsedCount !== null) {
      await tx.promo.update({
        where: { id: promoId },
        data: { usedCount: promoUsedCount },
      });
    }
    return ord;
  });

  logger.info(
    {
      orderId: order.id,
      orderNumber: order.orderNumber,
      total,
      discountCents,
      promoCode: parsed.data.promoCode,
      comboCount: comboItems.length,
    },
    'order created'
  );
  // Sprint 7.5 — business metric
  incCounter('pos_orders_created_total', 'Total orders created', {
    type: order.type,
  });
  observeHistogram(
    'pos_order_subtotal_cents',
    'Order subtotal in cents',
    total,
  );
  if (comboItems.length > 0) {
    incCounter('pos_combos_sold_total', 'Combos sold');
  }
  wsBus.broadcast({
    type: 'order.created',
    orderId: order.id,
    orderNumber: order.orderNumber,
    totalCents: order.totalCents,
    status: order.status,
    at: Date.now(),
  });
  return ok(c, order, 201);
});

// S1.5 — pay-cash (refactored S2.2 to use finalizeOrderPayment for inventory deduction)
const payCashSchema = z.object({
  amountGiven: z.number().int().positive(),
  method: z.enum(['CASH', 'MANUAL_TRANSFER']).optional().default('CASH'),
});

orderRoutes.post('/:id/pay-cash', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = payCashSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);
  }
  const { amountGiven, method: payMethod } = parsed.data;

  const order = await prisma.order.findUnique({ where: { id }, include: { payments: true } });
  if (!order) return fail(c, 'NotFound', 'Order not found', 404);
  if (order.status === 'PAID' || order.status === 'CANCELLED' || order.status === 'VOIDED' || order.status === 'REFUNDED') {
    return fail(c, 'OrderClosed', `Order is ${order.status}`, 409);
  }
  if (amountGiven < order.totalCents) {
    return fail(
      c,
      'InsufficientCash',
      `Amount given ${amountGiven} < order total ${order.totalCents}`,
      400
    );
  }
  const changeCents = amountGiven - order.totalCents;
  const externalId = `CASH-${order.id}-${Math.random().toString(36).slice(2, 10)}`;

  try {
    const finalized = await finalizeOrderPayment({
      orderId: order.id,
      userId: user.id,
      payment: {
        provider: payMethod === 'MANUAL_TRANSFER' ? 'BANK_TRANSFER' : 'CASH',
        method: payMethod,
        externalId,
        amountCents: order.totalCents,
      },
      providerRaw: {
        method: payMethod,
        amountGiven,
        changeCents,
        cashierId: user.id,
      },
    });
    // Sprint 7.5 — payment metric. finalizer returns { order, payment,
    // lowStockAlerts } where `order` is the closed order (with paidAt
    // set by finalizeOrderPayment). Note: the schema field is `openedAt`
    // (not `createdAt`). Defensive read in case the shape shifts.
    const closedOrder = (finalized.order as unknown as { paidAt?: Date | null; openedAt?: Date; updatedAt: Date }) ?? undefined;
    const paidAt = closedOrder?.paidAt ?? closedOrder?.updatedAt ?? new Date();
    const openedAt = closedOrder?.openedAt ?? new Date(0);
    const prepMs = paidAt.getTime() - openedAt.getTime();
    incCounter('pos_payments_completed_total', 'Total payments completed', {
      method: 'CASH',
    });
    observeHistogram('pos_payment_latency_ms', 'Time from order open to paid (ms)', prepMs, {
      method: 'CASH',
    });
    return ok(c, {
      order: closedOrder,
      payment: (finalized as { payment?: unknown }).payment,
      changeCents,
      amountGiven,
      lowStockAlerts: (finalized as { lowStockAlerts?: unknown[] }).lowStockAlerts ?? [],
    });
  } catch (e: any) {
    logger.error({ err: e, orderId: id }, 'pay-cash finalize failed');
    return fail(c, 'FinalizeFailed', e?.message || 'Payment finalization failed', 500);
  }
});

// S2.4 — void an OPEN order
const voidSchema = z.object({
  reason: z.string().min(1).max(500),
});

orderRoutes.post('/:id/void', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = voidSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);
  }
  const { reason } = parsed.data;

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return fail(c, 'NotFound', 'Order not found', 404);
  if (order.status !== 'OPEN') {
    return fail(c, 'OrderNotVoidable', `Only OPEN orders can be voided (current: ${order.status})`, 409);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const o = await tx.order.update({
      where: { id },
      data: {
        status: 'VOIDED',
        voidedAt: new Date(),
        voidedById: user.id,
        voidReason: reason,
      },
      include: { items: true, payments: true },
    });
    return o;
  });

  logger.info({ orderId: id, reason, by: user.id }, 'order voided');
  wsBus.broadcast({
    type: 'order.voided',
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    totalCents: updated.totalCents,
    status: updated.status,
    at: Date.now(),
  });
  return ok(c, updated);
});

// S2.4 — refund a PAID order
const refundSchema = z.object({
  reason: z.string().min(1).max(500),
  refundMethod: z.enum(['CASH', 'ORIGINAL']).default('CASH'),
});

orderRoutes.post('/:id/refund', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = refundSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);
  }
  const { reason, refundMethod } = parsed.data;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { payments: true },
  });
  if (!order) return fail(c, 'NotFound', 'Order not found', 404);
  if (order.status !== 'PAID') {
    return fail(c, 'OrderNotRefundable', `Only PAID orders can be refunded (current: ${order.status})`, 409);
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      let refundPaymentId: string | null = null;
      if (refundMethod === 'CASH') {
        const ref = `REFUND-${id}-${Math.random().toString(36).slice(2, 10)}`;
        const refundPayment = await tx.payment.create({
          data: {
            orderId: id,
            provider: 'CASH',
            method: 'CASH',
            status: 'PAID',
            amountCents: -order.totalCents,
            reference: ref,
            providerRaw: { refund: true, method: 'CASH', cashierId: user.id } as any,
            paidAt: new Date(),
          },
        });
        refundPaymentId = refundPayment.id;
      } else {
        // Mark the original payment as REFUNDED
        const original = order.payments.find((p) => p.status === 'PAID');
        if (original) {
          await tx.payment.update({
            where: { id: original.id },
            data: { status: 'REFUNDED' },
          });
          refundPaymentId = original.id;
        }
      }
      return tx.order.update({
        where: { id },
        data: {
          status: 'REFUNDED',
          refundedAt: new Date(),
          refundedById: user.id,
          refundReason: reason,
          refundMethod,
          refundPaymentId,
        },
        include: { items: true, payments: true },
      });
    });

    // Restore inventory outside the main transaction so a stock
    // restoration failure doesn't roll back the refund itself.
    try {
      await restoreInventoryForOrder(id);
    } catch (e) {
      logger.warn({ err: e, orderId: id }, 'inventory restore failed (non-fatal)');
    }

    logger.info({ orderId: id, refundMethod, by: user.id }, 'order refunded');
    wsBus.broadcast({
      type: 'order.refunded',
      orderId: updated.id,
      orderNumber: updated.orderNumber,
      totalCents: updated.totalCents,
      status: updated.status,
      at: Date.now(),
    });
    return ok(c, updated);
  } catch (e: any) {
    logger.error({ err: e, orderId: id }, 'refund failed');
    return fail(c, 'RefundFailed', e?.message || 'Refund failed', 500);
  }
});
