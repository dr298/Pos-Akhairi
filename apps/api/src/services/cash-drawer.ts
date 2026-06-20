// apps/api/src/services/cash-drawer.ts
//
// Sprint 8.10 — Cash drawer integration.
//
// The dominant wiring in Indonesian F&B: the cash drawer is plugged into
// the thermal printer's RJ12 port. To open the drawer, the host sends an
// ESC/POS "pulse" command on the print line; the printer routes a 24V
// pulse to the RJ12 connector and the drawer's solenoid pops it open.
//
// ESC/POS pulse command (EPSON TM-T20 / TM-T82 / 58mm clones all use the
// same byte sequence):
//
//   ESC  p  <pin>  <onTime>  <offTime>
//
//   0x1B 0x70  0x00..0x01  0x00..0xFF (×10ms)  0x00..0xFF (×10ms)
//
//   - <pin>: 0 = pin 2 (default; most RJ12 drawers), 1 = pin 5
//   - <onTime>/<offTime>: in units of 2ms (not 10ms as the manual says for
//     some clones). The de-facto common values are 25 (0x19) on each side
//     which works on every printer we've ever shipped to. So:
//
//   ESC  p  0  25  25   →   \x1B \x70 \x00 \x19 \x19
//
// This file is the single source of truth for that sequence. The web
// companion (apps/web/src/lib/cash-drawer.ts) re-uses the same bytes
// when the cashier opens the drawer via Web Serial / Web USB.
//
// Public surface
//   kickPrinterBytes(drawerPin)   → Uint8Array (5 bytes)
//   kickPrinterBase64(drawerPin)  → string (base64, easy over JSON)
//   withDrawerKick(printJob, ...) → Uint8Array (printJob prefixed with kick)
//   isCashPayment(method)         → boolean
//   shouldKickForPayment(method)  → boolean (default ON for CASH)

const ESC = 0x1b;
const P = 0x70;

// Default: pin 2, 25 × 2ms on, 25 × 2ms off — the values that work on
// every printer we've shipped to. Callers can override for non-standard
// drawers (some APG Vasario models want pin 5; some cheap clones want
// 5ms / 5ms).
export type DrawerPin = 2 | 5;
export interface DrawerPulseOpts {
  /** Pulse on-time in 2ms units. Default 25 (≈50ms). */
  onTime?: number;
  /** Pulse off-time in 2ms units. Default 25 (≈50ms). */
  offTime?: number;
}

/**
 * Build the raw 5-byte ESC/POS pulse sequence. `drawerPin` accepts:
 *   2 → pin 2 (most common, default)
 *   5 → pin 5 (some APG / MMF models)
 */
export function kickPrinterBytes(
  drawerPin: DrawerPin = 2,
  opts: DrawerPulseOpts = {},
): Uint8Array {
  const pinByte = drawerPin === 5 ? 0x01 : 0x00;
  const onTime = clamp(opts.onTime ?? 25, 1, 255);
  const offTime = clamp(opts.offTime ?? 25, 1, 255);
  return new Uint8Array([ESC, P, pinByte, onTime, offTime]);
}

/**
 * Base64-encoded version of the pulse. Useful when the cash drawer needs
 * to be triggered from a JSON API response (e.g. the web side fetches
 * the bytes, then writes them to a Web Serial port).
 */
export function kickPrinterBase64(
  drawerPin: DrawerPin = 2,
  opts: DrawerPulseOpts = {},
): string {
  return Buffer.from(kickPrinterBytes(drawerPin, opts)).toString('base64');
}

/**
 * Return a Uint8Array that opens the drawer (by pulsing the printer)
 * and then forwards the print job. This is the integration point for
 * `apps/api/src/services/receipt-delivery.ts` — we just concatenate the
 * two buffers, no other glue needed.
 */
export function withDrawerKick(
  printJob: Uint8Array,
  drawerPin: DrawerPin = 2,
  opts: DrawerPulseOpts = {},
): Uint8Array {
  const kick = kickPrinterBytes(drawerPin, opts);
  const out = new Uint8Array(kick.length + printJob.length);
  out.set(kick, 0);
  out.set(printJob, kick.length);
  return out;
}

/**
 * Convenience predicate: should the drawer be opened for this payment
 * method? Defaults to true for CASH only — non-cash payments don't need
 * the drawer. The flag can be overridden per-order via the order
 * metadata (e.g. "drawerKick: false" on the request body).
 */
export function shouldKickForPayment(
  method: string | null | undefined,
  opts: { force?: boolean; skip?: boolean } = {},
): boolean {
  if (opts.skip) return false;
  if (opts.force) return true;
  return isCashPayment(method);
}

/**
 * Is this payment a cash payment? CASH, TUNAI, cash, and the CASH enum
 * value from our payment-finalize types all collapse to true.
 */
export function isCashPayment(method: string | null | undefined): boolean {
  if (!method) return false;
  const m = method.toUpperCase();
  return m === 'CASH' || m === 'TUNAI' || m === 'CASHIER';
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
