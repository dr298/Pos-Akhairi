import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';

export const categoryRoutes = new Hono<AppEnv>();

categoryRoutes.use('*', requireAuth);

// GET /api/categories - List all categories
categoryRoutes.get('/', async (c) => {
  const categories = await prisma.menuCategory.findMany({
    orderBy: { sortOrder: 'asc' },
    include: {
      _count: {
        select: { items: true },
      },
    },
  });
  return ok(c, categories);
});

// GET /api/categories/:id - Get single category
categoryRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const category = await prisma.menuCategory.findUnique({
    where: { id },
    include: {
      _count: {
        select: { items: true },
      },
    },
  });
  if (!category) return fail(c, 'NotFound', 'Category not found', 404);
  return ok(c, category);
});

// POST /api/categories - Create new category (OWNER/MANAGER only)
const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

categoryRoutes.post('/', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = createCategorySchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid category payload', 400, parsed.error.issues);
  }

  const { name, sortOrder, isActive } = parsed.data;

  // Check for duplicate name
  const existing = await prisma.menuCategory.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });
  if (existing) {
    return fail(c, 'DuplicateName', `Category "${name}" already exists`, 409);
  }

  const category = await prisma.menuCategory.create({
    data: {
      name,
      sortOrder: sortOrder ?? 0,
      isActive: isActive ?? true,
    },
  });

  logger.info({ categoryId: category.id, name, by: user.id }, 'category created');
  return ok(c, category, 201);
});

// PUT /api/categories/:id - Update category (OWNER/MANAGER only)
const updateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

categoryRoutes.put('/:id', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateCategorySchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid payload', 400, parsed.error.issues);
  }

  const category = await prisma.menuCategory.findUnique({ where: { id } });
  if (!category) return fail(c, 'NotFound', 'Category not found', 404);

  const { name, sortOrder, isActive } = parsed.data;

  // Check for duplicate name (exclude current category)
  if (name && name !== category.name) {
    const existing = await prisma.menuCategory.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        id: { not: id },
      },
    });
    if (existing) {
      return fail(c, 'DuplicateName', `Category "${name}" already exists`, 409);
    }
  }

  const updated = await prisma.menuCategory.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(sortOrder !== undefined ? { sortOrder } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    },
  });

  logger.info({ categoryId: id, by: user.id }, 'category updated');
  return ok(c, updated);
});

// DELETE /api/categories/:id - Delete category (OWNER only)
categoryRoutes.delete('/:id', requireRole('OWNER'), async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const category = await prisma.menuCategory.findUnique({
    where: { id },
    include: {
      _count: {
        select: { items: true },
      },
    },
  });
  if (!category) return fail(c, 'NotFound', 'Category not found', 404);

  // Prevent deletion if category has items
  if (category._count.items > 0) {
    return fail(
      c,
      'CategoryNotEmpty',
      `Cannot delete category with ${category._count.items} menu items`,
      409
    );
  }

  await prisma.menuCategory.delete({ where: { id } });

  logger.info({ categoryId: id, by: user.id }, 'category deleted');
  return ok(c, { ok: true });
});
