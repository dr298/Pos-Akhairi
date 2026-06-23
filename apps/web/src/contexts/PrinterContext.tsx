'use client';

// Sprint 14 — Printer connection context.
//
// Why a context (not just a hook in each page):
// - Multiple pages need printer status: /pos (header badge), /pos/success
//   (auto-print), /pos/settings/hardware (pairing UI). Without context
//   they'd all instantiate their own state and the BluetoothCharacteristic
//   handle wouldn't be shared — meaning the success page would have to
//   re-prompt the user even if hardware page just paired.
//
// Web Bluetooth is browser-state, not localStorage. We can't persist the
// device handle across page loads — Chrome deliberately revokes it when
// the page is closed. What we CAN persist:
//   - Last known device NAME (shown in the status badge so cashier sees
//     "Printer: MTP-58 (terputus)" instead of "Printer: Belum terhubung")
//   - Name prefix from settings (so picker filters stay consistent)
//
// On mount, we don't auto-reconnect (Chrome blocks that anyway — it must
// be a user gesture). We just show the last known name. User clicks
// "Hubungkan" → connectPrinter() → device handle stored in context.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  connectPrinter,
  isWebBluetoothSupported,
  type ConnectedPrinter,
} from '@/lib/bluetooth-printer';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

interface PrinterState {
  // Live Bluetooth device handle. Null when not connected.
  connection: ConnectedPrinter | null;
  // Last known device name (persisted in localStorage). Useful for the
  // status badge — we can show "Terputus dari MTP-58" vs "Belum pernah pair".
  lastDeviceName: string | null;
  // Web Bluetooth support flag (browser capability, not user choice).
  supported: boolean;
  // True while a connect/disconnect is in flight.
  busy: boolean;
  // Most recent error message (cleared on next action).
  error: string | null;
  // Pairing name prefix from /api/settings. Empty = no filter.
  namePrefix: string;
  // Last disconnect reason ("user" | "gatt-lost" | "error").
  lastDisconnect: 'user' | 'gatt-lost' | 'error' | null;
}

interface PrinterActions {
  connect: (opts?: { unfiltered?: boolean }) => Promise<void>;
  disconnect: () => void;
  // Run the ESC/POS self-test command. Only meaningful when connected.
  testPrint: () => Promise<boolean>;
  // Refresh the name prefix from /api/settings.
  refreshNamePrefix: () => Promise<void>;
  // Clear stored last-device-name (e.g. cashier wants to forget pairing).
  forgetDevice: () => void;
  // Debug: connect unfiltered and enumerate ALL primary services +
  // characteristics. Returns a human-readable report so the cashier
  // can paste it back to ops when a printer is misbehaving. Used for
  // diagnosing SPP-only / SPP+BLE hybrid printers (e.g. NYK L6).
  inspectGatt: () => Promise<string>;
}

type PrinterContextValue = PrinterState & PrinterActions;

const STORAGE_KEY_DEVICE = 'pos.printer.lastDeviceName';
const STORAGE_KEY_PREFIX = 'pos.printer.namePrefix';

const PrinterContext = createContext<PrinterContextValue | null>(null);

