// Sprint 5.6 — Branch management (PPN config + listing)
// Branches are listed/created at the system level. Here we expose:
//   GET    /api/branches        — list branches the user has access to
//   GET    /api/branches/:id    — get one branch (must have access)
//   PATCH  /api/branches/:id/ppn — update PPN config (OWNER only)
import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';

export const branchRoutes = new Hono<AppEnv>();

branchRoutes.use('*', requireAuth);

function hasAccess(user: { branchAccess: { branchId: string }[] }, branchId: string): boolean {
  return user.branchAccess.some((b) => b.branchId === branchId);
}

// List all branches the user has access to. Owners see all their accessible
// branches; managers/cashiers see only their assigned branch.
branchRoutes.get('/', async (c) => {
  const user = c.get('user');
  const ids = user.branchAccess.map((a) => a.branchId);
  if (ids.length === 0) return ok(c, { branches: [] });
  const branches = await prisma.branch.findMany({
    where: { id: { in: ids }, isActive: true },
    orderBy: { name: 'asc' },
  });
  return ok(c, { branches });
});

branchRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!hasAccess(user, id)) return fail(c, 'NoAccess', 'No access to this branch', 403);
  const branch = await prisma.branch.findUnique({ where: { id } });
  if (!branch) return fail(c, 'NotFound', 'Branch not found', 404);
  return ok(c, { branch });
});

// PPN config update. OWNER only.
const ppnSchema = z.object({
  ppnPercent: z.number().int().min(0).max(10000), // basis points 0..100%
  ppnInclusive: z.boolean().optional(),
});

branchRoutes.patch(
  '/:id/ppn',
  requireRole('OWNER'),
  async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    if (!hasAccess(user, id)) return fail(c, 'NoAccess', 'No access to this branch', 403);
    const body = await c.req.json().catch(() => ({}));
    const parsed = ppnSchema.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', parsed.error.message, 400);
    }
    const existing = await prisma.branch.findUnique({ where: { id } });
    if (!existing) return fail(c, 'NotFound', 'Branch not found', 404);
    const updated = await prisma.branch.update({
      where: { id },
      data: {
        ppnPercent: parsed.data.ppnPercent,
        ...(parsed.data.ppnInclusive !== undefined
          ? { ppnInclusive: parsed.data.ppnInclusive }
          : {}),
      },
    });
    logger.info(
      { actor: user.id, branchId: id, ppnPercent: updated.ppnPercent, ppnInclusive: updated.ppnInclusive },
      'branch PPN config updated',
    );
    return ok(c, { branch: updated });
  }
);

// Update branch basics (name, address, city, phone, timezone). OWNER only.
const branchUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  address: z.string().max(300).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  timezone: z.string().max(64).optional(),
});

branchRoutes.patch(
  '/:id',
  requireRole('OWNER'),
  async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    if (!hasAccess(user, id)) return fail(c, 'NoAccess', 'No access to this branch', 403);
    const body = await c.req.json().catch(() => ({}));
    const parsed = branchUpdateSchema.safeParse(body);
    if (!parsed.success) return fail(c, 'ValidationError', parsed.error.message, 400);
    const updated = await prisma.branch.update({ where: { id }, data: parsed.data });
    logger.info({ actor: user.id, branchId: id, fields: Object.keys(parsed.data) }, 'branch basics updated');
    return ok(c, { branch: updated });
  }
);
