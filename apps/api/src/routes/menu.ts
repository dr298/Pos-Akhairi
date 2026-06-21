import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';

export const menuRoutes = new Hono<AppEnv>();

menuRoutes.use('*', requireAuth);

// ---------- categories ----------

const categoryCreate = z.object({
  name: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

const categoryUpdate = z.object({
  name: z.string().min(1).max(100).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

menuRoutes.get('/categories', async (c) => {
  const user = c.get('user');
  // Categories are global; cashiers see only active ones
  const where =
    user.role === 'CASHIER'
      ? { isActive: true }
      : {};
  const cats = await prisma.menuCategory.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { items: { where: { isActive: true } } } },
    },
  });
  return ok(c, cats);
});

menuRoutes.post(
  '/categories',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = categoryCreate.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid category payload', 400, parsed.error.issues);
    }
    const cat = await prisma.menuCategory.create({ data: parsed.data });
    return ok(c, cat, 201);
  }
);

menuRoutes.patch(
  '/categories/:id',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const parsed = categoryUpdate.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid update payload', 400, parsed.error.issues);
    }
    const existing = await prisma.menuCategory.findUnique({ where: { id } });
    if (!existing) return fail(c, 'NotFound', 'Category not found', 404);
    const cat = await prisma.menuCategory.update({ where: { id }, data: parsed.data });
    return ok(c, cat);
  }
);

menuRoutes.delete(
  '/categories/:id',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const id = c.req.param('id');
    const existing = await prisma.menuCategory.findUnique({
      where: { id },
      include: { _count: { select: { items: { where: { isActive: true } } } } },
    });
    if (!existing) return fail(c, 'NotFound', 'Category not found', 404);
    if (existing._count.items > 0) {
      return fail(
        c,
        'CategoryHasItems',
        `Cannot delete: category has ${existing._count.items} active items`,
        409
      );
    }
    const cat = await prisma.menuCategory.update({
      where: { id },
      data: { isActive: false },
    });
    return ok(c, cat);
  }
);

// ---------- items ----------

const itemCreate = z.object({
  name: z.string().min(1).max(100),
  sku: z.string().min(1).max(50),
  // Sprint 8.11 — optional barcode (numeric / alphanumeric up to 64 chars).
  // Use the same regex family as a typical EAN-13/UPC-A: digits, hyphens, spaces.
  // We deliberately don't enforce checksum — many shops use internal codes
  // that aren't valid EAN, and the scanner already validates its own format.
  barcode: z.string().min(1).max(64).optional(),
  priceCents: z.number().int().positive(),
  costCents: z.number().int().nonnegative().optional(),
  taxRateBp: z.number().int().min(0).max(10000).optional(),
  categoryId: z.string().min(1),
  description: z.string().max(500).optional(),
  imageUrl: z.string().url().max(500).optional(),
  isAvailable: z.boolean().optional(),
  isActive: z.boolean().optional(),
  modifierIds: z.array(z.string()).optional(),
});

const itemUpdate = itemCreate.partial().refine((o) => Object.keys(o).length > 0, {
  message: 'Empty update payload',
});

menuRoutes.get('/items', async (c) => {
  const user = c.get('user');
  const category = c.req.query('category');
  const available = c.req.query('available');
  const search = c.req.query('search');

  const where: any = {};
  if (category) where.categoryId = category;
  if (available === 'true') where.isAvailable = true;
  if (available === 'false') where.isAvailable = false;
  if (user.role === 'CASHIER') {
    where.isActive = true;
    where.isAvailable = true;
  } else {
    where.isActive = true;
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
    ];
  }

  const items = await prisma.menuItem.findMany({
    where,
    include: {
      category: true,
      modifiers: { where: { isActive: true } },
    },
    orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
  });
  return ok(c, items);
});

menuRoutes.get('/items/:id', async (c) => {
  const id = c.req.param('id');
  const item = await prisma.menuItem.findUnique({
    where: { id },
    include: {
      category: true,
      modifiers: { where: { isActive: true } },
      recipes: { include: { inventoryItem: true } },
    },
  });
  if (!item) return fail(c, 'NotFound', 'Item not found', 404);
  return ok(c, item);
});

