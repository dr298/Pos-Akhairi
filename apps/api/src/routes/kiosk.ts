// apps/api/src/routes/kiosk.ts
//
// Sprint 9.1 — Self-Order Kiosk routes.
//
// A kiosk is a fullscreen, simplified POS UI for self-ordering. It has NO
// auth, NO shift, NO payment — the customer builds a cart, hits "Bayar di
// Kasir", the cart is converted to a real Order with type=KIOSK and
// status=OPEN, and the cashier scans the QR / types the order number to
// claim & pay.
//
// Endpoints (all PUBLIC, no auth):
//   GET    /api/kiosk/menu                      — list active menu
//   POST   /api/kiosk/cart                     — start a new session, returns sessionId + cart
//   GET    /api/kiosk/cart/:sessionId          — read current cart
//   POST   /api/kiosk/cart/:sessionId/items    — add/update an item
//   DELETE /api/kiosk/cart/:sessionId/items/:itemId — remove an item
//   POST   /api/kiosk/cart/:sessionId/checkout — convert cart to Order (type=KIOSK, status=OPEN)
//   GET    /api/kiosk/order/:kioskOrderId      — poll order status (for the status tracker page)
//
// All routes are rate-limited (300 req/min/IP) by the global middleware in
// apps/api/src/index.ts. The kiosk pages are public, so we do NOT mount
// requireAuth on this router.

import { Hono } from 'hono';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { prisma } from '@pos/db';
import { logger } from '../logger.js';
import { ok, fail } from '../middleware/auth.js';
import { wsBus } from '../lib/ws-bus.js';
import { incCounter } from '../middleware/metrics.js';

export const kioskRoutes = new Hono();

// ─── Cart item shape stored in KioskSession.itemsJson ──────────────────────

export interface KioskCartItem {
  /** Local id (stable for the lifetime of the cart, used for delete) */
  id: string;
  menuItemId: string;
  name: string;
  priceCents: number;
  quantity: number;
  notes?: string;
  lineTotalCents: number;
}

interface KioskCart {
  items: KioskCartItem[];
}

function emptyCart(): KioskCart {
  return { items: [] };
}

function readCart(raw: unknown): KioskCart {
  if (!raw || typeof raw !== 'object') return emptyCart();
  const obj = raw as { items?: unknown };
  if (!Array.isArray(obj.items)) return emptyCart();
  const items: KioskCartItem[] = [];
  for (const it of obj.items) {
    if (!it || typeof it !== 'object') continue;
    const x = it as Partial<KioskCartItem>;
    if (
      typeof x.id !== 'string' ||
      typeof x.menuItemId !== 'string' ||
      typeof x.name !== 'string' ||
      typeof x.priceCents !== 'number' ||
      typeof x.quantity !== 'number'
    ) {
      continue;
    }
    items.push({
      id: x.id,
      menuItemId: x.menuItemId,
      name: x.name,
      priceCents: x.priceCents,
      quantity: x.quantity,
      notes: typeof x.notes === 'string' ? x.notes : undefined,
      lineTotalCents: typeof x.lineTotalCents === 'number' ? x.lineTotalCents : x.priceCents * x.quantity,
    });
  }
  return { items };
}

function cartSubtotalCents(cart: KioskCart): number {
  return cart.items.reduce((s, it) => s + it.lineTotalCents, 0);
}

function genId(): string {
  return randomBytes(8).toString('hex');
}

function newSessionId(): string {
  // Short, URL-safe token. cuids are too long for the kiosk QR — we want
  // something a cashier can type in 5 seconds.
  return 'k_' + randomBytes(10).toString('base64url');
}

const SESSION_TTL_MINUTES = 30;

// ─── Validation schemas ────────────────────────────────────────────────────

const itemSchema = z.object({
  menuItemId: z.string().min(1).max(50),
  quantity: z.number().int().positive().max(99),
  notes: z.string().max(200).optional(),
});

const cartCreateSchema = z.object({
  // Optional: seed the cart with items in one shot. The cashier usually
  // creates the session empty, but we support a body for parity with the
  // documented API.
  items: z.array(itemSchema).max(50).optional(),
});

const cartAddItemSchema = z.object({
  menuItemId: z.string().min(1).max(50),
  quantity: z.number().int().positive().max(99),
  notes: z.string().max(200).optional(),
});

// ─── 1. GET /api/kiosk/menu ─────────────────────────────────────────────────

