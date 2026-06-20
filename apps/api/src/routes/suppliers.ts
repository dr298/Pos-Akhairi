// apps/api/src/routes/suppliers.ts
//
// Sprint 9.5 — Supplier CRUD. Branch-scoped. Suppliers feed the PO module
// (purchase-orders route), so management of the list is the foundation.
//
// Endpoints (all require auth):
//   GET    /api/suppliers?branchId=X&includeInactive=true
//   POST   /api/suppliers             (OWNER, MANAGER)
//   PATCH  /api/suppliers/:id         (OWNER, MANAGER)
//
// Design notes:
//   - Soft-delete via isActive. We never hard-delete because PurchaseOrder
//     rows reference the supplier (no CASCADE on Supplier).
//   - No DELETE endpoint — flip isActive=false instead, so historical POs
//     keep the supplier name on receipts / reports.

import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { incCounter } from '../middleware/metrics.js';

export const supplierRoutes = new Hono<AppEnv>();

supplierRoutes.use('*', requireAuth);

// ─── Helpers ───────────────────────────────────────────────────────────────

function userHasBranchAccess(
  branchAccess: Array<{ branchId: string }>,
  branchId: string,
): boolean {
  return branchAccess.some((b) => b.branchId === branchId);
}

// ─── Schemas ───────────────────────────────────────────────────────────────

const createSchema = z.object({
  branchId: z.string().min(1).max(50),
  name: z.string().min(1).max(120),
  contactName: z.string().max(120).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().max(160).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  contactName: z.string().max(120).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().max(160).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

// ─── List ──────────────────────────────────────────────────────────────────

supplierRoutes.get('/', async (c) => {
  const user = c.get('user');
  const branchId = c.req.query('branchId') || user.branchId;
  if (!branchId) return fail(c, 'NoBranch', 'No branch context', 400);
  if (!userHasBranchAccess(user.branchAccess, branchId)) {
    return fail(c, 'NoAccess', `No access to branch ${branchId}`, 403);
  }
  const includeInactive = c.req.query('includeInactive') === 'true';
  const search = c.req.query('search')?.trim();

  const suppliers = await prisma.supplier.findMany({
    where: {
      branchId,
      ...(includeInactive ? {} : { isActive: true }),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { contactName: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
  return ok(c, { suppliers });
});

// ─── Create ────────────────────────────────────────────────────────────────

supplierRoutes.post(
  '/',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid supplier payload', 400, parsed.error.issues);
    }
    const input = parsed.data;
    if (!userHasBranchAccess(user.branchAccess, input.branchId)) {
      return fail(c, 'NoAccess', `No access to branch ${input.branchId}`, 403);
    }
    const supplier = await prisma.supplier.create({
      data: {
        branchId: input.branchId,
        name: input.name,
        contactName: input.contactName ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        isActive: input.isActive ?? true,
      },
    });
    incCounter('pos_suppliers_created_total', 'Suppliers created', {
      branchId: input.branchId,
    });
    logger.info({ supplierId: supplier.id, branchId: input.branchId }, 'supplier created');
    return ok(c, { supplier }, 201);
  },
);

// ─── Update ────────────────────────────────────────────────────────────────

supplierRoutes.patch(
  '/:id',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid supplier payload', 400, parsed.error.issues);
    }
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) return fail(c, 'NotFound', 'Supplier not found', 404);
    if (!userHasBranchAccess(user.branchAccess, existing.branchId)) {
      return fail(c, 'NoAccess', 'No access to this supplier', 403);
    }
    // Prisma can't write undefined to optional fields — build the data
    // object with only the keys that are actually present.
    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.contactName !== undefined) data.contactName = parsed.data.contactName;
    if (parsed.data.phone !== undefined) data.phone = parsed.data.phone;
    if (parsed.data.email !== undefined) data.email = parsed.data.email;
    if (parsed.data.address !== undefined) data.address = parsed.data.address;
    if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
    const supplier = await prisma.supplier.update({ where: { id }, data });
    void user;
    return ok(c, { supplier });
  },
);