// Sprint 8.11 — barcode lookup for handheld / Bluetooth scanners.
// IMPORTANT: this route must be declared before `/items/:id` so the
// static path doesn't get shadowed by the param route.
menuRoutes.get('/items/by-barcode/:barcode', async (c) => {
  const barcode = (c.req.param('barcode') || '').trim();
  if (!barcode) {
    return fail(c, 'ValidationError', 'barcode wajib diisi', 400);
  }
  if (barcode.length > 64) {
    return fail(c, 'ValidationError', 'barcode terlalu panjang (maks 64 karakter)', 400);
  }
  const user = c.get('user');
  // Barcode is globally unique (single restaurant, no branches).
  const item = await prisma.menuItem.findFirst({
    where: { barcode },
    include: {
      category: true,
      modifiers: { where: { isActive: true } },
    },
  });
  if (!item) {
    return fail(c, 'NotFound', `Item dengan barcode "${barcode}" tidak ditemukan`, 404);
  }
  // Cashiers only see active+available items; managers/owners see all
  // matches (e.g. an inactive item with a known barcode for diagnostics).
  if (user.role === 'CASHIER' && (!item.isActive || !item.isAvailable)) {
    return fail(c, 'NotFound', `Item dengan barcode "${barcode}" tidak tersedia`, 404);
  }
  return ok(c, item);
});

menuRoutes.post(
  '/items',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = itemCreate.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid item payload', 400, parsed.error.issues);
    }
    const cat = await prisma.menuCategory.findUnique({ where: { id: parsed.data.categoryId } });
    if (!cat) return fail(c, 'CategoryNotFound', 'Category does not exist', 400);

    const dup = await prisma.menuItem.findFirst({ where: { sku: parsed.data.sku } });
    if (dup) return fail(c, 'SkuTaken', 'SKU already exists', 409);

    // Sprint 8.11 — also reject a duplicate barcode.
    if (parsed.data.barcode) {
      const dupBarcode = await prisma.menuItem.findFirst({ where: { barcode: parsed.data.barcode } });
      if (dupBarcode) {
        return fail(c, 'BarcodeTaken', 'Barcode sudah dipakai item lain', 409);
      }
    }

    const { modifierIds, ...rest } = parsed.data;
    const item = await prisma.menuItem.create({
      data: {
        ...rest,
        ...(modifierIds
          ? {
              modifiers: {
                connect: modifierIds.map((mid) => ({ id: mid })),
              },
            }
          : {}),
      },
      include: { category: true, modifiers: true },
    });
    return ok(c, item, 201);
  }
);

menuRoutes.patch(
  '/items/:id',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const parsed = itemUpdate.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid update payload', 400, parsed.error.issues);
    }
    const existing = await prisma.menuItem.findUnique({ where: { id } });
    if (!existing) return fail(c, 'NotFound', 'Item not found', 404);

    // Sprint 8.11 — prevent collision with another item's barcode.
    // Empty string / null is allowed (clearing the field).
    if (parsed.data.barcode && parsed.data.barcode !== existing.barcode) {
      const dupBarcode = await prisma.menuItem.findFirst({ where: { barcode: parsed.data.barcode } });
      if (dupBarcode && dupBarcode.id !== existing.id) {
        return fail(c, 'BarcodeTaken', 'Barcode sudah dipakai item lain', 409);
      }
    }
    const { modifierIds, ...rest } = parsed.data;
    const item = await prisma.menuItem.update({
      where: { id },
      data: {
        ...rest,
        ...(modifierIds
          ? {
              modifiers: {
                set: modifierIds.map((mid) => ({ id: mid })),
              },
            }
          : {}),
      },
      include: { category: true, modifiers: true },
    });
    return ok(c, item);
  },
);

menuRoutes.delete(
  '/items/:id',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const id = c.req.param('id');
    const existing = await prisma.menuItem.findUnique({ where: { id } });
    if (!existing) return fail(c, 'NotFound', 'Item not found', 404);
    const item = await prisma.menuItem.update({ where: { id }, data: { isActive: false } });
    return ok(c, item);
  }
);

menuRoutes.post(
  '/items/:id/image',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const parsed = z.object({ imageUrl: z.string().url() }).safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'imageUrl required', 400, parsed.error.issues);
    }
    const existing = await prisma.menuItem.findUnique({ where: { id } });
    if (!existing) return fail(c, 'NotFound', 'Item not found', 404);
    const item = await prisma.menuItem.update({
      where: { id },
      data: { imageUrl: parsed.data.imageUrl },
    });
    return ok(c, item);
  }
);

// ---------- Sprint 5.4 — bulk-copy menu between branches (legacy) ----------
// The /api/menu/clone endpoint was for cloning menus between branches.
// With branches removed, this endpoint is now a no-op that returns a
// deprecation notice. We keep the route registered so the web admin can
// detect it and stop calling it.

menuRoutes.post(
  '/clone',
  requireRole('OWNER', 'MANAGER'),
  async (c) => {
    return fail(
      c,
      'Deprecated',
      'Menu cloning between branches is no longer supported. The /api/menu/clone endpoint has been retired now that branches have been removed.',
      410,
    );
  }
);
