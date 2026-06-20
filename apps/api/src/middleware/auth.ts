import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { jwtVerify } from 'jose';
import { prisma } from '@pos/db';
import { logger } from '../logger.js';

export type UserRole = 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN';

export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
  branchId: string | null;          // legacy: user's primary branch
  effectiveBranchId: string | null; // resolved by branchContext (after switcher)
  branchAccess: Array<{ branchId: string; role: UserRole; isDefault: boolean }>;
};

export type AppEnv = {
  Variables: {
    user: SessionUser;
  };
};

const COOKIE_NAME = 'pos_session';
const BRANCH_COOKIE = 'pos_branch';

function secretKey(): Uint8Array {
  return new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret-change-me');
}

export async function readToken(token: string): Promise<Omit<SessionUser, 'effectiveBranchId' | 'branchAccess'> | null> {
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
  c.set('user', {
    ...user,
    effectiveBranchId: null,
    branchAccess: [],
  });
  // Sprint 5.5b: always resolve the effective branch on auth, so existing
  // routes reading `user.branchId` see the switched branch automatically.
  // We only auto-overwrite `user.branchId` when the user has branch access
  // rows (so legacy users without access rows keep their primary branchId).
  try {
    const access = await prisma.userBranchAccess.findMany({
      where: { userId: user.id },
      select: { branchId: true, role: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    if (access.length === 0 && user.branchId) {
      await prisma.userBranchAccess.upsert({
        where: { userId_branchId: { userId: user.id, branchId: user.branchId } },
        update: {},
        create: { userId: user.id, branchId: user.branchId, role: user.role, isDefault: true },
      });
      access.push({ branchId: user.branchId, role: user.role, isDefault: true });
    }
    const accessBranchIds = new Set(access.map((a) => a.branchId));
    const qBranch = c.req.query('branchId');
    const cookieBranch = getCookie(c, BRANCH_COOKIE);
    const effective =
      (qBranch && accessBranchIds.has(qBranch) ? qBranch : null) ??
      (cookieBranch && accessBranchIds.has(cookieBranch) ? cookieBranch : null) ??
      access.find((a) => a.isDefault)?.branchId ??
      access[0]?.branchId ??
      user.branchId ??
      null;
    if (qBranch && !accessBranchIds.has(qBranch)) {
      return c.json(
        { error: 'NoAccess', message: `No access to branch ${qBranch}` },
        403,
      );
    }
    c.set('user', {
      ...c.get('user'),
      // Overwrite branchId with the effective (switcher-resolved) branch so
      // existing routes that read `user.branchId` see the switched value.
      branchId: effective,
      effectiveBranchId: effective,
      branchAccess: access,
    });
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'branchContext resolve failed; using legacy branchId');
  }
  await next();
};

/**
 * Sprint 5.5b — Branch context resolver. Kept for explicit chaining in
 * route modules that need it, but `requireAuth` now runs this inline
 * so existing routes get it automatically.
 */
export const branchContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
};

/**
 * Combined: requireAuth THEN branchContext. Convenience for route modules
 * that want both. Existing routes using `requireAuth` only continue to work
 * (just no branch context — they should migrate to this for S5 features).
 */
export const requireAuthAndBranch: MiddlewareHandler<AppEnv>[] = [requireAuth, branchContext];

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

export function fail(
  c: Context,
  error: string,
  message: string,
  status: 400 | 401 | 402 | 403 | 404 | 409 | 500 | 502 = 400,
  details?: unknown
) {
  return c.json({ error, message, ...(details !== undefined ? { details } : {}) }, status as any);
}

export function envelope<T = unknown>(data: T) {
  return { data };
}

export { BRANCH_COOKIE };
