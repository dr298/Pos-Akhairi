// apps/api/src/routes/transfers.ts
//
// Sprint audit — Inter-account cash transfer log.
// Stores a JSON array in the CASH_TRANSFERS_LOG setting. The /pos/transfers
// page lists entries and lets OWNER/MANAGER record a new one. Append-only.
//
// This is intentionally lightweight (single settings row) instead of a
// dedicated table; the volume of cash movements is low (a few per day
// per outlet) and the data is a log, not a relational source of truth.
// If transfers ever need to be referenced by id from other tables,
// promote to a proper table.

import { Hono } from 'hono';
import { z } from 'zod';
import { AppEnv, requireAuth, requireRole } from '../middleware/auth.js';
import { getSetting, upsertSetting, invalidateSettingCache } from '../services/settings.js';
import { prisma } from '@pos/db';

const transfersRoutes = new Hono<AppEnv>();

transfersRoutes.use('*', requireAuth);

const createSchema = z.object({
  fromAccount: z.string().min(1).max(40),
  toAccount: z.string().min(1).max(40),
  amountCents: z.number().int().positive().max(1_000_000_000), // < 10M IDR cap
  notes: z.string().max(200).optional().default(''),
});

transfersRoutes.get('/', requireRole('OWNER', 'MANAGER'), async (c) => {
  const raw = (await getSetting('CASH_TRANSFERS_LOG')) ?? '[]';
  let entries: unknown[] = [];
  try {
    entries = JSON.parse(raw);
    if (!Array.isArray(entries)) entries = [];
  } catch {
    entries = [];
  }
  // Newest first
  entries.sort((a: unknown, b: unknown) => {
    const at = (a as { at?: string }).at ?? '';
    const bt = (b as { at?: string }).at ?? '';
    return bt.localeCompare(at);
  });
  return c.json({ data: { entries } });
});

transfersRoutes.post('/', requireRole('OWNER', 'MANAGER'), async (c) => {
  const user = c.get('user');
  // Look up the user's display name (SessionUser doesn't carry it).
  const u = await prisma.user.findUnique({
    where: { id: user.id },
    select: { name: true },
  });
  const userName = u?.name ?? user.email;
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: 'ValidationError',
        message: parsed.error.errors[0]?.message ?? 'invalid input',
      },
      400,
    );
  }
  const { fromAccount, toAccount, amountCents, notes } = parsed.data;

  const raw = (await getSetting('CASH_TRANSFERS_LOG')) ?? '[]';
  let entries: unknown[] = [];
  try {
    entries = JSON.parse(raw);
    if (!Array.isArray(entries)) entries = [];
  } catch {
    entries = [];
  }

  // 50 KB cap (same as parse() above) — refuse append if it would overflow
  const newEntry = {
    id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    byUserId: user.id,
    byName: userName,
    fromAccount,
    toAccount,
    amountCents,
    notes,
  };
  const next = JSON.stringify([...entries, newEntry]);
  if (next.length > 50_000) {
    return c.json(
      {
        error: 'LogFull',
        message: 'Transfer log mendekati 50 KB — backup dan kosongkan dulu.',
      },
      507,
    );
  }

  await upsertSetting({
    key: 'CASH_TRANSFERS_LOG',
    value: next,
    updatedById: user.id,
  });
  invalidateSettingCache('CASH_TRANSFERS_LOG');

  // Audit trail entry (best-effort — don't fail the request if the
  // errors table is unavailable)
  try {
    await prisma.errorEvent.create({
      data: {
        severity: 'WARN',
        source: 'API',
        route: 'POST /api/transfers',
        method: 'POST',
        statusCode: 201,
        message: `Cash transfer: ${fromAccount} → ${toAccount} (Rp ${(amountCents / 100).toLocaleString('id-ID')})`,
        context: { entry: newEntry },
        userId: user.id,
      },
    });
  } catch {
    // ignore — audit is best-effort
  }

  return c.json({ data: newEntry }, 201);
});

export { transfersRoutes };
