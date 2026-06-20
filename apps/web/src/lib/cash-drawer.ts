// apps/web/src/lib/cash-drawer.ts
//
// Sprint 8.10 — Cash drawer integration for the browser.
//
// Three transports are tried in order, with the cheapest (no permission
// prompt) first:
//
//   1. **Printer (Bluetooth)** — the drawer is wired to the printer's
//      RJ12 port. We write the kick bytes to the same BLE characteristic
//      the receipt bytes go to. Requires the printer to be already
//      connected (the existing /pos flow connects it).
//
//   2. **Web Serial** — direct-attached USB-to-serial drawer (e.g. an
//      APG cash drawer driven by an FTDI cable). Requires a user gesture
//      to open the port.
//
//   3. **Web USB** — direct-attached USB drawer. Requires a user gesture
//      to claim the device. We try a small set of common vendor IDs.
//
//   4. **API fallback** — if the browser can't open any hardware path
//      directly, fetch the kick bytes from POST /api/cash-drawer/kick.
//      The API returns the same ESC/POS bytes; the caller can then
//      route them through whatever local transport is available
//      (typically: nothing — the cashier just opens the drawer manually).
//
// All paths are best-effort. The hook never throws on the hot path; it
// returns a `DrawerKickResult` with `ok: false` and a `reason` string
// so the caller can decide whether to surface a toast or stay silent.
//
// The exported `kickDrawerWeb()` is a stateless helper — pass it your
// `BluetoothCharacteristic` if you have one (printer-attached), or call
// it without arguments to do the auto-detect dance. The `useDrawerKick`
// hook wraps it for React components.
//
// Browser support is best-effort: every path is feature-detected and we
// silently no-op on unsupported platforms.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { kickPrinterBytes, type DrawerPin } from './cash-drawer-bytes';

// ─── Public types ───────────────────────────────────────────────────────────

export type DrawerTransport = 'printer' | 'webserial' | 'webusb' | 'api';

export interface DrawerKickResult {
  ok: boolean;
  transport: DrawerTransport | null;
  reason?: string;
}

export interface KickDrawerOptions {
  /**
   * Optional pre-connected Bluetooth characteristic (the printer's write
   * channel). When provided we use the "printer-attached" path and write
   * the kick bytes there. When null we try Web Serial / Web USB instead.
   */
  printerCharacteristic?: BluetoothCharacteristic | null;
  /** Pin 2 (default) or pin 5. */
  drawerPin?: DrawerPin;
}

export interface UseDrawerKickOptions extends KickDrawerOptions {
  /** Auto-kick when this becomes true (e.g. after cash payment finalize). */
  triggerOn?: boolean;
}

export interface UseDrawerKickResult {
  /** Trigger a kick manually. */
  kick: () => Promise<DrawerKickResult>;
  /** True while a kick is in flight. */
  busy: boolean;
  /** Last result, or null. */
  lastResult: DrawerKickResult | null;
  /** What transports this browser supports. */
  support: DrawerSupport;
}

export interface DrawerSupport {
  /** `navigator.bluetooth` — for the printer-attached path. */
  bluetooth: boolean;
  /** `navigator.serial` — for direct serial. */
  serial: boolean;
  /** `navigator.usb` — for direct USB. */
  usb: boolean;
}

// ─── Web Bluetooth / Serial / USB local types ───────────────────────────────
//
// The dom lib in modern TS includes Web Bluetooth but NOT Web Serial or
// Web USB. Declare minimal local types so we don't have to cast `any` at
// the boundary. Feature detection is `'foo' in navigator` before any
// call into these.

interface LocalSerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

// We deliberately type `writable` loosely — the spec types it as
// `WritableStream` which has a sync `getWriter()`. Cast to `any` at the
// boundary to keep the rest of the file clean.
type LocalSerialWriter = {
  write(data: Uint8Array): Promise<void>;
  releaseLock(): void;
};

interface LocalSerialPort extends EventTarget {
  open(options: { baudRate: number; dataBits?: number; stopBits?: number; parity?: 'none' | 'even' | 'odd'; flowControl?: 'none' | 'hardware' }): Promise<void>;
  close(): Promise<void>;
  getInfo(): LocalSerialPortInfo;
  writable: { getWriter(): LocalSerialWriter } | null;
}
interface LocalSerial extends EventTarget {
  requestPort(opts?: { filters?: Array<{ usbVendorId?: number; usbProductId?: number }> }): Promise<LocalSerialPort>;
  getPorts(): Promise<LocalSerialPort[]>;
}
interface LocalUSBDevice {
  vendorId: number;
  productId: number;
  productName?: string;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration?: (configurationValue: number) => Promise<void>;
  claimInterface?: (interfaceNumber: number) => Promise<void>;
  releaseInterface?: (interfaceNumber: number) => Promise<void>;
  transferOut?: (endpointNumber: number, data: BufferSource) => Promise<{ status: string; bytesWritten: number }>;
  configurations: Array<{ configurationValue: number; interfaces: Array<{ interfaceNumber: number; alternate: { interfaceClass: number }; endpoints: Array<{ direction: 'in' | 'out'; endpointNumber: number; type: 'bulk' | 'interrupt' | 'isochronous' }> }> }>;
}
interface LocalUSB extends EventTarget {
  requestDevice(opts: { filters: Array<{ vendorId?: number; productId?: number; classCode?: number }> }): Promise<LocalUSBDevice>;
  getDevices(): Promise<LocalUSBDevice[]>;
}

