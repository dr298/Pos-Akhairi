// apps/api/src/routes/cash-drawer.ts
//
// Sprint 8.10 — Cash drawer routes.
//
// Endpoints (all require auth):
//   POST /api/cash-drawer/kick
//     Body: { drawerPin?: 2 | 5, onTime?: number, offTime?: number, force?: boolean }
//     Returns: { bytesBase64, length, drawerPin, onTime, offTime }
//     The bytes are the ESC/POS pulse (`\x1B \x70 \x00/0x01 \x19 \x19`).
//     The cashier's browser writes them to the printer via Web Bluetooth
//     (or to a direct-attached drawer via Web Serial / Web USB).
//
//   GET /api/cash-drawer/info
//     Static description: pin options, supported pulse widths, etc.
//     Useful for the /pos/settings/hardware page to render the dropdown
//     without duplicating constants on the web side.
//
// The route does NOT need a manager role — opening a drawer is a routine
// cashier action (the drawer only opens if there's cash to be put in it).
// We still require auth so anonymous callers can't spam it.

import { Hono } from 'hono';
import { z } from 'zod';
import { AppEnv, requireAuth, ok, fail } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { incCounter } from '../middleware/metrics.js';
import { kickPrinterBase64, kickPrinterBytes } from '../services/cash-drawer.js';

export const cashDrawerRoutes = new Hono<AppEnv>();

cashDrawerRoutes.use('*', requireAuth);

const kickSchema = z.object({
  // 2 is the most common RJ12 pin. 5 is offered for APG / MMF drawers.
  drawerPin: z.union([z.literal(2), z.literal(5)]).optional(),
  // 2ms-unit pulse widths. 25 = 50ms is the universal default. We cap at
  // 255 to match the ESC/POS byte range.
  onTime: z.number().int().min(1).max(255).optional(),
  offTime: z.number().int().min(1).max(255).optional(),
  // If true, ignore the "cash-only" heuristic and always emit a kick.
  // Used by the manual "Test Buka Drawer" button in the hardware page.
  force: z.boolean().optional(),
});

cashDrawerRoutes.post('/kick', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = kickSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, 'ValidationError', 'Invalid drawer kick payload', 400, parsed.error.issues);
  }
  const { drawerPin = 2, onTime, offTime, force } = parsed.data;

  const bytes = kickPrinterBytes(drawerPin, { ...(onTime !== undefined ? { onTime } : {}), ...(offTime !== undefined ? { offTime } : {}) });
  const base64 = Buffer.from(bytes).toString('base64');

  logger.info(
    { actor: user.id, drawerPin, onTime, offTime, force: !!force, length: bytes.length },
    'cash drawer kick requested',
  );
  incCounter('pos_cash_drawer_kicks_total', 'Cash drawer kick requests', {
    pin: String(drawerPin),
    source: force ? 'manual' : 'auto',
  });

  return ok(c, {
    bytesBase64: base64,
    length: bytes.length,
    drawerPin,
    onTime: onTime ?? 25,
    offTime: offTime ?? 25,
    // The exact hex sequence, exposed for debugging. Not used by clients.
    hex: Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' '),
  });
});

cashDrawerRoutes.get('/info', async (c) => {
  // We don't try to inspect the browser's navigator here — the API is
  // browser-agnostic. The web side detects the actual capability and
  // picks the right transport. We just list what's possible.
  return ok(c, {
    pins: [2, 5],
    defaultPin: 2,
    pulseUnitMs: 2, // each "tick" in onTime/offTime is 2ms
    defaultOnTime: 25, // 50ms
    defaultOffTime: 25, // 50ms
    minPulse: 1,
    maxPulse: 255,
    escposSequence: '\\x1B \\x70 <pin> <onTime> <offTime>',
    transportOptions: [
      { kind: 'printer', label: 'Lewat Printer (RJ12)' },
      { kind: 'webserial', label: 'Web Serial (USB-to-Serial)' },
      { kind: 'webusb', label: 'Web USB (langsung)' },
    ],
  });
});
