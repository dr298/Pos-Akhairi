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
  connect: () => Promise<void>;
  disconnect: () => void;
  // Run the ESC/POS self-test command. Only meaningful when connected.
  testPrint: () => Promise<boolean>;
  // Refresh the name prefix from /api/settings.
  refreshNamePrefix: () => Promise<void>;
  // Clear stored last-device-name (e.g. cashier wants to forget pairing).
  forgetDevice: () => void;
}

type PrinterContextValue = PrinterState & PrinterActions;

const STORAGE_KEY_DEVICE = 'pos.printer.lastDeviceName';
const STORAGE_KEY_PREFIX = 'pos.printer.namePrefix';

const PrinterContext = createContext<PrinterContextValue | null>(null);

export function PrinterProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<ConnectedPrinter | null>(null);
  const [lastDeviceName, setLastDeviceName] = useState<string | null>(null);
  const [supported] = useState<boolean>(() => isWebBluetoothSupported());
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
  const refreshNamePrefix = useCallback(async () => {
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
  }, []);

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

  const connect = useCallback(async () => {
    if (!supported) {
      setError('Browser tidak mendukung Web Bluetooth. Pakai Chrome desktop atau Android Chrome.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const conn = await connectPrinter({ namePrefix: namePrefix || undefined });
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
      // Write in chunks so the printer's tiny buffer doesn't drop bytes.
      const chunkSize = 100;
      for (let i = 0; i < data.length; i += chunkSize) {
        const slice = data.slice(i, Math.min(i + chunkSize, data.length));
        await conn.characteristic.writeValueWithoutResponse(slice);
        // small drain delay
        await new Promise((r) => setTimeout(r, 30));
      }
      return true;
    } catch (e) {
      const err = e as { message?: string };
      setError(`Test print gagal: ${err.message || 'unknown'}`);
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
