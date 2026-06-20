// apps/web/src/lib/barcode-scanner.ts
//
// Sprint 8.11 — Barcode scanner integration.
//
// Two input paths are supported:
//
//   1. Web Bluetooth — for BT scanners configured in "non-HID" mode. We
//      request a generic HID-like service and listen for value updates.
//      Most cheap BT barcode scanners (e.g. the GM019, Inateck BCST-70) sit
//      on a custom service; we expose a few common ones as filters and
//      accept any connectable device the user picks.
//
//   2. Keyboard wedge — the dominant mode. A HID scanner just types the
//      barcode into the focused element followed by Enter. We listen for
//      rapid key sequences that end in Enter and emit them as scans. The
//      threshold (~50ms between keys) cleanly separates human typing from
//      scanner bursts.
//
// The `useBarcodeScanner()` React hook ties both paths together and calls
// the supplied `onScan` handler exactly once per scan. Cleanup removes all
// listeners and disconnects any active BT device.
//
// Browser support is best-effort: every path is feature-detected and we
// silently no-op on unsupported platforms. We never throw from a hook
// initializer.
//
// NOTE: the Web Bluetooth API is not in the standard TS `dom` lib, so we
// declare minimal local interfaces and feature-detect via duck-typing.
// We never assume the runtime is Chrome — we test for `navigator.bluetooth`
// before touching any of these.

import { useEffect, useRef, useState } from 'react';

// ─── Local Web Bluetooth types ──────────────────────────────────────────────
//
// The standard TS `dom` lib DOES include the Web Bluetooth spec in modern
// versions, but its interfaces are slightly different from what we need
// (e.g. `BluetoothDevice` requires an `id` field). To avoid collisions and
// keep this file portable, we declare minimal LOCAL interfaces and cast
// at the boundary. Runtime check is `'bluetooth' in navigator`.

interface LocalBTCharacteristic {
  uuid: string;
  value?: DataView;
  startNotifications(): Promise<LocalBTCharacteristic>;
  stopNotifications(): Promise<LocalBTCharacteristic>;
  addEventListener(type: 'characteristicvaluechanged', listener: (this: LocalBTCharacteristic, ev: Event) => void): void;
  removeEventListener(type: 'characteristicvaluechanged', listener: (this: LocalBTCharacteristic, ev: Event) => void): void;
}
interface LocalBTService {
  getCharacteristic(uuid: string): Promise<LocalBTCharacteristic>;
}
interface LocalBTGATTServer {
  connected: boolean;
  connect(): Promise<LocalBTGATTServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<LocalBTService>;
}
interface LocalBTDevice {
  gatt?: LocalBTGATTServer;
  name?: string;
  addEventListener(type: 'gattserverdisconnected', listener: (this: LocalBTDevice, ev: Event) => void): void;
  removeEventListener(type: 'gattserverdisconnected', listener: (this: LocalBTDevice, ev: Event) => void): void;
}
interface LocalBluetooth {
  requestDevice(opts: unknown): Promise<LocalBTDevice>;
}

// ─── Public types ───────────────────────────────────────────────────────────

export interface BarcodeScanEvent {
  /** The decoded barcode string. Whitespace is trimmed. */
  barcode: string;
  /** Which input path produced this scan. */
  source: 'bluetooth' | 'wedge';
  /** ms since epoch when the scan completed. */
  timestamp: number;
}

export type BarcodeScanHandler = (event: BarcodeScanEvent) => void;

export interface BarcodeScannerSupport {
  /** Web Bluetooth path available (Chrome / Edge / Opera). */
  bluetooth: boolean;
  /** Keyboard wedge path is always available on real browsers. */
  wedge: boolean;
  /** True if any path is usable. */
  any: boolean;
}

/**
 * Service / characteristic UUIDs we try in order. The first one the device
 * exposes wins. We don't need a stable characteristic — readValue also
 * works for barcode scanners that broadcast on a notify channel.
 */
const BT_SERVICE_CANDIDATES: Array<{ service: string; characteristic: string }> = [
  // Nordic UART-style profile (HM-10 / clones).
  { service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', characteristic: '6e400003-b5a3-f393-e0a9-e50e24dcca9e' },
  // Some Chinese scanners expose a "barcode" service on the standard
  // Battery / Device Info 0x180F / 0x180A range.
  { service: '0000fff0-0000-1000-8000-00805f9b34fb', characteristic: '0000fff1-0000-1000-8000-00805f9b34fb' },
  // Generic HID-over-GATT (rare on these devices but cheap to try).
  { service: 'human-interface-device', characteristic: '2a4d' },
];

const WEDGE_MAX_INTERVAL_MS = 50; // max gap between keys for a "scan burst"
const WEDGE_BUFFER_RESET_MS = 200; // buffer reset if we go quiet this long
const WEDGE_MIN_LENGTH = 4; // barcodes shorter than 4 chars are noise

// ─── Feature detection ──────────────────────────────────────────────────────

export function isBarcodeScannerSupported(): BarcodeScannerSupport {
  if (typeof navigator === 'undefined') {
    return { bluetooth: false, wedge: false, any: false };
  }
  const bluetooth = 'bluetooth' in navigator;
  // Keyboard wedge is always available in any real browser. SSR / node
  // test envs don't have `addEventListener` on `window`, so guard.
  const wedge = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  return { bluetooth, wedge, any: bluetooth || wedge };
}

// ─── Low-level helpers ──────────────────────────────────────────────────────

/**
 * Decode a BLE value buffer to a string. Most BT scanners send ASCII; we
 * also try a UTF-8 decode for the few that emit latin-1 / UTF-8 directly.
 */
function decodeBleValue(value: DataView): string {
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim();
  } catch {
    // Fallback for very old browsers without TextDecoder.
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s.trim();
  }
}