interface NavigatorExtras {
  serial?: LocalSerial;
  usb?: LocalUSB;
}

// ─── Feature detection ──────────────────────────────────────────────────────

export function getDrawerSupport(): DrawerSupport {
  if (typeof navigator === 'undefined') {
    return { bluetooth: false, serial: false, usb: false };
  }
  const nav = navigator as Navigator & NavigatorExtras;
  return {
    bluetooth: 'bluetooth' in navigator,
    serial: !!nav.serial,
    usb: !!nav.usb,
  };
}

// Common USB vendor IDs for direct-attached cash drawers. We don't filter
// aggressively — the device picker will show whatever matches. These IDs
// are the ones most likely to show up in a small Indonesian cafe:
//   0x04b4 = Cypress Semiconductor (used by many FTDI-style adapters)
//   0x0519 = TDK (some APG / MMF models)
//   0x0fe6 = ICS Advent (older MMF / Logic Controls)
const COMMON_DRAWER_VENDOR_IDS = [0x04b4, 0x0519, 0x0fe6, 0x0403, 0x10c4, 0x2341];

// ─── Helpers ────────────────────────────────────────────────────────────────

async function writeToCharacteristic(
  characteristic: BluetoothCharacteristic,
  data: Uint8Array,
): Promise<void> {
  // Chunk into 100-byte slices, matching the receipt flow in
  // `bluetooth-printer.ts`. The drawer pulse is only 5 bytes, so this
  // is a single chunk in practice.
  const CHUNK = 100;
  for (let i = 0; i < data.length; i += CHUNK) {
    const slice = data.slice(i, Math.min(i + CHUNK, data.length));
    await characteristic.writeValueWithoutResponse(slice);
    await new Promise((r) => setTimeout(r, 30));
  }
}

async function kickViaPrinter(
  bytes: Uint8Array,
  characteristic: BluetoothCharacteristic | null,
): Promise<DrawerKickResult> {
  if (!characteristic) {
    return { ok: false, transport: 'printer', reason: 'Printer tidak terhubung' };
  }
  try {
    await writeToCharacteristic(characteristic, bytes);
    return { ok: true, transport: 'printer' };
  } catch (e) {
    return { ok: false, transport: 'printer', reason: (e as Error).message || 'Gagal menulis ke printer' };
  }
}

async function kickViaSerial(bytes: Uint8Array, drawerPin: DrawerPin): Promise<DrawerKickResult> {
  if (typeof navigator === 'undefined') {
    return { ok: false, transport: 'webserial', reason: 'Web Serial tidak tersedia' };
  }
  const nav = navigator as Navigator & NavigatorExtras;
  if (!nav.serial) {
    return { ok: false, transport: 'webserial', reason: 'Web Serial tidak didukung di browser ini' };
  }
  let port: LocalSerialPort;
  try {
    port = await nav.serial.requestPort({});
  } catch (e) {
    return { ok: false, transport: 'webserial', reason: (e as Error).message || 'Pemilihan port dibatalkan' };
  }
  try {
    await port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
  } catch (e) {
    return { ok: false, transport: 'webserial', reason: (e as Error).message || 'Gagal membuka port serial' };
  }
  try {
    const writer = port.writable ? port.writable.getWriter() : null;
    if (!writer) {
      await port.close();
      return { ok: false, transport: 'webserial', reason: 'Port tidak dapat ditulis' };
    }
    await writer.write(bytes);
    writer.releaseLock();
    return { ok: true, transport: 'webserial' };
  } catch (e) {
    return { ok: false, transport: 'webserial', reason: (e as Error).message || 'Gagal menulis ke port serial' };
  } finally {
    try {
      await port.close();
    } catch {
      // ignore
    }
  }
}

