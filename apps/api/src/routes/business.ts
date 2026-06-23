// apps/api/src/routes/business.ts
//
// Sprint 15 — public-to-authenticated snapshot of the business identity
// (name, address, footer). Used by the POS header, the receipt preview,
// and the success page so all of them show the same values from one
// source of truth (the Settings table).
//
// This endpoint is auth-required (any logged-in user) but does NOT
// require OWNER — cashiers and managers also need to read it. Writes
// still go through the existing /api/settings/:key endpoint (OWNER
// only), so we keep the role check centralised there.

import { Hono } from 'hono';
import { AppEnv, requireAuth, ok } from '../middleware/auth.js';
import { getBusinessSnapshot } from '../services/settings.js';

export const businessRoutes = new Hono();

// Sprint 24 — public business-name endpoint for SSR metadata.
// Only exposes the business name (not address/footer which can
// contain PII or location info). Used by the root layout's
// `generateMetadata` to render `<title>{BUSINESS_NAME}</title>`
// in the browser tab.
//
// Registered BEFORE the auth middleware so it's reachable
// without a session. The full /api/business route below is
// auth-gated because address/footer may be considered
// sensitive in some deployments. The name alone is fine to
// expose for the page title — it's what the customer sees on
// the receipt anyway.
businessRoutes.get('/public-name', async (c) => {
  const snap = await getBusinessSnapshot();
  return c.json({ name: snap.name });
});

businessRoutes.use('*', requireAuth);

businessRoutes.get('/', async (c) => {
  const snap = await getBusinessSnapshot();
  return ok(c, snap);
});