// ─── React hook ─────────────────────────────────────────────────────────────

export interface UseBarcodeScannerOptions {
  /** Called for every accepted scan. */
  onScan: BarcodeScanHandler;
  /**
   * Whether to also enable the keyboard-wedge listener. Defaults to true.
   * Set to false if you want to scope wedge to a specific input element
   * (use the standalone `attachWedgeListener` for that).
   */
  enableWedge?: boolean;
  /**
   * Whether to enable the Web Bluetooth path. Default false — BT requests
   * must be triggered by a user gesture, so the hook can't open the picker
   * on its own. Use `requestBluetoothScanner()` to open the picker.
   */
  enableBluetooth?: boolean;
}

export interface UseBarcodeScannerResult extends BarcodeScannerSupport {
  /**
   * Trigger the Web Bluetooth device picker. Must be called from a user
   * gesture (e.g. a button click). Resolves once a connection is opened
   * and listening; rejects on user cancel or browser error.
   */
  requestBluetoothScanner: () => Promise<void>;
  /** Disconnect the active BT scanner (if any). */
  disconnectBluetooth: () => void;
  /** True when a BT scanner is currently connected. */
  bluetoothConnected: boolean;
  /** Last error from the BT path (cleared on success). */
  bluetoothError: string | null;
}

/**
 * React hook that wires both Bluetooth and keyboard-wedge barcode paths
 * into a single `onScan` handler. The wedge listener is attached to
 * `window` and the BT listener is opt-in via `requestBluetoothScanner()`.
 */
