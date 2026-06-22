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

businessRoutes.use('*', requireAuth);

businessRoutes.get('/', async (c) => {
  const snap = await getBusinessSnapshot();
  return ok(c, snap);
});
