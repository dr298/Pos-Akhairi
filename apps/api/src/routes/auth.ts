import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { logger } from '../logger.js';
import { rateLimitAuth } from '../middleware/rate-limit.js';

const COOKIE_NAME = 'pos_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

function secretKey(): Uint8Array {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return new TextEncoder().encode(process.env.JWT_SECRET);
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

// Sprint 7.8 — Tighter rate limit on auth (brute-force protection)
// Applied to login + refresh. 20 attempts / minute / IP.
authRoutes.use('/login', rateLimitAuth());
authRoutes.use('/refresh', rateLimitAuth());

authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400);
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
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
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
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
  });
  if (!user) return c.json({ error: 'UserNotFound' }, 404);
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
});
