// apps/api/src/routes/reservations.ts
//
// Sprint 9.2 — Table reservation routes.
//
// Endpoints (all require auth; CASHIER+ for create):
//   GET    /api/reservations?date=YYYY-MM-DD&status=BOOKED
//   GET    /api/reservations/availability?date=YYYY-MM-DD&partySize=N
//   GET    /api/reservations/:id
//   POST   /api/reservations                       (CASHIER+)
//   PATCH  /api/reservations/:id
//   POST   /api/reservations/:id/seat              — mark SEATED, optionally link to an OPEN Order
//   POST   /api/reservations/:id/cancel            — body { reason }
//   POST   /api/reservations/:id/no-show           — mark NO_SHOW
//
// Availability: 30-min slots from 09:00 to 22:00 (local Jakarta). A slot
// is "free" when no existing BOOKED/SEATED reservation overlaps with
// the requested time window.

import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { incCounter } from '../middleware/metrics.js';

export const reservationRoutes = new Hono<AppEnv>();

reservationRoutes.use('*', requireAuth);

// ─── Constants ─────────────────────────────────────────────────────────────

const SLOT_MINUTES = 30;
const DAY_START_HOUR = 9; // 09:00 local
const DAY_END_HOUR = 22; // 22:00 local (last slot starts at 21:30)
const TZ = 'Asia/Jakarta';

// ─── Schemas ───────────────────────────────────────────────────────────────

const reservationCreate = z.object({
  customerName: z.string().min(1).max(100),
  customerPhone: z.string().min(3).max(30),
  partySize: z.number().int().min(1).max(50),
  // ISO-8601 timestamp (e.g. 2026-06-20T19:00:00+07:00)
  reservedAt: z.string().min(1).max(40),
  durationMinutes: z.number().int().min(15).max(360).optional(),
  tableNumber: z.string().max(20).optional(),
  notes: z.string().max(500).optional(),
  customerId: z.string().min(1).max(50).optional(),
});