kioskRoutes.get('/menu', async (c) => {
  // Menu is global now (single restaurant, no branches).
  const categories = await prisma.menuCategory.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      sortOrder: true,
      items: {
        where: { isActive: true, isAvailable: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          priceCents: true,
          imageUrl: true,
          categoryId: true,
        },
      },
    },
  });
  // Strip empty categories so the kiosk doesn't show tabs with no items.
  const filtered = categories.filter((cat) => cat.items.length > 0);
  return ok(c, { categories: filtered });
});

// ─── 2. POST /api/kiosk/cart ────────────────────────────────────────────────

kioskRoutes.post('/cart', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = cartCreateSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid cart payload', 400, parsed.error.issues);
  }
  const { items: seedItems = [] } = parsed.data;

  let cart: KioskCart = emptyCart();
  if (seedItems.length > 0) {
    const menuIds = Array.from(new Set(seedItems.map((i) => i.menuItemId)));
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: menuIds }, isActive: true, isAvailable: true },
      select: { id: true, name: true, priceCents: true },
    });
    const menuMap = new Map(menuItems.map((m) => [m.id, m]));
    for (const it of seedItems) {
      const m = menuMap.get(it.menuItemId);
      if (!m) {
        return fail(c, 'MenuItemNotFound', `Menu item ${it.menuItemId} tidak tersedia`, 400);
      }
      cart.items.push({
        id: genId(),
        menuItemId: m.id,
        name: m.name,
        priceCents: m.priceCents,
        quantity: it.quantity,
        notes: it.notes,
        lineTotalCents: m.priceCents * it.quantity,
      });
    }
  }

  const sessionId = newSessionId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MINUTES * 60_000);
  await prisma.kioskSession.create({
    data: {
      id: sessionId,
      itemsJson: cart as unknown as Prisma.InputJsonValue,
      status: 'ACTIVE',
      lastActivityAt: now,
      expiresAt,
    },
  });
  incCounter('pos_kiosk_sessions_created_total', 'Kiosk sessions created');
  return ok(
    c,
    {
      sessionId,
      cart,
      subtotalCents: cartSubtotalCents(cart),
      expiresAt: expiresAt.toISOString(),
      ttlMinutes: SESSION_TTL_MINUTES,
    },
    201,
  );
});

// ─── 3. GET /api/kiosk/cart/:sessionId ─────────────────────────────────────

kioskRoutes.get('/cart/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const session = await prisma.kioskSession.findUnique({ where: { id: sessionId } });
  if (!session) return fail(c, 'NotFound', 'Sesi kiosk tidak ditemukan', 404);
  if (session.status !== 'ACTIVE') {
    return fail(c, 'SessionClosed', `Sesi kiosk sudah ${session.status.toLowerCase()}`, 409);
  }
  if (session.expiresAt < new Date()) {
    // Mark abandoned (best-effort)
    await prisma.kioskSession
      .update({ where: { id: sessionId }, data: { status: 'ABANDONED' } })
      .catch(() => undefined);
    return c.json({ error: 'SessionExpired', message: 'Sesi kiosk sudah kedaluwarsa' }, 410);
  }
  const cart = readCart(session.itemsJson);
  return ok(c, {
    sessionId,
    cart,
    subtotalCents: cartSubtotalCents(cart),
    expiresAt: session.expiresAt.toISOString(),
  });
});

// ─── 4. POST /api/kiosk/cart/:sessionId/items ───────────────────────────────