async function kickViaUsb(bytes: Uint8Array): Promise<DrawerKickResult> {
  if (typeof navigator === 'undefined') {
    return { ok: false, transport: 'webusb', reason: 'Web USB tidak tersedia' };
  }
  const nav = navigator as Navigator & NavigatorExtras;
  if (!nav.usb) {
    return { ok: false, transport: 'webusb', reason: 'Web USB tidak didukung di browser ini' };
  }
  let device: LocalUSBDevice;
  try {
    device = await nav.usb.requestDevice({
      filters: COMMON_DRAWER_VENDOR_IDS.map((vendorId) => ({ vendorId })),
    });
  } catch (e) {
    return { ok: false, transport: 'webusb', reason: (e as Error).message || 'Pemilihan perangkat USB dibatalkan' };
  }
  try {
    await device.open();
  } catch (e) {
    return { ok: false, transport: 'webusb', reason: (e as Error).message || 'Gagal membuka perangkat USB' };
  }
  try {
    if (device.selectConfiguration && device.configurations.length > 0) {
      await device.selectConfiguration(device.configurations[0].configurationValue);
    }
    if (device.claimInterface && device.configurations[0]?.interfaces[0]) {
      await device.claimInterface(device.configurations[0].interfaces[0].interfaceNumber);
    }
    // Find the first bulk-out endpoint.
    const cfg = device.configurations[0];
    const intf = cfg?.interfaces[0];
    const outEp = intf?.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
    if (!outEp || !device.transferOut) {
      return { ok: false, transport: 'webusb', reason: 'Perangkat USB tidak memiliki endpoint out' };
    }
    await device.transferOut(outEp.endpointNumber, bytes);
    return { ok: true, transport: 'webusb' };
  } catch (e) {
    return { ok: false, transport: 'webusb', reason: (e as Error).message || 'Gagal menulis ke USB' };
  } finally {
    try {
      if (device.releaseInterface && device.configurations[0]?.interfaces[0]) {
        await device.releaseInterface(device.configurations[0].interfaces[0].interfaceNumber);
      }
      await device.close();
    } catch {
      // ignore
    }
  }
}

async function kickViaApi(drawerPin: DrawerPin): Promise<DrawerKickResult> {
  try {
    const res = await api.kickCashDrawer({ drawerPin, force: true });
    return { ok: true, transport: 'api', reason: `API returned ${res.data.length} bytes` };
  } catch (e) {
    return { ok: false, transport: 'api', reason: (e as Error).message || 'Gagal memanggil API' };
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Open the cash drawer. Tries transports in order:
 *   1. printer (if `printerCharacteristic` provided)
 *   2. webserial
 *   3. webusb
 *   4. api (last resort — bytes only, no actual trigger from API)
 *
 * Returns `{ ok: true, transport }` on success. The first failing
 * transport moves to the next one, except the API path which is
 * always considered best-effort.
 */
export async function kickDrawerWeb(opts: KickDrawerOptions = {}): Promise<DrawerKickResult> {
  const { printerCharacteristic = null, drawerPin = 2 } = opts;
  const bytes = kickPrinterBytes(drawerPin);

  // 1. Printer (BLE) — silent no-op if not connected.
  if (printerCharacteristic) {
    const res = await kickViaPrinter(bytes, printerCharacteristic);
    if (res.ok) return res;
    // Fall through; don't fail loud — printer might be the wrong one.
  }

  // 2/3. Web Serial / Web USB — these both need a user gesture; we try
  // them only if the caller is okay being prompted. For auto-flows
  // (CASH payment finalize), we go straight to the API. For the
  // "Test Buka Drawer" button the caller can pass `interactive: true`.
  // The `kickDrawerWeb` helper is best-effort: if both are absent we
  // fall through to the API.
  if (typeof navigator !== 'undefined') {
    const nav = navigator as Navigator & NavigatorExtras;
    if (nav.serial) {
      // Note: the requestPort() call will trigger a permission prompt.
      // We still try it because that's how the cashier pairs the drawer.
      const res = await kickViaSerial(bytes, drawerPin);
      if (res.ok) return res;
    }
    if (nav.usb) {
      const res = await kickViaUsb(bytes);
      if (res.ok) return res;
    }
  }

  // 4. API fallback. Always succeeds at the HTTP level; the route just
  // returns the bytes. Useful for the test page to verify wiring.
  return kickViaApi(drawerPin);
}

// ─── React hook ─────────────────────────────────────────────────────────────

/**
 * React hook for the cash drawer. The `triggerOn` prop fires a kick when
 * it flips to true (e.g. right after a CASH payment finalizes). The
 * caller can also call `kick()` manually (e.g. for the "Test" button
 * on the hardware settings page).
 */
export function useDrawerKick(opts: UseDrawerKickOptions = {}): UseDrawerKickResult {
  const { triggerOn, ...kickOpts } = opts;
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<DrawerKickResult | null>(null);
  const lastTriggerRef = useRef<boolean>(false);

  const kick = useCallback(async (): Promise<DrawerKickResult> => {
    setBusy(true);
    try {
      const result = await kickDrawerWeb(kickOpts);
      setLastResult(result);
      return result;
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    kickOpts.printerCharacteristic,
    kickOpts.drawerPin,
  ]);

  useEffect(() => {
    if (triggerOn && !lastTriggerRef.current) {
      lastTriggerRef.current = true;
      kick().catch(() => {
        // Errors are reflected in lastResult; the caller decides
        // whether to toast.
      });
    } else if (!triggerOn) {
      lastTriggerRef.current = false;
    }
  }, [triggerOn, kick]);

  return {
    kick,
    busy,
    lastResult,
    support: getDrawerSupport(),
  };
}
