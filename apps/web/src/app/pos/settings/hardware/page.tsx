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
  const handleVerifyBytes = useCallback(() => {
    void kickDrawerWeb({ drawerPin }).then((res) => {
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
          <CardTitle className="text-base">Printer</CardTitle>
          <CardDescription>
            Printer thermal terhubung via Bluetooth. Hubungkan dari halaman POS
            sebelum transaksi pertama.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => router.push('/pos')}
          >
            Buka POS untuk Hubungkan Printer
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