export function PrinterProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [connection, setConnection] = useState<ConnectedPrinter | null>(null);
  const [lastDeviceName, setLastDeviceName] = useState<string | null>(null);
  const [supported] = useState<boolean>(() => typeof navigator !== 'undefined' && !!navigator.bluetooth);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [namePrefix, setNamePrefix] = useState<string>('');
  const [lastDisconnect, setLastDisconnect] = useState<
    'user' | 'gatt-lost' | 'error' | null
  >(null);

  // Use a ref to access the current connection inside event handlers
  // (which capture the closure at registration time). We attach the
  // 'gattserverdisconnected' listener inside connect() so we don't need
  // to mess with refs here, but we keep a ref for the writeBytes helper.
  const connectionRef = useRef<ConnectedPrinter | null>(null);
  connectionRef.current = connection;

  // Hydrate from localStorage on mount.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY_DEVICE);
      if (stored) setLastDeviceName(stored);
      const storedPrefix = window.localStorage.getItem(STORAGE_KEY_PREFIX);
      if (storedPrefix) setNamePrefix(storedPrefix);
    } catch {
      // localStorage may be disabled (private browsing, sandboxed iframe)
    }
  }, []);

  // Pull authoritative name prefix from /api/settings on mount. The
  // localStorage copy is a cache so the picker filter is applied
  // immediately even before the fetch resolves.
  // Sprint 25.4 — /api/settings is OWNER/MANAGER only; CASHIER gets
  // 403. Skip the call for non-admin roles to avoid noisy 403s.
  const refreshNamePrefix = useCallback(async () => {
    // Only admin roles can read /api/settings
    if (user?.role !== 'OWNER' && user?.role !== 'MANAGER') return;
    try {
      const res = await api.listSettings();
      const row = res.data.settings.find((s) => s.key === 'PRINTER_NAME_PREFIX');
      if (row) {
        setNamePrefix(row.value);
        try {
          window.localStorage.setItem(STORAGE_KEY_PREFIX, row.value);
        } catch {
          // ignore
        }
      }
    } catch {
      // Network error — keep local copy if any.
    }
  }, [user?.role]);

  useEffect(() => {
    void refreshNamePrefix();
  }, [refreshNamePrefix]);

  const handleDisconnectEvent = useCallback(() => {
    const conn = connectionRef.current;
    if (conn) {
      try {
        conn.disconnect();
      } catch {
        // ignore
      }
    }
    setConnection(null);
    setLastDisconnect('gatt-lost');
    setError('Printer terputus dari Bluetooth (baterai / jarak / dimatikan)');
  }, []);

  // Default connect (filtered by service+namePrefix). The picker may
  // show 0 devices if the printer advertises a non-standard GATT
  // service — call `connect({ unfiltered: true })` from the UI to fall
  // back to "show all BLE devices" mode.
  const connect = useCallback(async (opts: { unfiltered?: boolean } = {}) => {
    if (!supported) {
      setError('Browser tidak mendukung Web Bluetooth. Pakai Chrome desktop atau Android Chrome.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const conn = await connectPrinter({
        namePrefix: namePrefix || undefined,
        unfiltered: opts.unfiltered,
      });
      // Attach disconnect listener.
      conn.device.addEventListener('gattserverdisconnected', handleDisconnectEvent);
      setConnection(conn);
      setLastDeviceName(conn.device.name || '(tanpa nama)');
      setLastDisconnect(null);
      try {
        window.localStorage.setItem(
          STORAGE_KEY_DEVICE,
          conn.device.name || '(tanpa nama)',
        );
      } catch {
        // ignore
      }
    } catch (e) {
      const err = e as { name?: string; message?: string };
      if (err.name === 'NotFoundError') {
        setError('Pemilihan printer dibatalkan.');
      } else {
        setError(err.message || 'Gagal menghubungkan printer.');
      }
    } finally {
      setBusy(false);
    }
  }, [supported, namePrefix, handleDisconnectEvent]);

  const disconnect = useCallback(() => {
    const conn = connectionRef.current;
    if (conn) {
      try {
        conn.disconnect();
      } catch {
        // ignore
      }
    }
    setConnection(null);
    setLastDisconnect('user');
    setError(null);
  }, []);

  const forgetDevice = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY_DEVICE);
    } catch {
      // ignore
    }
    setLastDeviceName(null);
  }, []);

  // GATT inspector — connects to any device (unfiltered), enumerates
  // all primary services + characteristics, returns a plain-text
  // report. Lets ops see what the printer actually exposes over BLE
  // (vs what we assume via the standard 0x18F0 service). For hybrid
  // SPP+BLE printers (NYK L6, etc.) this is the fastest way to know
  // whether ESC/POS commands can go over BLE at all, or only SPP
  // classic (which Web Bluetooth does NOT support).
  const inspectGatt = useCallback(async (): Promise<string> => {
    if (!supported || !navigator.bluetooth) {
      return 'Web Bluetooth not supported in this browser.';
    }
    const bt: Bluetooth = navigator.bluetooth;
    const lines: string[] = [];
    try {
      // Always unfiltered — we want to see everything the device offers.
      const device = await bt.requestDevice({
        acceptAllDevices: true,
        // No optionalServices — we'll discover them dynamically.
      });
      lines.push(`Device: ${device.name ?? '(no name)'}  id=${device.id}`);
      if (!device.gatt) {
        lines.push('No GATT server — this is a classic-only device.');
        return lines.join('\n');
      }
      const server = await device.gatt.connect();
      lines.push('GATT connected.');
      const services = await server.getPrimaryServices();
      lines.push(`Services (${services.length}):`);
      for (const svc of services) {
        lines.push(`  - ${svc.uuid}`);
        try {
          const chars = await svc.getCharacteristics();
          for (const ch of chars) {
            const props = [
              ch.properties.read && 'read',
              ch.properties.write && 'write',
              ch.properties.writeWithoutResponse && 'writeNoResp',
              ch.properties.notify && 'notify',
              ch.properties.indicate && 'indicate',
            ].filter(Boolean).join(',');
            lines.push(`      char ${ch.uuid}  [${props}]`);
          }
        } catch (e) {
          lines.push(`      (chars: error: ${(e as Error).message})`);
        }
      }
      // Disconnect — we only inspected.
      try { server.disconnect(); } catch { /* noop */ }
      lines.push('Disconnected.');
    } catch (e) {
      lines.push(`Error: ${(e as Error).message}`);
    }
    return lines.join('\n');
  }, [supported]);

  const testPrint = useCallback(async (): Promise<boolean> => {
    const conn = connectionRef.current;
    if (!conn) {
      setError('Belum ada printer terhubung. Hubungkan dulu.');
      return false;
    }
    try {
      // Lazy-load the escpos helper to avoid bundling the whole receipt
      // builder on pages that don't print.
      const { buildTestReceipt } = await import('@/lib/escpos');
      const data = buildTestReceipt();
      // BLE MTU is 20 bytes per packet by default. The Chrome
      // implementation does NOT auto-split writeValueWithoutResponse
      // payloads on all platforms (Android in particular throws
      // "GATT Data too large" if you exceed 20 bytes). Chunk to 20
      // bytes to be safe. We could request a larger MTU via
      // gatt.requestMtu(247), but for a few-kilobyte receipt the
      // round-trip overhead is negligible and 20-byte chunks are
      // universally supported.
      const chunkSize = 20;
      for (let i = 0; i < data.length; i += chunkSize) {
        const slice = data.slice(i, Math.min(i + chunkSize, data.length));
        await conn.characteristic.writeValueWithoutResponse(slice);
        // small drain delay so the printer's buffer doesn't overflow
        await new Promise((r) => setTimeout(r, 25));
      }
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Test print gagal: ${msg}`);
      return false;
    }
  }, []);

  // Cleanup on unmount: don't actually disconnect the printer — the
  // user may navigate to another page and want the connection to persist.
  // Chrome will auto-disconnect when the page closes.
  useEffect(() => {
    return () => {
      // intentionally do nothing
    };
  }, []);

  return (
    <PrinterContext.Provider
      value={{
        connection,
        lastDeviceName,
        supported,
        busy,
        error,
        namePrefix,
        lastDisconnect,
        connect,
        disconnect,
        testPrint,
        refreshNamePrefix,
        forgetDevice,
        inspectGatt,
      }}
    >
      {children}
    </PrinterContext.Provider>
  );
}

export function usePrinter(): PrinterContextValue {
  const ctx = useContext(PrinterContext);
  if (!ctx) {
    throw new Error('usePrinter must be used inside <PrinterProvider>');
  }
  return ctx;
}
