// Sprint 7.8 — Rate limiting (in-memory token bucket per IP).
// In-process Map, no external dep. For multi-instance deploy, swap with
// Redis-backed limiter (e.g. @upstash/ratelimit). For now: simple per-IP
// sliding window. Auth endpoints get a tighter limit.
import type { MiddlewareHandler } from 'hono';

type Bucket = { tokens: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Periodically prune to avoid unbounded growth.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (v.resetAt < now - 60_000) buckets.delete(k);
  }
}, 60_000).unref();

function consume(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { tokens: limit - 1, resetAt: now + windowMs });
    return true;
  }
  if (b.tokens <= 0) return false;
  b.tokens--;
  return true;
}

function clientKey(c: any): string {
  // Trust X-Forwarded-For only if behind known proxy (Cloudflare adds CF-Connecting-IP)
  const cfIp = c.req.header('cf-connecting-ip');
  if (cfIp) return `ip:${cfIp}`;
  const xff = c.req.header('x-forwarded-for');
  if (xff) return `ip:${xff.split(',')[0].trim()}`;
  return `ip:${c.req.header('x-real-ip') || 'unknown'}`;
}

// General API: 300 req / minute / IP
export function rateLimit(limit = 300, windowMs = 60_000): MiddlewareHandler {
  return async (c, next) => {
    const key = clientKey(c);
    if (!consume(key, limit, windowMs)) {
      return c.json(
        { error: 'TooManyRequests', message: `Rate limit exceeded: ${limit}/${windowMs}ms` },
        429,
      );
    }
    await next();
  };
}

// Auth endpoints: 20 attempts / minute / IP (brute-force protection)
export function rateLimitAuth(): MiddlewareHandler {
  return rateLimit(20, 60_000);
}
