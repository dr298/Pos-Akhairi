import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { jwtVerify } from 'jose';
import { logger } from '../logger.js';

export type UserRole = 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN';

export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
};

export type AppEnv = {
  Variables: {
    user: SessionUser;
  };
};

const COOKIE_NAME = 'pos_session';

function secretKey(): Uint8Array {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

export async function readToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub) return null;
    return {
      id: String(payload.sub),
      email: String(payload.email || ''),
      role: (payload.role as UserRole) || 'CASHIER',
    };
  } catch {
    return null;
  }
}

export function extractToken(c: Context): string | null {
  const auth = c.req.header('authorization') || c.req.header('Authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const cookie = getCookie(c, COOKIE_NAME);
  return cookie || null;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = extractToken(c);
  if (!token) {
    return c.json({ error: 'Unauthenticated', message: 'Missing or invalid token' }, 401);
  }
  const user = await readToken(token);
  if (!user) {
    return c.json({ error: 'InvalidSession', message: 'Session expired or invalid' }, 401);
  }
  c.set('user', user);
  await next();
};

export function requireRole(...allowed: UserRole[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const u = c.get('user');
    if (!u) {
      return c.json({ error: 'Unauthenticated' }, 401);
    }
    if (!allowed.includes(u.role)) {
      return c.json(
        { error: 'Forbidden', message: `Role ${u.role} not allowed; need one of ${allowed.join(',')}` },
        403
      );
    }
    await next();
  };
}

// JSON-safe BigInt replacer: BigInt cents from Prisma (PO totals, etc.)
// would otherwise crash `JSON.stringify` with "Do not know how to
// serialize a BigInt". We render them as decimal strings — the web layer
// reads them as strings and casts to Number / Prisma.Decimal locally.
const bigintSafeReplacer = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value;

export function ok<T>(c: Context, data: T, status: 200 | 201 | 202 | 204 = 200) {
  // Pre-stringify with our BigInt replacer, then hand the body to Hono as
  // a string. Hono's c.json() can't take a custom replacer, so we build
  // the response manually.
  const body = JSON.stringify({ data }, bigintSafeReplacer);
  return c.body(body, status, {
    'Content-Type': 'application/json; charset=UTF-8',
  });
}

export function fail(
  c: Context,
  error: string,
  message: string,
  status: 400 | 401 | 402 | 403 | 404 | 409 | 410 | 500 | 502 = 400,
  details?: unknown
) {
  return c.json({ error, message, ...(details !== undefined ? { details } : {}) }, status as any);
}

export function envelope<T = unknown>(data: T) {
  return { data };
}