export function useBarcodeScanner(opts: UseBarcodeScannerOptions): UseBarcodeScannerResult {
  const { onScan, enableWedge = true, enableBluetooth = false } = opts;
  const support = isBarcodeScannerSupported();

  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const btDeviceRef = useRef<LocalBTDevice | null>(null);
  const btCharRef = useRef<LocalBTCharacteristic | null>(null);
  const btCharHandlerRef = useRef<((ev: Event) => void) | null>(null);
  const [bluetoothConnected, setBluetoothConnected] = useState(false);
  const [bluetoothError, setBluetoothError] = useState<string | null>(null);

  // Wedge listener — installed once on mount, torn down on unmount.
  useEffect(() => {
    if (!enableWedge || !support.wedge) return;
    return attachWedgeListener((barcode) => {
      onScanRef.current({ barcode, source: 'wedge', timestamp: Date.now() });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableWedge, support.wedge]);

  // Bluetooth auto-init. Off by default — the user has to call the
  // returned function to open the picker. We just keep the refs warm.
  useEffect(() => {
    if (!enableBluetooth) return;
    // No-op: BT requires user gesture. The hook returns a function
    // the caller can wire to a button.
  }, [enableBluetooth]);

  // Cleanup on unmount: drop the BT device if connected.
  useEffect(() => {
    return () => {
      if (btDeviceRef.current?.gatt?.connected) {
        try {
          btDeviceRef.current.gatt.disconnect();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const requestBluetoothScanner = async (): Promise<void> => {
    setBluetoothError(null);
    if (typeof navigator === 'undefined' || !navigator.bluetooth) {
      setBluetoothError('Web Bluetooth tidak didukung di browser ini.');
      throw new Error('Web Bluetooth unsupported');
    }
    const bt = navigator.bluetooth as unknown as LocalBluetooth;
    let device: LocalBTDevice;
    try {
      device = await bt.requestDevice({
        // Accept any device that exposes one of the common scanner
        // services. We also let the user pick "Other device" — every
        // cheap BT scanner can be selected this way.
        filters: BT_SERVICE_CANDIDATES.map((c) => ({ services: [c.service] })),
        optionalServices: BT_SERVICE_CANDIDATES.map((c) => c.service),
        acceptAllDevices: true,
      });
    } catch (e) {
      const msg = (e as Error).message || 'Pemilihan perangkat dibatalkan.';
      setBluetoothError(msg);
      throw e;
    }

    if (!device.gatt) {
      setBluetoothError('Perangkat tidak memiliki GATT server.');
      throw new Error('No GATT');
    }
    let server: LocalBTGATTServer;
    try {
      server = await device.gatt.connect();
    } catch (e) {
      const msg = (e as Error).message || 'Gagal terhubung ke scanner.';
      setBluetoothError(msg);
      throw e;
    }

    // Try each candidate service+characteristic until one yields a usable
    // notifier. We stop at the first one that works.
    let lastErr: unknown = null;
    for (const cand of BT_SERVICE_CANDIDATES) {
      try {
        const service = await server.getPrimaryService(cand.service);
        const characteristic = await service.getCharacteristic(cand.characteristic);
        // We need notifications to fire on each scan.
        try {
          await characteristic.startNotifications();
        } catch {
          // Some characteristics only support read. We'll attach a
          // fallback below in case notifications aren't supported.
        }
        const handleValueChange = (event: Event) => {
          const target = event.target as unknown as LocalBTCharacteristic;
          if (!target.value) return;
          const barcode = decodeBleValue(target.value);
          if (barcode.length >= WEDGE_MIN_LENGTH) {
            onScanRef.current({ barcode, source: 'bluetooth', timestamp: Date.now() });
          }
        };
        characteristic.addEventListener('characteristicvaluechanged', handleValueChange);
        btCharRef.current = characteristic;
        btCharHandlerRef.current = handleValueChange;
        btDeviceRef.current = device;
        setBluetoothConnected(true);
        setBluetoothError(null);
        device.addEventListener('gattserverdisconnected', () => {
          setBluetoothConnected(false);
        });
        return;
      } catch (e) {
        lastErr = e;
        // try the next candidate
      }
    }
    // No service worked. Roll back the connection.
    try {
      server.disconnect();
    } catch {
      // ignore
    }
    const msg = (lastErr as Error)?.message || 'Tidak dapat menemukan layanan scanner.';
    setBluetoothError(msg);
    throw new Error(msg);
  };

  const disconnectBluetooth = (): void => {
    if (btCharRef.current) {
      try {
        if (btCharHandlerRef.current) {
          btCharRef.current.removeEventListener('characteristicvaluechanged', btCharHandlerRef.current);
          btCharHandlerRef.current = null;
        }
      } catch {
        // ignore
      }
      btCharRef.current = null;
    }
    if (btDeviceRef.current?.gatt?.connected) {
      try {
        btDeviceRef.current.gatt.disconnect();
      } catch {
        // ignore
      }
    }
    btDeviceRef.current = null;
    setBluetoothConnected(false);
  };

  return {
    ...support,
    requestBluetoothScanner,
    disconnectBluetooth,
    bluetoothConnected,
    bluetoothError,
  };
}

// ─── Standalone wedge listener ──────────────────────────────────────────────

/**
 * Attach a keyboard-wedge listener to `window`. Use this if you want
 * wedge capture scoped globally (outside the React hook). Returns a
 * cleanup function that removes the listener.
 *
 * Behaviour: a buffer accumulates printable characters. If the gap
 * between two consecutive keys exceeds WEDGE_MAX_INTERVAL_MS, the
 * buffer is treated as regular typing and reset. The buffer is
 * emitted on Enter, with a guard that the resulting string is at
 * least WEDGE_MIN_LENGTH characters long (filters out accidental
 * single-key bursts from the Enter key alone).
 */
export function attachWedgeListener(handler: (barcode: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  let buffer = '';
  let lastKeyAt = 0;
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReset = () => {
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      buffer = '';
    }, WEDGE_BUFFER_RESET_MS);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Don't capture while modifier keys are held — that would steal
    // legitimate Ctrl/Alt shortcuts.
    if (event.ctrlKey || event.metaKey || event.altKey) {
      buffer = '';
      return;
    }
    const now = event.timeStamp || Date.now();
    const gap = now - lastKeyAt;
    lastKeyAt = now;

    if (event.key === 'Enter') {
      const value = buffer.trim();
      buffer = '';
      if (resetTimer) clearTimeout(resetTimer);
      if (value.length >= WEDGE_MIN_LENGTH) {
        // Don't preventDefault — let the form submit / button activate
        // happen normally. The handler is a notification, not a hijack.
        handler(value);
      }
      return;
    }

    // Single-character key (letter, digit, symbol). Anything longer
    // (e.g. 'Tab', 'Escape') breaks the burst.
    if (event.key.length !== 1) {
      buffer = '';
      return;
    }

    // Reset if the gap looks like normal human typing.
    if (gap > WEDGE_MAX_INTERVAL_MS && buffer.length > 0) {
      buffer = '';
    }
    buffer += event.key;
    scheduleReset();
  };

  window.addEventListener('keydown', onKeyDown);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    if (resetTimer) clearTimeout(resetTimer);
    buffer = '';
  };
}

// ─── Server-side barcode lookup ─────────────────────────────────────────────

import { api, type MenuItem } from './api';

/**
 * Look up a menu item by barcode in the active branch. The API route
 * (`GET /api/menu/items/by-barcode/:barcode`) is the source of truth —
 * we don't replicate the lookup logic on the client. Returns null on
 * 404 / network error so callers can decide whether to surface a toast.
 */
export async function lookupBarcode(barcode: string): Promise<MenuItem | null> {
  const trimmed = barcode.trim();
  if (!trimmed) return null;
  try {
    const res = await api.getMenuItemByBarcode(trimmed);
    return res.data;
  } catch {
    return null;
  }
}
