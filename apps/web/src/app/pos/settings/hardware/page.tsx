'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { useDrawerKick, getDrawerSupport, kickDrawerWeb } from '@/lib/cash-drawer';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { usePrinter } from '@/contexts/PrinterContext';

export default function HardwareSettingsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [drawerPin, setDrawerPin] = useState<2 | 5>(2);
  const [onTime, setOnTime] = useState<number>(25);
  const [offTime, setOffTime] = useState<number>(25);
  const [info, setInfo] = useState<{
    pins: Array<2 | 5>;
    defaultPin: 2 | 5;
    pulseUnitMs: number;
    defaultOnTime: number;
    defaultOffTime: number;
    minPulse: number;
    maxPulse: number;
    escposSequence: string;
    transportOptions: Array<{ kind: string; label: string }>;
  } | null>(null);
  const [lastApiResponse, setLastApiResponse] = useState<string | null>(null);
  const [apiBusy, setApiBusy] = useState(false);

  const support = typeof window !== 'undefined' ? getDrawerSupport() : { bluetooth: false, serial: false, usb: false };
  const drawerKick = useDrawerKick({ drawerPin });

  // Sprint 14 — printer connection state from the shared context.
  const printer = usePrinter();
  const [printerPrefix, setPrinterPrefix] = useState<string>('');
  const [savingPrefix, setSavingPrefix] = useState(false);

  // Hydrate the name prefix input from the context (which itself pulled
  // it from /api/settings on mount).
  useEffect(() => {
    setPrinterPrefix(printer.namePrefix);
  }, [printer.namePrefix]);

  const handleSavePrefix = useCallback(async () => {
    setSavingPrefix(true);
    try {
      await api.upsertSetting('PRINTER_NAME_PREFIX', printerPrefix, undefined);
      await printer.refreshNamePrefix();
      toast.success('Name prefix disimpan');
    } catch (e) {
      toast.error((e as Error).message || 'Gagal menyimpan');
    } finally {
      setSavingPrefix(false);
    }
  }, [printerPrefix, printer]);

  const handleTestPrint = useCallback(async () => {
    const ok = await printer.testPrint();
    if (ok) toast.success('Test print terkirim');
  }, [printer]);

  const handleConnect = useCallback(async () => {
    await printer.connect();
  }, [printer]);

  const handleDisconnect = useCallback(() => {
    printer.disconnect();
    toast.info('Printer diputuskan');
  }, [printer]);

  // Route guard: OWNER + MANAGER only.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
      router.push('/pos');
    }
  }, [user, authLoading, router]);

  // Pull /api/cash-drawer/info on mount for the dropdown options.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.getCashDrawerInfo();
        if (!cancelled) setInfo(r.data);
      } catch {
        // ignore — the page is still usable without it
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTestDrawer = useCallback(async () => {
    toast.info('Membuka drawer…');
    // Try local transports first (printer BLE / Web Serial / Web USB).
    const result = await drawerKick.kick();
    if (result.ok) {
      toast.success(`Drawer dibuka via ${result.transport}`);
      return;
    }
    // Fall back to the API endpoint so the cashier at least sees the
    // bytes they're supposed to write. The API call is fire-and-forget
    // for diagnostics — it doesn't actually open anything, it just
    // returns the byte sequence.
    setApiBusy(true);
    try {
      const r = await api.kickCashDrawer({
        drawerPin,
        onTime,
        offTime,
        force: true,
      });
      setLastApiResponse(
        `Length: ${r.data.length} bytes\nPin: ${r.data.drawerPin}\nonTime: ${r.data.onTime}\noffTime: ${r.data.offTime}\nHex: ${r.data.hex}\nBase64: ${r.data.bytesBase64}`,
      );
      toast.warning(
        `Tidak ada transport lokal yang berhasil (${result.reason ?? 'tidak diketahui'}). Lihat hex di bawah untuk debugging.`,
      );
    } catch (e) {
      const msg = (e as Error).message || 'Gagal memanggil API';
      toast.error(msg);
    } finally {
      setApiBusy(false);
    }
  }, [drawerKick, drawerPin, onTime, offTime]);

  const handleApiOnly = useCallback(async () => {
    setApiBusy(true);
    try {
      const r = await api.kickCashDrawer({
        drawerPin,
        onTime,
        offTime,
        force: true,
      });
      setLastApiResponse(
        `Length: ${r.data.length} bytes\nPin: ${r.data.drawerPin}\nonTime: ${r.data.onTime}\noffTime: ${r.data.offTime}\nHex: ${r.data.hex}\nBase64: ${r.data.bytesBase64}`,
      );
      toast.success('Bytes diterima dari API');
    } catch (e) {
      const msg = (e as Error).message || 'Gagal memanggil API';
      toast.error(msg);
    } finally {
      setApiBusy(false);
    }
  }, [drawerPin, onTime, offTime]);

  // Quick sanity check the kicker is wired correctly — we can call
  // kickDrawerWeb directly to verify the bytes it produces.
  // `interactive: true` is required for the Web Serial/USB pickers
  // to appear. The auto-flow (CASH payment) deliberately does NOT
  // pass this, so it skips straight to the API.
  const handleVerifyBytes = useCallback(() => {
    void kickDrawerWeb({ drawerPin, interactive: true }).then((res) => {
      if (res.ok) {
        toast.success(`Bytes terkirim via ${res.transport}`);
      } else {
        toast.warning(res.reason ?? 'Tidak ada transport yang cocok');
      }
    });
  }, [drawerPin]);

  if (authLoading) {
    return <div className="p-4 text-sm text-neutral-500 dark:text-neutral-400">Memuat…</div>;
  }
  if (!user) return null;

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Hardware</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
          Konfigurasi printer thermal, cash drawer, dan barcode scanner.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cash Drawer</CardTitle>
          <CardDescription>
            Drawer terhubung ke printer via RJ12. Default: buka otomatis tiap
            pembayaran tunai. Anda bisa override dengan{' '}
            <code className="text-neutral-700 dark:text-neutral-300">drawerKick</code> di receipt builder.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge tone={support.bluetooth ? 'success' : 'muted'}>
              Web Bluetooth: {support.bluetooth ? '✓' : '—'}
            </Badge>
            <Badge tone={support.serial ? 'success' : 'muted'}>
              Web Serial: {support.serial ? '✓' : '—'}
            </Badge>
            <Badge tone={support.usb ? 'success' : 'muted'}>
              Web USB: {support.usb ? '✓' : '—'}
            </Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-neutral-500 dark:text-neutral-400 block mb-1">Pin</label>
              <select
                value={drawerPin}
                onChange={(e) => setDrawerPin(Number(e.target.value) === 5 ? 5 : 2)}
                className="w-full h-9 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-sm text-neutral-900 dark:text-neutral-100"
              >
                {(info?.pins ?? [2, 5]).map((p) => (
                  <option key={p} value={p}>
                    Pin {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500 dark:text-neutral-400 block mb-1">
                onTime (×{info?.pulseUnitMs ?? 2}ms)
              </label>
              <Input
                type="number"
                min={info?.minPulse ?? 1}
                max={info?.maxPulse ?? 255}
                value={onTime}
                onChange={(e) => setOnTime(Math.max(1, Math.min(255, Number(e.target.value) || 1)))}
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500 dark:text-neutral-400 block mb-1">
                offTime (×{info?.pulseUnitMs ?? 2}ms)
              </label>
              <Input
                type="number"
                min={info?.minPulse ?? 1}
                max={info?.maxPulse ?? 255}
                value={offTime}
                onChange={(e) => setOffTime(Math.max(1, Math.min(255, Number(e.target.value) || 1)))}
              />
            </div>
          </div>

          <div className="text-xs text-neutral-500">
            ESC/POS: <code>{info?.escposSequence ?? '\\x1B \\x70 <pin> <onTime> <offTime>'}</code>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              variant="primary"
              onClick={handleTestDrawer}
              disabled={drawerKick.busy || apiBusy}
            >
              {drawerKick.busy || apiBusy ? 'Membuka…' : 'Buka Drawer (Test)'}
            </Button>
            <Button
              variant="outline"
              onClick={handleVerifyBytes}
              disabled={drawerKick.busy}
            >
              Cek Transport Lokal
            </Button>
            <Button
              variant="ghost"
              onClick={handleApiOnly}
              disabled={apiBusy}
            >
              Ambil Bytes (API Only)
            </Button>
          </div>

          {lastApiResponse && (
            <pre className="mt-3 text-xs bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-md p-3 text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-all">
              {lastApiResponse}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Barcode Scanner</CardTitle>
          <CardDescription>
            Scanner HID (keyboard wedge) otomatis aktif — cukup arahkan kursor ke
            aplikasi lalu scan. Scanner Bluetooth (non-HID) perlu di-pair via
            halaman POS (tombol "Pasang Scanner BT" di header menu).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            Setiap menu item bisa diisi field <code className="text-neutral-900 dark:text-neutral-100">barcode</code> di halaman Menu.
            Pastikan barcode unik per branch.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Printer Bluetooth</CardTitle>
          <CardDescription>
            Printer thermal ESC/POS terhubung via Web Bluetooth. Setiap kali buka
            POS di browser baru, perlu di-pair ulang (Chrome tidak izinkan pair
            otomatis karena privacy).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={printer.supported ? 'success' : 'danger'}>
              Web Bluetooth: {printer.supported ? '✓ Didukung' : '✕ Tidak'}
            </Badge>
            {printer.connection && (
              <Badge tone="success">
                ✓ Terhubung: {printer.connection.device.name || '(tanpa nama)'}
              </Badge>
            )}
            {!printer.connection && printer.lastDeviceName && (
              <Badge tone={printer.lastDisconnect === 'gatt-lost' ? 'muted' : 'muted'}>
                {printer.lastDisconnect === 'gatt-lost' ? '⚠' : '○'}{' '}
                {printer.lastDeviceName}
              </Badge>
            )}
            {!printer.connection && !printer.lastDeviceName && (
              <Badge tone="muted">Belum pernah pair</Badge>
            )}
          </div>

          {printer.error && (
            <div className="rounded-md border border-rose-700 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
              {printer.error}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {!printer.connection ? (
              <Button
                onClick={handleConnect}
                disabled={printer.busy || !printer.supported}
              >
                {printer.busy ? 'Menghubungkan…' : 'Hubungkan Printer'}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={handleTestPrint}
                  disabled={printer.busy}
                >
                  🖨 Test Print
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleDisconnect}
                  disabled={printer.busy}
                >
                  Putuskan
                </Button>
              </>
            )}
            {printer.lastDeviceName && !printer.connection && (
              <Button
                variant="ghost"
                onClick={() => {
                  printer.forgetDevice();
                  toast.info('Device dilupakan');
                }}
              >
                Lupakan Device
              </Button>
            )}
          </div>

          <div className="border-t border-neutral-200 dark:border-neutral-800 pt-4 space-y-2">
            <div>
              <label className="text-xs font-medium text-neutral-600 dark:text-neutral-400 block mb-1">
                Name Prefix (filter Chrome picker)
              </label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={printerPrefix}
                  onChange={(e) => setPrinterPrefix(e.target.value)}
                  placeholder="MTP-, RPP, …"
                  maxLength={32}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  onClick={handleSavePrefix}
                  disabled={savingPrefix}
                >
                  {savingPrefix ? 'Menyimpan…' : 'Simpan'}
                </Button>
              </div>
              <p className="mt-1 text-[10px] text-neutral-500">
                Kosongkan untuk menampilkan semua printer. Misal "MTP-" agar Chrome
                cuma munculkan printer MTP series.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
