// apps/api/src/routes/tables.ts
//
// Sprint 9.3 — Waiter Handheld (Table Management).
//
// Endpoints (all require auth):
//   GET    /api/tables?branchId=X&status=AVAILABLE         — list tables + current session
//   GET    /api/tables/:id                                   — table detail + active session
//   POST   /api/tables                     (MANAGER+)        — create table
//   PATCH  /api/tables/:id                 (MANAGER+)        — update capacity/area/position/status
//   POST   /api/tables/:id/open            (CASHIER+)        — open a table session (+ optional order)
//   POST   /api/tables/:id/close           (CASHIER+)        — close the active session
//   POST   /api/tables/:id/transfer        (CASHIER+)        — move session to another table
//
// Table lifecycle:
//   AVAILABLE → OCCUPIED   on /open
//   OCCUPIED  → CLEANING   on /close (manager can reset back to AVAILABLE later)
//   any       → RESERVED   via PATCH (manager marks table as reserved for a booking)
//   CLEANING  → AVAILABLE  via PATCH
//
// Order linkage: when /open creates a session, it also creates an OPEN
// Order (type=DINE_IN) attached via orderId. The order is created with
// the supplied items (if any) or an empty order. Cashier can then add
// items via the existing /api/orders/:id/items-style flow (callers use
// the regular Order API after open returns the orderId).

import { Hono } from 'hono';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { incCounter } from '../middleware/metrics.js';
import { wsBus } from '../lib/ws-bus.js';

export const tableRoutes = new Hono<AppEnv>();

tableRoutes.use('*', requireAuth);

// ─── Schemas ───────────────────────────────────────────────────────────────

const tableCreate = z.object({
  branchId: z.string().min(1).max(50),
  number: z.string().min(1).max(20),
  capacity: z.number().int().min(1).max(99).optional(),
  area: z.string().max(50).optional(),
  positionX: z.number().int().min(0).max(100).optional(),
  positionY: z.number().int().min(0).max(100).optional(),
});

const tableUpdate = z.object({
  number: z.string().min(1).max(20).optional(),
  capacity: z.number().int().min(1).max(99).optional(),
  area: z.string().max(50).nullable().optional(),
  positionX: z.number().int().min(0).max(100).nullable().optional(),
  positionY: z.number().int().min(0).max(100).nullable().optional(),
  status: z.enum(['AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING']).optional(),
  isActive: z.boolean().optional(),
});

const tableOpen = z.object({
  partySize: z.number().int().min(1).max(50),
  serverUserId: z.string().min(1).max(50).optional(),
  // Optional: pre-populate the order with items. If omitted, an empty
  // OPEN order is created and items can be added later via /api/orders/:id.
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.number().int().positive().max(99),
        notes: z.string().max(200).optional(),
      }),
    )
    .optional(),
  customerName: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});

const tableTransfer = z.object({
  toTableId: z.string().min(1).max(50),
});

// ─── Helpers ───────────────────────────────────────────────────────────────

