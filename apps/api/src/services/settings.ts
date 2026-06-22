// apps/api/src/services/settings.ts
//
// Sprint 13 — global key-value settings with audit trail.
// Used to back DEFAULT_PPN_BP and other future global toggles.
// Read path is hot (called on every order create), so we cache in
// memory for a short TTL to avoid hammering the DB. The cache is
// process-local — if the OWNER updates a setting in one process the
// in-memory copy in the same process refreshes immediately; a parallel
// API process will pick it up within TTL_MS (default 30s).
//
// We do NOT subscribe to Postgres NOTIFY for cross-process
// invalidation — too much infra for the volume. 30s stale window is
// acceptable for tax rate (cashier workflow is slow).

import { prisma } from '@pos/db';

const TTL_MS = 30_000;

const cache = new Map<string, { value: string; expiresAt: number }>();

export const KNOWN_SETTINGS = {
  DEFAULT_PPN_BP: {
    description:
      'Default PPN / VAT rate in basis points. 1100 = 11%, 0 = hide PPN everywhere.',
    parse: (raw: string): number => {
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 0 || n > 10_000) {
        throw new Error(`DEFAULT_PPN_BP must be 0..10000 (basis points), got: ${raw}`);
      }
      return n;
    },
    format: (n: number) => String(Math.trunc(n)),
  },
} as const;

export type KnownSettingKey = keyof typeof KNOWN_SETTINGS;

export async function getSetting(key: string): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return null;
  cache.set(key, { value: row.value, expiresAt: Date.now() + TTL_MS });
  return row.value;
}

export async function getEffectivePpnBp(): Promise<number> {
  const raw = await getSetting('DEFAULT_PPN_BP');
  if (raw === null) return 0; // default off — no PPN
  try {
    return KNOWN_SETTINGS.DEFAULT_PPN_BP.parse(raw);
  } catch {
    return 0;
  }
}

export function invalidateSettingCache(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}

export async function listSettings() {
  const rows = await prisma.setting.findMany({ orderBy: { key: 'asc' } });
  return rows.map((r) => ({
    key: r.key,
    value: r.value,
    description: r.description ?? null,
    updatedById: r.updatedById,
    updatedAt: r.updatedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function upsertSetting(opts: {
  key: string;
  value: string;
  description?: string | null;
  updatedById: string;
}) {
  // Validate before write
  const def = (KNOWN_SETTINGS as Record<string, { parse: (s: string) => unknown } | undefined>)[opts.key];
  if (def) def.parse(opts.value);

  const row = await prisma.setting.upsert({
    where: { key: opts.key },
    create: {
      key: opts.key,
      value: opts.value,
      description: opts.description ?? null,
      updatedById: opts.updatedById,
    },
    update: {
      value: opts.value,
      description: opts.description ?? null,
      updatedById: opts.updatedById,
    },
  });
  invalidateSettingCache(opts.key);
  return row;
}