const reservationUpdate = z.object({
  customerName: z.string().min(1).max(100).optional(),
  customerPhone: z.string().min(3).max(30).optional(),
  partySize: z.number().int().min(1).max(50).optional(),
  reservedAt: z.string().min(1).max(40).optional(),
  durationMinutes: z.number().int().min(15).max(360).optional(),
  tableNumber: z.string().max(20).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

const seatSchema = z.object({
  tableNumber: z.string().max(20).optional(),
  orderId: z.string().min(1).max(50).optional(),
});

const cancelSchema = z.object({
  reason: z.string().min(1).max(300),
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseReservedAt(input: string): Date {
  const d = new Date(input);
  if (isNaN(d.getTime())) {
    throw new Error('reservedAt must be a valid ISO date string');
  }
  return d;
}

function dayBounds(dateStr: string): { start: Date; end: Date } | null {
  // dateStr: YYYY-MM-DD. Interpret in Asia/Jakarta local.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const [, y, mo, d] = m;
  const start = new Date(`${y}-${mo}-${d}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

interface BusyWindow {
  start: Date;
  end: Date;
}

/**
 * Compute the free 30-min slots in [DAY_START_HOUR, DAY_END_HOUR) for a
 * given date, given the list of busy windows (from existing reservations)
 * and the requested party size + duration.
 */
function computeAvailableSlots(
  date: string,
  busy: BusyWindow[],
  durationMinutes: number,
): string[] {
  const bounds = dayBounds(date);
  if (!bounds) return [];
  const slots: string[] = [];
  for (let h = DAY_START_HOUR; h < DAY_END_HOUR; h++) {
    for (let mm = 0; mm < 60; mm += SLOT_MINUTES) {
      const hh = String(h).padStart(2, '0');
      const mms = String(mm).padStart(2, '0');
      const slotStart = new Date(`${date}T${hh}:${mms}:00+07:00`);
      const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);
      // Skip slots that would run past closing
      if (slotEnd.getHours() + slotEnd.getMinutes() / 60 > DAY_END_HOUR) continue;
      // Skip slots in the past
      if (slotStart.getTime() < Date.now()) continue;
      // Check overlap with any busy window
      const overlaps = busy.some((b) => slotStart < b.end && slotEnd > b.start);
      if (!overlaps) {
        slots.push(`${hh}:${mms}`);
      }
    }
  }
  return slots;
}

// ─── List + get ────────────────────────────────────────────────────────────

reservationRoutes.get('/', async (c) => {
  const date = c.req.query('date');
  const status = c.req.query('status');

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (date) {
    const bounds = dayBounds(date);
    if (!bounds) return fail(c, 'ValidationError', 'date harus YYYY-MM-DD', 400);
    where.reservedAt = { gte: bounds.start, lt: bounds.end };
  }

  const reservations = await prisma.reservation.findMany({
    where,
    orderBy: { reservedAt: 'asc' },
    take: 200,
  });
  return ok(c, reservations);
});

// Availability MUST be declared before the /:id dynamic route so the
// static path doesn't get shadowed.
reservationRoutes.get('/availability', async (c) => {
  const date = c.req.query('date');
  const partySizeStr = c.req.query('partySize');
  if (!date) return fail(c, 'ValidationError', 'date wajib diisi (YYYY-MM-DD)', 400);
  const partySize = partySizeStr ? parseInt(partySizeStr, 10) : 1;
  if (isNaN(partySize) || partySize < 1) {
    return fail(c, 'ValidationError', 'partySize tidak valid', 400);
  }

  const bounds = dayBounds(date);
  if (!bounds) return fail(c, 'ValidationError', 'date harus YYYY-MM-DD', 400);

  // Load every active (BOOKED / SEATED) reservation for the day.
  const active = await prisma.reservation.findMany({
    where: {
      reservedAt: { gte: bounds.start, lt: bounds.end },
      status: { in: ['BOOKED', 'SEATED'] },
    },
    select: { reservedAt: true, durationMinutes: true },
  });
  const busy: BusyWindow[] = active.map((r) => ({
    start: r.reservedAt,
    end: new Date(r.reservedAt.getTime() + r.durationMinutes * 60_000),
  }));
  const slots = computeAvailableSlots(date, busy, 90); // assume 90-min duration for the slot list
  return ok(c, {
    date,
    partySize,
    slotMinutes: SLOT_MINUTES,
    durationMinutes: 90,
    slots,
  });
});

reservationRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const r = await prisma.reservation.findUnique({ where: { id } });
  if (!r) return fail(c, 'NotFound', 'Reservation not found', 404);
  return ok(c, r);
});

// ─── Create (CASHIER+) ────────────────────────────────────────────────────

reservationRoutes.post(
  '/',
  requireRole('OWNER', 'MANAGER', 'CASHIER'),
  async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = reservationCreate.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid reservation payload', 400, parsed.error.issues);
    }
    const data = parsed.data;

    let reservedAt: Date;
    try {
      reservedAt = parseReservedAt(data.reservedAt);
    } catch (e) {
      return fail(c, 'ValidationError', (e as Error).message, 400);
    }

    const reservation = await prisma.reservation.create({
      data: {
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        partySize: data.partySize,
        reservedAt,
        durationMinutes: data.durationMinutes ?? 90,
        tableNumber: data.tableNumber,
        notes: data.notes,
        customerId: data.customerId,
        createdById: user.id,
        status: 'BOOKED',
      },
    });
    incCounter('pos_reservations_created_total', 'Reservations created');
    logger.info(
      { reservationId: reservation.id, partySize: data.partySize },
      'reservation created',
    );
    return ok(c, reservation, 201);
  },
);

// ─── Update ───────────────────────────────────────────────────────────────

reservationRoutes.patch(
  '/:id',
  requireRole('OWNER', 'MANAGER', 'CASHIER'),
  async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const parsed = reservationUpdate.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid update payload', 400, parsed.error.issues);
    }
    const existing = await prisma.reservation.findUnique({ where: { id } });
    if (!existing) return fail(c, 'NotFound', 'Reservation not found', 404);
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      return fail(
        c,
        'ReservationClosed',
        `Reservation is ${existing.status} — cannot edit`,
        409,
      );
    }

    const data: Record<string, unknown> = { ...parsed.data };
    if (typeof data.reservedAt === 'string') {
      try {
        data.reservedAt = parseReservedAt(data.reservedAt);
      } catch (e) {
        return fail(c, 'ValidationError', (e as Error).message, 400);
      }
    }
    const updated = await prisma.reservation.update({ where: { id }, data: data as any });
    return ok(c, updated);
  },
);

// ─── Seat ─────────────────────────────────────────────────────────────────

reservationRoutes.post(
  '/:id/seat',
  requireRole('OWNER', 'MANAGER', 'CASHIER'),
  async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const parsed = seatSchema.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid seat payload', 400, parsed.error.issues);
    }
    const existing = await prisma.reservation.findUnique({ where: { id } });
    if (!existing) return fail(c, 'NotFound', 'Reservation not found', 404);
    if (existing.status !== 'BOOKED') {
      return fail(
        c,
        'InvalidStatus',
        `Hanya reservasi BOOKED yang bisa di-seat (saat ini: ${existing.status})`,
        409,
      );
    }
    // If orderId is provided, verify it exists and is OPEN
    if (parsed.data.orderId) {
      const order = await prisma.order.findUnique({ where: { id: parsed.data.orderId } });
      if (!order) return fail(c, 'NotFound', 'Order not found', 404);
      if (order.status === 'PAID' || order.status === 'VOIDED' || order.status === 'CANCELLED') {
        return fail(c, 'OrderClosed', `Order is ${order.status}`, 409);
      }
    }
    const updated = await prisma.reservation.update({
      where: { id },
      data: {
        status: 'SEATED',
        tableNumber: parsed.data.tableNumber ?? existing.tableNumber,
        orderId: parsed.data.orderId ?? existing.orderId,
      },
    });
    incCounter('pos_reservations_seated_total', 'Reservations seated');
    return ok(c, updated);
  },
);

// ─── Cancel ───────────────────────────────────────────────────────────────

reservationRoutes.post(
  '/:id/cancel',
  requireRole('OWNER', 'MANAGER', 'CASHIER'),
  async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const parsed = cancelSchema.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'reason wajib diisi', 400, parsed.error.issues);
    }
    const existing = await prisma.reservation.findUnique({ where: { id } });
    if (!existing) return fail(c, 'NotFound', 'Reservation not found', 404);
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED' || existing.status === 'NO_SHOW') {
      return fail(
        c,
        'InvalidStatus',
        `Reservation is ${existing.status} — cannot cancel`,
        409,
      );
    }
    const updated = await prisma.reservation.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        notes: existing.notes
          ? `${existing.notes}\n[CANCELLED] ${parsed.data.reason}`
          : `[CANCELLED] ${parsed.data.reason}`,
      },
    });
    return ok(c, updated);
  },
);

// ─── No-show ──────────────────────────────────────────────────────────────

reservationRoutes.post(
  '/:id/no-show',
  requireRole('OWNER', 'MANAGER', 'CASHIER'),
  async (c) => {
    const id = c.req.param('id');
    const existing = await prisma.reservation.findUnique({ where: { id } });
    if (!existing) return fail(c, 'NotFound', 'Reservation not found', 404);
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED' || existing.status === 'NO_SHOW') {
      return fail(
        c,
        'InvalidStatus',
        `Reservation is ${existing.status} — cannot mark as no-show`,
        409,
      );
    }
    const updated = await prisma.reservation.update({
      where: { id },
      data: { status: 'NO_SHOW' },
    });
    return ok(c, updated);
  },
);
