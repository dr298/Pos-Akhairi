import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { jwtVerify } from 'jose';

export type UserRole = 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN';

export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
  branchId: string | null;
};

export type AppEnv = {
  Variables: {
    user: SessionUser;
  };
};

const COOKIE_NAME = 'pos_session';

function secretKey(): Uint8Array {
  return new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret-change-me');
}

export async function readToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub) return null;
    return {
      id: String(payload.sub),
      email: String(payload.email || ''),
      role: (payload.role as UserRole) || 'CASHIER',
      branchId: (payload.branchId as string | null) || null,
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

export function ok<T>(c: Context, data: T, status: 200 | 201 | 202 | 204 = 200) {
  return c.json({ data }, status as any);
}

export function fail(c: Context, error: string, message: string, status: 400 | 401 | 403 | 404 | 409 | 500 = 400, details?: unknown) {
  return c.json({ error, message, ...(details !== undefined ? { details } : {}) }, status as any);
}

export function envelope<T = unknown>(data: T) {
  return { data };
}
