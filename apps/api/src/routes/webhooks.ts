// Sprint 10 — online ordering / delivery webhooks removed.
// Online ordering (GoFood / GrabFood / ShopeeFood) was dropped per user
// request 2026-06-21 ("hapus fitur delivery order, gajadi dipake").
// Webhook routes return 410 Gone for the old paths so any in-flight
// integrations get a clear signal.

import { Hono } from 'hono';
import { fail } from '../middleware/auth.js';

export const webhookRoutes = new Hono();

webhookRoutes.post('/gofood', (c) =>
  fail(c, 'Removed', 'Online ordering removed; GoFood integration is no longer available', 404),
);
webhookRoutes.post('/grabfood', (c) =>
  fail(c, 'Removed', 'Online ordering removed; GrabFood integration is no longer available', 404),
);
webhookRoutes.post('/shopeefood', (c) =>
  fail(c, 'Removed', 'Online ordering removed; ShopeeFood integration is no longer available', 404),
);
