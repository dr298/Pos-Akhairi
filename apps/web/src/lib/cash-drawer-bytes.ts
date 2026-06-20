// apps/web/src/lib/cash-drawer-bytes.ts
//
// Shared ESC/POS pulse bytes for the cash drawer. This file is the
// web-side twin of `apps/api/src/services/cash-drawer.ts` — both files
// must agree on the byte values, so we keep them physically separate
// from the main web bundle (which would otherwise pull in a server-only
// import).
//
// The single public function, `kickPrinterBytes`, returns the 5-byte
// sequence. We duplicate the small amount of logic rather than make
// the web side import from the api package — that would couple web
// build to the api workspace.

export type DrawerPin = 2 | 5;
export interface DrawerPulseOpts {
  /** Pulse on-time in 2ms units. Default 25 (≈50ms). */
  onTime?: number;
  /** Pulse off-time in 2ms units. Default 25 (≈50ms). */
  offTime?: number;
}

const ESC = 0x1b;
const P = 0x70;

export function kickPrinterBytes(
  drawerPin: DrawerPin = 2,
  opts: DrawerPulseOpts = {},
): Uint8Array {
  const pinByte = drawerPin === 5 ? 0x01 : 0x00;
  const onTime = clamp(opts.onTime ?? 25, 1, 255);
  const offTime = clamp(opts.offTime ?? 25, 1, 255);
  return new Uint8Array([ESC, P, pinByte, onTime, offTime]);
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
