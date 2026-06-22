// apps/api/src/routes/settings.ts
//
// Sprint 13 — global settings admin API.
// OWNER can read all + write; MANAGER can read.
// Used by /pos/settings UI to change DEFAULT_PPN_BP (PPN/VAT rate).

import { Hono } from 'hono';
import { z } from 'zod';
import { AppEnv, requireAuth, requireRole, ok, fail } from '../middleware/auth.js';
import {
  KNOWN_SETTINGS,
  listSettings,
  upsertSetting,
} from '../services/settings.js';

export const settingsRoutes = new Hono<AppEnv>();

// All routes need an authenticated user before role check.
settingsRoutes.use('*', requireAuth);

const KNOWN_KEYS = Object.keys(KNOWN_SETTINGS);

// Empty string is valid (e.g. PRINTER_NAME_PREFIX="" = "no filter"), so
// we don't enforce .min(1) here. Length is bounded by .max(50).
const upsertSchema = z.object({
  value: z.string().max(50),
  description: z.string().max(200).nullable().optional(),
});

settingsRoutes.get('/', requireRole('OWNER', 'MANAGER'), async (c) => {
  const rows = await listSettings();
  return ok(c, { settings: rows, known: KNOWN_KEYS });
});

settingsRoutes.put(
  '/:key',
  requireRole('OWNER'),
  async (c) => {
    const key = c.req.param('key');
    if (!KNOWN_KEYS.includes(key)) {
      return fail(
        c,
        'UnknownSetting',
        `Setting "${key}" is not recognised. Known: ${KNOWN_KEYS.join(', ')}`,
        400,
      );
    }
    const body = await c.req.json().catch(() => ({}));
    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) {
      return fail(c, 'ValidationError', 'Invalid setting payload', 400, parsed.error.issues);
    }
    try {
      const row = await upsertSetting({
        key,
        value: parsed.data.value,
        description: parsed.data.description ?? null,
        updatedById: c.get('user').id,
      });
      return ok(c, {
        key: row.key,
        value: row.value,
        description: row.description,
        updatedById: row.updatedById,
        updatedAt: row.updatedAt.toISOString(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return fail(c, 'InvalidSetting', msg, 400);
    }
  },
);