async function nextOrderNumber(branchId: string): Promise<string> {
  const today = new Date();
  const ymd =
    today.getFullYear().toString() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');
  const prefix = `ORD-${ymd}-`;
  const last = await prisma.order.findFirst({
    where: { branchId, orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: 'desc' },
  });
  let seq = 1;
  if (last) {
    const n = parseInt(last.orderNumber.slice(prefix.length), 10);
    if (!isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/** Find the OPEN session for a table (if any). */
async function getActiveSession(tableId: string) {
  return prisma.tableSession.findFirst({
    where: { tableId, status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
  });
}

// ─── List ──────────────────────────────────────────────────────────────────

tableRoutes.get('/', async (c) => {
  const user = c.get('user');
  const branchId = c.req.query('branchId') || user.branchId;
  if (!branchId) return fail(c, 'NoBranch', 'No branch context', 400);
  const status = c.req.query('status');
  const includeInactive = c.req.query('includeInactive') === 'true';

  const where: Record<string, unknown> = { branchId };
  if (status) where.status = status;
  if (!includeInactive) where.isActive = true;

  const tables = await prisma.table.findMany({
    where,
    orderBy: [{ area: 'asc' }, { number: 'asc' }],
    include: {
      sessions: {
        where: { status: 'OPEN' },
        orderBy: { openedAt: 'desc' },
        take: 1,
      },
    },
  });

  // Decorate with the current OPEN order (if any) for the active session
  const orderIds = tables
    .map((t) => t.sessions[0]?.orderId)
    .filter((v): v is string => !!v);
  const orders = orderIds.length
    ? await prisma.order.findMany({
        where: { id: { in: orderIds } },
        include: { items: true },
      })
    : [];
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  const data = tables.map((t) => {
    const session = t.sessions[0] ?? null;
    const order = session?.orderId ? orderMap.get(session.orderId) ?? null : null;
    return {
      ...t,
      currentSession: session,
      currentOrder: order,
    };
  });

  return ok(c, data);
});

// ─── Detail ────────────────────────────────────────────────────────────────

tableRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const table = await prisma.table.findUnique({
    where: { id },
    include: {
      sessions: {
        orderBy: { openedAt: 'desc' },
        take: 25,
      },
    },
  });
  if (!table) return fail(c, 'NotFound', 'Table not found', 404);

  const activeSession = table.sessions.find((s) => s.status === 'OPEN') ?? null;
  let order = null;
  if (activeSession?.orderId) {
    order = await prisma.order.findUnique({
      where: { id: activeSession.orderId },
      include: { items: true, payments: true },
    });
  }
  return ok(c, { ...table, currentSession: activeSession, currentOrder: order });
});

// ─── Create (MANAGER+) ─────────────────────────────────────────────────────

tableRoutes.post(
  '/',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = tableCreate.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid table payload', 400, parsed.error.issues);
    }
    const data = parsed.data;
    if (user.branchId && user.branchId !== data.branchId) {
      const hasAccess = (user.branchAccess ?? []).some((a) => a.branchId === data.branchId);
      if (!hasAccess) {
        return fail(c, 'NoAccess', `No access to branch ${data.branchId}`, 403);
      }
    }
    try {
      const table = await prisma.table.create({
        data: {
          branchId: data.branchId,
          number: data.number,
          capacity: data.capacity ?? 4,
          area: data.area,
          positionX: data.positionX,
          positionY: data.positionY,
        },
      });
      incCounter('pos_tables_created_total', 'Tables created', {
        branchId: data.branchId,
      });
      return ok(c, table, 201);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return fail(
          c,
          'DuplicateTable',
          `Meja "${data.number}" sudah ada di branch ini`,
          409,
        );
      }
      throw e;
    }
  },
);

// ─── Update (MANAGER+) ─────────────────────────────────────────────────────

tableRoutes.patch(
  '/:id',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const parsed = tableUpdate.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid update payload', 400, parsed.error.issues);
    }
    const existing = await prisma.table.findUnique({ where: { id } });
    if (!existing) return fail(c, 'NotFound', 'Table not found', 404);
    try {
      const updated = await prisma.table.update({ where: { id }, data: parsed.data });
      return ok(c, updated);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return fail(c, 'DuplicateTable', `Nomor meja sudah dipakai`, 409);
      }
      throw e;
    }
  },
);

// ─── Open (CASHIER+) ───────────────────────────────────────────────────────

