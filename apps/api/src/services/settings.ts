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
  // Sprint 14 — name prefix for the BT printer. Chrome's device picker
  // only shows devices whose name starts with this string. Empty = no
  // filter (show all printers in range).
  PRINTER_NAME_PREFIX: {
    description:
      'Name prefix for the Bluetooth printer (e.g. "MTP-" or "RPP"). Empty = no filter.',
    parse: (raw: string): string => {
      if (typeof raw !== 'string') {
        throw new Error('PRINTER_NAME_PREFIX must be a string');
      }
      if (raw.length > 32) {
        throw new Error('PRINTER_NAME_PREFIX max 32 chars');
      }
      return raw.trim();
    },
    format: (s: string) => s.trim(),
  },
  // Sprint 15 — business identity shown on receipts, POS header, and
  // any customer-facing print. All three are owner-editable from
  // /pos/settings (General section).
  BUSINESS_NAME: {
    description:
      'Business name printed on receipts and shown in the POS header.',
    parse: (raw: string): string => {
      if (typeof raw !== 'string') {
        throw new Error('BUSINESS_NAME must be a string');
      }
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        throw new Error('BUSINESS_NAME cannot be empty');
      }
      if (trimmed.length > 80) {
        throw new Error('BUSINESS_NAME max 80 chars');
      }
      return trimmed;
    },
    format: (s: string) => s.trim(),
  },
  BUSINESS_ADDRESS: {
    description:
      'Business address printed under the business name on receipts. Empty = no address line.',
    parse: (raw: string): string => {
      if (typeof raw !== 'string') {
        throw new Error('BUSINESS_ADDRESS must be a string');
      }
      if (raw.length > 200) {
        throw new Error('BUSINESS_ADDRESS max 200 chars');
      }
      return raw.trim();
    },
    format: (s: string) => s.trim(),
  },
  RECEIPT_FOOTER: {
    description:
      'Custom thank-you / closing line at the bottom of every receipt. Empty = default ("Terima kasih!").',
    parse: (raw: string): string => {
      if (typeof raw !== 'string') {
        throw new Error('RECEIPT_FOOTER must be a string');
      }
      if (raw.length > 200) {
        throw new Error('RECEIPT_FOOTER max 200 chars');
      }
      return raw.trim();
    },
    format: (s: string) => s.trim(),
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

// Sprint 15 — single read of all business-identity settings. Cached
// internally per-key. Used by /api/business and the receipt builder.
export async function getBusinessSnapshot() {
  const [name, address, footer] = await Promise.all([
    getSetting('BUSINESS_NAME'),
    getSetting('BUSINESS_ADDRESS'),
    getSetting('RECEIPT_FOOTER'),
  ]);
  return {
    name: name ?? 'BKJ Tangerang',
    address: address ?? '',
    // Empty footer means "use the default" — the caller is responsible
    // for the fallback copy. We just expose whatever the OWNER set.
    footer: footer ?? '',
  };
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
