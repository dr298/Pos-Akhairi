import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { logger } from '../logger.js';

const COOKIE_NAME = 'pos_session';
const BRANCH_COOKIE_NAME = 'pos_branch';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

function secretKey(): Uint8Array {
  return new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret-change-me');
}

async function buildToken(payload: Record<string, unknown>): Promise<string> {
  return await new SignJWT(payload as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secretKey());
}

async function readToken(token: string): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const authRoutes = new Hono();

authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400);
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { branch: true },
  });
  if (!user || !user.isActive) {
    return c.json({ error: 'InvalidCredentials' }, 401);
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return c.json({ error: 'InvalidCredentials' }, 401);
  }

  const token = await buildToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    branchId: user.branchId,
  });
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  logger.info({ userId: user.id }, 'login ok');
  return c.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role, branchId: user.branchId, branch: user.branch },
  });
});

authRoutes.post('/logout', (c) => {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return c.json({ error: 'Unauthenticated' }, 401);
  const payload = await readToken(token);
  if (!payload) return c.json({ error: 'InvalidSession' }, 401);
  const user = await prisma.user.findUnique({
    where: { id: String(payload.sub) },
    include: { branch: true },
  });
  if (!user) return c.json({ error: 'UserNotFound' }, 404);
  // Sprint 5.5b — include all branches the user can access for the switcher
  const access = await prisma.userBranchAccess.findMany({
    where: { userId: user.id },
    include: { branch: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      branchId: user.branchId,
      branch: user.branch,
      branchAccess: access.map((a) => ({
        branchId: a.branchId,
        role: a.role,
        isDefault: a.isDefault,
        branch: a.branch,
      })),
    },
  });
});

// Sprint 5.5b — switch active branch. Sets pos_branch cookie so subsequent
// requests resolve the effective branch to this one. Verifies access first.
authRoutes.post('/me/branch', async (c) => {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return c.json({ error: 'Unauthenticated' }, 401);
  const payload = await readToken(token);
  if (!payload) return c.json({ error: 'InvalidSession' }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { branchId?: string };
  const branchId = String(body.branchId || '');
  if (!branchId) return c.json({ error: 'ValidationError', message: 'branchId required' }, 400);
  const userId = String(payload.sub || '');
  if (!userId) return c.json({ error: 'InvalidSession' }, 401);
  const access = await prisma.userBranchAccess.findUnique({
    where: { userId_branchId: { userId, branchId } },
  });
  if (!access) {
    return c.json({ error: 'NoAccess', message: 'No access to that branch' }, 403);
  }
  setCookie(c, BRANCH_COOKIE_NAME, branchId, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  return c.json({ ok: true, branchId, role: access.role });
});