tableRoutes.post(
  '/:id/open',
  requireRole('OWNER', 'MANAGER', 'CASHIER'),
  async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const parsed = tableOpen.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid open payload', 400, parsed.error.issues);
    }
    if (!user.branchId) return fail(c, 'NoBranch', 'User has no branch', 400);

    const table = await prisma.table.findUnique({ where: { id } });
    if (!table) return fail(c, 'NotFound', 'Table not found', 404);
    if (table.branchId !== user.branchId) {
      return fail(c, 'NoAccess', 'Table belongs to another branch', 403);
    }
    if (!table.isActive) {
      return fail(c, 'TableInactive', 'Meja tidak aktif', 409);
    }
    const active = await getActiveSession(id);
    if (active) {
      return fail(
        c,
        'TableAlreadyOpen',
        'Meja ini sudah punya sesi yang sedang berjalan',
        409,
        { sessionId: active.id, orderId: active.orderId },
      );
    }

    // Pre-load menu items if any are provided
    const items = parsed.data.items ?? [];
    const menuIds = items.map((i) => i.menuItemId);
    const menuItems = menuIds.length
      ? await prisma.menuItem.findMany({
          where: { id: { in: menuIds }, branchId: user.branchId, isActive: true },
        })
      : [];
    const menuMap = new Map(menuItems.map((m) => [m.id, m]));
    for (const it of items) {
      if (!menuMap.has(it.menuItemId)) {
        return fail(
          c,
          'MenuItemNotFound',
          `Menu item ${it.menuItemId} not in this branch`,
          400,
        );
      }
    }

    // Optionally attach to active shift
    const shift = await prisma.shift.findFirst({
      where: { userId: user.id, branchId: user.branchId, status: 'OPEN' },
    });

    const orderNumber = await nextOrderNumber(user.branchId);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create the OPEN Order
      const order = await tx.order.create({
        data: {
          branchId: user.branchId!,
          shiftId: shift?.id,
          orderNumber,
          type: 'DINE_IN',
          status: 'OPEN',
          tableNumber: table.number,
          customerName: parsed.data.customerName,
          notes: parsed.data.notes,
          openedById: user.id,
          items: {
            create: items.map((it) => {
              const m = menuMap.get(it.menuItemId)!;
              return {
                menuItemId: m.id,
                nameSnapshot: m.name,
                priceCents: m.priceCents,
                quantity: it.quantity,
                notes: it.notes,
                lineTotalCents: m.priceCents * it.quantity,
              };
            }),
          },
        },
        include: { items: true },
      });

      // 2. Recompute subtotal/tax from line items (no discount for now)
      let subtotal = 0;
      for (const li of order.items) subtotal += li.lineTotalCents;
      // Simple tax: 0 for now (orders will recompute at pay time)
      const orderUpdated = subtotal
        ? await tx.order.update({
            where: { id: order.id },
            data: { subtotalCents: subtotal, totalCents: subtotal },
            include: { items: true },
          })
        : order;

      // 3. Create the TableSession
      const session = await tx.tableSession.create({
        data: {
          tableId: table.id,
          orderId: orderUpdated.id,
          partySize: parsed.data.partySize,
          serverUserId: parsed.data.serverUserId ?? user.id,
          status: 'OPEN',
        },
      });

      // 4. Mark table OCCUPIED
      await tx.table.update({
        where: { id: table.id },
        data: { status: 'OCCUPIED' },
      });

      return { order: orderUpdated, session };
    });

    incCounter('pos_table_sessions_opened_total', 'Table sessions opened', {
      branchId: user.branchId ?? 'none',
    });
    logger.info(
      {
        tableId: table.id,
        tableNumber: table.number,
        sessionId: result.session.id,
        orderId: result.order.id,
        partySize: parsed.data.partySize,
      },
      'table session opened',
    );
    wsBus.broadcast(
      {
        type: 'table.opened',
        tableId: table.id,
        tableNumber: table.number,
        sessionId: result.session.id,
        orderId: result.order.id,
        branchId: user.branchId,
        at: Date.now(),
      },
      user.branchId,
    );

    return ok(c, { table, session: result.session, order: result.order }, 201);
  },
);

// ─── Close (CASHIER+) ──────────────────────────────────────────────────────