kioskRoutes.post('/cart/:sessionId/items', async (c) => {
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json().catch(() => ({}));
  const parsed = cartAddItemSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid item payload', 400, parsed.error.issues);
  }
  const { menuItemId, quantity, notes } = parsed.data;

  const session = await prisma.kioskSession.findUnique({ where: { id: sessionId } });
  if (!session) return fail(c, 'NotFound', 'Sesi kiosk tidak ditemukan', 404);
  if (session.status !== 'ACTIVE') {
    return fail(c, 'SessionClosed', `Sesi kiosk sudah ${session.status.toLowerCase()}`, 409);
  }
  if (session.expiresAt < new Date()) {
    return c.json({ error: 'SessionExpired', message: 'Sesi kiosk sudah kedaluwarsa' }, 410);
  }

  const menu = await prisma.menuItem.findFirst({
    where: { id: menuItemId, isActive: true, isAvailable: true },
    select: { id: true, name: true, priceCents: true },
  });
  if (!menu) {
    return fail(c, 'MenuItemNotFound', 'Menu item tidak tersedia', 404);
  }

  const cart = readCart(session.itemsJson);
  // Merge with any existing line of the same menuItemId + identical notes
  // (the kiosk adds by tapping a tile, so notes are usually absent).
  const noteKey = (notes ?? '').trim();
  const existing = cart.items.find(
    (it) => it.menuItemId === menu.id && (it.notes ?? '').trim() === noteKey,
  );
  if (existing) {
    existing.quantity += quantity;
    existing.lineTotalCents = existing.priceCents * existing.quantity;
  } else {
    cart.items.push({
      id: genId(),
      menuItemId: menu.id,
      name: menu.name,
      priceCents: menu.priceCents,
      quantity,
      notes: notes ?? undefined,
      lineTotalCents: menu.priceCents * quantity,
    });
  }
  await prisma.kioskSession.update({
    where: { id: sessionId },
    data: {
      itemsJson: cart as unknown as Prisma.InputJsonValue,
      lastActivityAt: new Date(),
    },
  });
  return ok(c, {
    sessionId,
    cart,
    subtotalCents: cartSubtotalCents(cart),
  });
});

// ─── 5. DELETE /api/kiosk/cart/:sessionId/items/:itemId ────────────────────

kioskRoutes.delete('/cart/:sessionId/items/:itemId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const itemId = c.req.param('itemId');
  const session = await prisma.kioskSession.findUnique({ where: { id: sessionId } });
  if (!session) return fail(c, 'NotFound', 'Sesi kiosk tidak ditemukan', 404);
  if (session.status !== 'ACTIVE') {
    return fail(c, 'SessionClosed', `Sesi kiosk sudah ${session.status.toLowerCase()}`, 409);
  }
  const cart = readCart(session.itemsJson);
  const before = cart.items.length;
  cart.items = cart.items.filter((it) => it.id !== itemId);
  if (cart.items.length === before) {
    return fail(c, 'NotFound', 'Item tidak ditemukan di keranjang', 404);
  }
  await prisma.kioskSession.update({
    where: { id: sessionId },
    data: {
      itemsJson: cart as unknown as Prisma.InputJsonValue,
      lastActivityAt: new Date(),
    },
  });
  return ok(c, {
    sessionId,
    cart,
    subtotalCents: cartSubtotalCents(cart),
  });
});

// ─── 6. POST /api/kiosk/cart/:sessionId/checkout ───────────────────────────

