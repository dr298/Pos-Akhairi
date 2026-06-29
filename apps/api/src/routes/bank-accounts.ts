import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';

export const bankAccountRoutes = new Hono<AppEnv>();

// All routes require OWNER auth
bankAccountRoutes.use('*', requireAuth, requireRole('OWNER'));

const bankAccountSchema = z.object({
  bankName: z.string().min(1).max(50),
  accountName: z.string().min(1).max(100),
  accountNo: z.string().min(1).max(50),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).optional().default(0),
});

const updateSchema = bankAccountSchema.partial();

// GET /api/bank-accounts — list all
bankAccountRoutes.get('/', async (c) => {
  const accounts = await prisma.bankAccount.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return ok(c, { accounts });
});

// GET /api/bank-accounts/active — list active only (for payment selector)
bankAccountRoutes.get('/active', async (c) => {
  const accounts = await prisma.bankAccount.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return ok(c, { accounts });
});

// POST /api/bank-accounts — create
bankAccountRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = bankAccountSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', parsed.error.issues[0].message, 400);
  }
  const account = await prisma.bankAccount.create({ data: parsed.data });
  return ok(c, { account }, 201);
});

// PUT /api/bank-accounts/:id — update
bankAccountRoutes.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', parsed.error.issues[0].message, 400);
  }
  const existing = await prisma.bankAccount.findUnique({ where: { id } });
  if (!existing) {
    return fail(c, 'NotFound', 'Bank account not found', 404);
  }
  const account = await prisma.bankAccount.update({
    where: { id },
    data: parsed.data,
  });
  return ok(c, { account });
});

// DELETE /api/bank-accounts/:id — delete
bankAccountRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await prisma.bankAccount.findUnique({ where: { id } });
  if (!existing) {
    return fail(c, 'NotFound', 'Bank account not found', 404);
  }
  await prisma.bankAccount.delete({ where: { id } });
  return ok(c, { deleted: true });
});