tableRoutes.post(
  '/:id/close',
  requireRole('OWNER', 'MANAGER', 'CASHIER'),
  async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const table = await prisma.table.findUnique({ where: { id } });
    if (!table) return fail(c, 'NotFound', 'Table not found', 404);
    if (table.branchId !== user.branchId) {
      return fail(c, 'NoAccess', 'Table belongs to another branch', 403);
    }

    const active = await getActiveSession(id);
    if (!active) {
      return fail(c, 'NoActiveSession', 'Tidak ada sesi yang sedang berjalan', 404);
    }

    // If the attached order is still OPEN, the session can still be closed
    // (e.g. table is closing early). Order lifecycle is independent — the
    // cashier can still take payment via /api/orders/:id/pay-cash.
    const updated = await prisma.$transaction(async (tx) => {
      const session = await tx.tableSession.update({
        where: { id: active.id },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      // Move table to CLEANING (so floor staff know to reset). Manager
      // can later PATCH status back to AVAILABLE.
      await tx.table.update({
        where: { id: table.id },
        data: { status: 'CLEANING' },
      });
      return session;
    });

    incCounter('pos_table_sessions_closed_total', 'Table sessions closed', {
      branchId: user.branchId ?? 'none',
    });
    logger.info(
      { tableId: table.id, sessionId: active.id },
      'table session closed',
    );
    wsBus.broadcast(
      {
        type: 'table.closed',
        tableId: table.id,
        tableNumber: table.number,
        sessionId: active.id,
        ...(user.branchId ? { branchId: user.branchId } : {}),
        at: Date.now(),
      },
      user.branchId,
    );

    return ok(c, { table: { ...table, status: 'CLEANING' }, session: updated });
  },
);

// ─── Transfer (CASHIER+) ───────────────────────────────────────────────────

tableRoutes.post(
  '/:id/transfer',
  requireRole('OWNER', 'MANAGER', 'CASHIER'),
  async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const parsed = tableTransfer.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid transfer payload', 400, parsed.error.issues);
    }
    if (!user.branchId) return fail(c, 'NoBranch', 'User has no branch', 400);

    const fromTable = await prisma.table.findUnique({ where: { id } });
    if (!fromTable) return fail(c, 'NotFound', 'Source table not found', 404);
    if (fromTable.branchId !== user.branchId) {
      return fail(c, 'NoAccess', 'Source table belongs to another branch', 403);
    }
    if (id === parsed.data.toTableId) {
      return fail(c, 'ValidationError', 'Source and destination tables are the same', 400);
    }
    const toTable = await prisma.table.findUnique({ where: { id: parsed.data.toTableId } });
    if (!toTable) return fail(c, 'NotFound', 'Destination table not found', 404);
    if (toTable.branchId !== user.branchId) {
      return fail(c, 'NoAccess', 'Destination table belongs to another branch', 403);
    }
    if (!toTable.isActive) {
      return fail(c, 'TableInactive', 'Meja tujuan tidak aktif', 409);
    }
    const destActive = await getActiveSession(toTable.id);
    if (destActive) {
      return fail(
        c,
        'DestinationOccupied',
        'Meja tujuan sudah punya sesi yang sedang berjalan',
        409,
      );
    }

    const active = await getActiveSession(fromTable.id);
    if (!active) {
      return fail(c, 'NoActiveSession', 'Tidak ada sesi yang sedang berjalan di meja asal', 404);
    }

    const result = await prisma.$transaction(async (tx) => {
      const session = await tx.tableSession.update({
        where: { id: active.id },
        data: { tableId: toTable.id },
      });
      // Update the order's tableNumber snapshot to the destination number
      if (active.orderId) {
        await tx.order.update({
          where: { id: active.orderId },
          data: { tableNumber: toTable.number },
        });
      }
      // Flip the table statuses
      await tx.table.update({
        where: { id: fromTable.id },
        data: { status: 'CLEANING' },
      });
      await tx.table.update({
        where: { id: toTable.id },
        data: { status: 'OCCUPIED' },
      });
      return session;
    });

    logger.info(
      {
        fromTableId: fromTable.id,
        toTableId: toTable.id,
        sessionId: active.id,
        by: user.id,
      },
      'table session transferred',
    );
    wsBus.broadcast(
      {
        type: 'table.transferred',
        fromTableId: fromTable.id,
        toTableId: toTable.id,
        fromNumber: fromTable.number,
        toNumber: toTable.number,
        sessionId: active.id,
        branchId: user.branchId,
        at: Date.now(),
      },
      user.branchId,
    );

    return ok(c, { session: result, fromTable, toTable });
  },
);