async function nextKioskOrderNumber(): Promise<string> {
  // Use a distinct prefix so the cashier can spot kiosk orders at a glance.
  const today = new Date();
  const ymd =
    today.getFullYear().toString() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');
  const prefix = `K-${ymd}-`;
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

kioskRoutes.post('/cart/:sessionId/checkout', async (c) => {
  const sessionId = c.req.param('sessionId');
  const session = await prisma.kioskSession.findUnique({ where: { id: sessionId } });
  if (!session) return fail(c, 'NotFound', 'Sesi kiosk tidak ditemukan', 404);
  if (session.status !== 'ACTIVE') {
    return fail(c, 'SessionClosed', `Sesi kiosk sudah ${session.status.toLowerCase()}`, 409);
  }
  if (session.expiresAt < new Date()) {
    return c.json({ error: 'SessionExpired', message: 'Sesi kiosk sudah kedaluwarsa' }, 410);
  }

  const cart = readCart(session.itemsJson);
  if (cart.items.length === 0) {
    return fail(c, 'EmptyCart', 'Keranjang kosong — tambahkan item terlebih dahulu', 400);
  }

  // Re-validate every item against the current menu. A menu change since
  // the cart was built must not propagate as a phantom line.
  const menuIds = Array.from(new Set(cart.items.map((it) => it.menuItemId)));
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: menuIds }, isActive: true, isAvailable: true },
  });
  const menuMap = new Map(menuItems.map((m) => [m.id, m]));
  for (const it of cart.items) {
    if (!menuMap.has(it.menuItemId)) {
      return fail(
        c,
        'MenuItemUnavailable',
        `"${it.name}" sudah tidak tersedia. Hapus dari keranjang lalu coba lagi.`,
        409,
      );
    }
  }

  // PPN is per-item (MenuItem.taxRateBp). No more "branch default" PPN.
  function effectivePpnBp(m: { taxRateBp: number }): number {
    return m.taxRateBp > 0 ? m.taxRateBp : 0;
  }

  const orderNumber = await nextKioskOrderNumber();
  let subtotal = 0;
  let tax = 0;
  const lineItems: Array<{
    menuItemId: string;
    nameSnapshot: string;
    priceCents: number;
    quantity: number;
    notes?: string;
    lineTotalCents: number;
  }> = [];
  for (const it of cart.items) {
    const m = menuMap.get(it.menuItemId)!;
    const lineTotal = m.priceCents * it.quantity;
    subtotal += lineTotal;
    const rateBp = effectivePpnBp(m);
    if (rateBp > 0) {
      tax += Math.floor((lineTotal * rateBp) / 10000);
    }
    lineItems.push({
      menuItemId: m.id,
      nameSnapshot: m.name,
      priceCents: m.priceCents,
      quantity: it.quantity,
      notes: it.notes,
      lineTotalCents: lineTotal,
    });
  }
  const total = Math.max(0, subtotal + tax);

  // We need a real user to "open" the order. The kiosk has no user, so we
  // fall back to the first OWNER/MANAGER of the system.
  const opener = await prisma.user.findFirst({
    where: {
      isActive: true,
      role: { in: ['OWNER', 'MANAGER'] },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!opener) {
    logger.error('kiosk checkout: no opener user');
    return fail(
      c,
      'ConfigError',
      'Belum ada OWNER/MANAGER di sistem. Hubungi atasan.',
      500,
    );
  }

  const order = await prisma.$transaction(async (tx) => {
    const ord = await tx.order.create({
      data: {
        orderNumber,
        type: 'KIOSK',
        status: 'OPEN',
        // No shift — kiosk orders float until the cashier claims them.
        notes: `Self-order kiosk (session ${sessionId})`,
        subtotalCents: subtotal,
        taxCents: tax,
        discountCents: 0,
        totalCents: total,
        openedById: opener.id,
        items: {
          create: lineItems.map((li) => ({
            menuItemId: li.menuItemId,
            nameSnapshot: li.nameSnapshot,
            priceCents: li.priceCents,
            quantity: li.quantity,
            notes: li.notes,
            lineTotalCents: li.lineTotalCents,
          })),
        },
      },
      include: { items: true },
    });
    await tx.kioskSession.update({
      where: { id: sessionId },
      data: {
        status: 'CHECKED_OUT',
        createdOrderId: ord.id,
        lastActivityAt: new Date(),
      },
    });
    return ord;
  });

  incCounter('pos_kiosk_orders_total', 'Kiosk orders created');
  incCounter('pos_orders_created_total', 'Total orders created', {
    type: 'KIOSK',
  });
  wsBus.broadcast({
    type: 'order.created',
    orderId: order.id,
    orderNumber: order.orderNumber,
    totalCents: order.totalCents,
    status: order.status,
    at: Date.now(),
  });

  return ok(c, {
    orderId: order.id,
    orderNumber: order.orderNumber,
    totalCents: order.totalCents,
    subtotalCents: order.subtotalCents,
    taxCents: order.taxCents,
    status: order.status,
    items: order.items.map((it) => ({
      id: it.id,
      name: it.nameSnapshot,
      quantity: it.quantity,
      lineTotalCents: it.lineTotalCents,
    })),
  });
});

// ─── 7. GET /api/kiosk/order/:kioskOrderId ─────────────────────────────────

kioskRoutes.get('/order/:kioskOrderId', async (c) => {
  const orderId = c.req.param('kioskOrderId');
  // Look up by id OR by orderNumber (so the cashier can type a number
  // into the kiosk page and the kiosk polls by that).
  const order = await prisma.order.findFirst({
    where: {
      type: 'KIOSK',
      OR: [{ id: orderId }, { orderNumber: orderId }],
    },
    select: {
      id: true,
      orderNumber: true,
      type: true,
      status: true,
      subtotalCents: true,
      taxCents: true,
      totalCents: true,
      openedAt: true,
      closedAt: true,
      items: {
        select: { id: true, nameSnapshot: true, quantity: true, lineTotalCents: true },
      },
    },
  });
  if (!order) {
    return fail(c, 'NotFound', 'Order kiosk tidak ditemukan', 404);
  }
  return ok(c, order);
});
