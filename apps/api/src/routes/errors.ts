// Sprint 7.2 — Error events API (OWNER read).
// Sprint 25 — added POST endpoint for client-side error reports.
//
// The original routes (GET /, GET /stats) are OWNER-only and used by
// the /pos/errors dashboard to browse server-side error events.
//
// The new POST endpoint is PUBLIC (no auth) — client errors fire
// from the global-error.tsx and app/error.tsx boundaries BEFORE the
// user is necessarily authed, and we still want to capture them so
// the user can see what crashed. Worst case an unauthed client
// reports an error; we just store it with no userId. Rate-limiting
// the endpoint is not in scope here — Hermes's existing rate
// limit middleware applies.
import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '@pos/db';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const errorRoutes = new Hono();

const querySchema = z.object({
  severity: z.enum(['ERROR', 'WARN', 'FATAL']).optional(),
  route: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  since: z.string().datetime().optional(),
});

errorRoutes.get('/', requireAuth, requireRole('OWNER'), async (c) => {
  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'BadRequest', details: parsed.error.flatten() }, 400);
  }
  const { severity, route, limit, since } = parsed.data;
  const where: any = {};
  if (severity) where.severity = severity;
  if (route) where.route = { contains: route };
  if (since) where.createdAt = { gte: new Date(since) };

  const [items, total, bySeverity, byRoute] = await Promise.all([
    prisma.errorEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.errorEvent.count({ where }),
    prisma.errorEvent.groupBy({
      by: ['severity'],
      _count: { _all: true },
    }),
    prisma.errorEvent.groupBy({
      by: ['route'],
      _count: { _all: true },
      orderBy: { _count: { route: 'desc' } },
      take: 10,
    }),
  ]);

  return c.json({
    data: {
      items,
      total,
      summary: {
        bySeverity: bySeverity.map((s) => ({ severity: s.severity, count: s._count._all })),
        topRoutes: byRoute.map((r) => ({ route: r.route, count: r._count._all })),
      },
    },
  });
});

errorRoutes.get('/stats', requireAuth, requireRole('OWNER'), async (c) => {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [total24h, total7d, bySeverity24h] = await Promise.all([
    prisma.errorEvent.count({ where: { createdAt: { gte: oneDayAgo } } }),
    prisma.errorEvent.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
    prisma.errorEvent.groupBy({
      by: ['severity'],
      where: { createdAt: { gte: oneDayAgo } },
      _count: { _all: true },
    }),
  ]);

  return c.json({
    data: {
      total24h,
      total7d,
      bySeverity24h: bySeverity24h.map((s) => ({ severity: s.severity, count: s._count._all })),
    },
  });
});

// Sprint 25 — client-side error report.
//
// The browser's global-error.tsx and app/error.tsx call this with
// error.message + error.stack + error.digest + the source URL.
// Stored as an ErrorEvent with severity='ERROR' and a synthetic
// route (e.g. "client:/pos") so the /pos/errors dashboard surfaces
// it alongside server-side events.
//
// Public: no auth required. Worst case is unauthed clients spamming
// this — fine for now, can add rate limit / Cloudflare turnstile
// later if abused.
const clientReportSchema = z.object({
  message: z.string().max(2000).optional(),
  stack: z.string().max(8000).optional(),
  digest: z.string().max(200).optional(),
  source: z.string().max(200).optional(), // 'global-error.tsx' or 'app/error.tsx'
  route: z.string().max(500).optional(),   // window.location.pathname
  userAgent: z.string().max(500).optional(),
});

errorRoutes.post('/client-error', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'BadRequest', details: 'invalid json' }, 400);
  }
  const parsed = clientReportSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'BadRequest', details: parsed.error.flatten() }, 400);
  }
  const { message, stack, digest, source, route, userAgent } = parsed.data;

  // Compose a single log-friendly message. Stack traces can be huge
  // and the ErrorEvent model expects a single string.
  const composed = [
    message && `message: ${message}`,
    source && `source: ${source}`,
    route && `route: ${route}`,
    userAgent && `ua: ${userAgent}`,
    digest && `digest: ${digest}`,
  ].filter(Boolean).join(' | ');

  try {
    await prisma.errorEvent.create({
      data: {
        severity: 'ERROR',
        route: route ? `client:${route}` : 'client:unknown',
        message: composed.slice(0, 2000),
        stack: stack ? stack.slice(0, 8000) : null,
        // No userId — could be unauthed, and the user may be on /login.
        userId: null,
      },
    });
  } catch (err) {
    // Don't crash the response if DB write fails. Log to stdout so
    // ops can see it via docker logs.
    console.error('[client-error] failed to persist:', err);
  }

  // Always 200 — the client doesn't need a retry, this is a one-way
  // fire-and-forget error report.
  return c.json({ ok: true });
});
