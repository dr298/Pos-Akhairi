// Sprint 7.8 — Security headers middleware (CSP, HSTS, X-Frame-Options, etc).
// OWASP-recommended baseline. CSP allows inline styles for Next.js runtime.
import type { MiddlewareHandler } from 'hono';

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    // HSTS only when behind HTTPS (Cloudflare)
    if (c.req.url.startsWith('https://')) {
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    // CSP — note: API responses are JSON, not HTML, so CSP is for any
    // HTML the API might serve. Keep permissive for now; tighten per-route
    // as needed.
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
  };
}
