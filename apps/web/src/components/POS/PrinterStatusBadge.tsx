'use client';

// Sprint 14 — Compact printer status badge for the POS header.
// Shows 4 states:
//   - unsupported:  "✕ BT"  (browser can't do Web Bluetooth)
//   - connected:    "✓ MTP-58"  (device name)
//   - disconnected: "○ MTP-58"  (last known, currently gatt-lost)
//   - never paired: "○ —"  (no history)
//
// Click opens a dropdown with Connect / Disconnect / Test Print / Forget
// actions. The dropdown is intentionally minimal — full pairing UI lives
// in /pos/settings/hardware. This is the quick-access shortcut.

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePrinter } from '@/contexts/PrinterContext';
import { toast } from 'sonner';

export function PrinterStatusBadge() {
  const {
    connection,
    lastDeviceName,
    supported,
    busy,
    error,
    lastDisconnect,
    connect,
    disconnect,
    testPrint,
    forgetDevice,
    inspectGatt,
  } = usePrinter();
  const [open, setOpen] = useState(false);
  const [inspectReport, setInspectReport] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const handleConnect = async () => {
    setOpen(false);
    await connect();
  };
  // Fallback for printers (NYK L6 and other Chinese 58mm clones) that
  // advertise a non-standard GATT service and don't show up in the
  // default filter. Asks Chrome to list ALL nearby BLE devices.
  const handleConnectAll = async () => {
    setOpen(false);
    await connect({ unfiltered: true });
  };
  // Debug — open device picker, connect, dump ALL GATT services +
  // characteristics, show the report in a copyable textarea. Paste
  // this back to ops when a printer model is misbehaving. This is
  // the fastest way to know if a SPP+BLE hybrid printer (e.g. NYK
  // L6) actually exposes ESC/POS commands over BLE, or only via
  // classic SPP (which Web Bluetooth does not support).
  const handleInspect = async () => {
    setOpen(false);
    const report = await inspectGatt();
    setInspectReport(report);
  };
  const handleCopyInspect = async () => {
    if (!inspectReport) return;
    try {
      await navigator.clipboard.writeText(inspectReport);
      toast.success('Inspect report disalin ke clipboard');
    } catch {
      toast.error('Gagal salin ke clipboard');
    }
  };
  const handleDisconnect = () => {
    setOpen(false);
    disconnect();
  };
  const handleTest = async () => {
    setOpen(false);
    const ok = await testPrint();
    if (ok) toast.success('Test print terkirim ke printer');
  };
  const handleForget = () => {
    setOpen(false);
    forgetDevice();
    toast.success('Device dilupakan. Pair ulang untuk menghubungkan.');
  };

  // Status derivation.
  let dot = '○';
  let label = '—';
  let tone: 'muted' | 'success' | 'warning' | 'danger' = 'muted';
  if (!supported) {
    dot = '✕';
    label = 'BT tidak didukung';
    tone = 'danger';
  } else if (connection) {
    dot = '✓';
    label = connection.device.name || 'Printer';
    tone = 'success';
  } else if (lastDeviceName && lastDisconnect === 'gatt-lost') {
    dot = '⚠';
    label = `${lastDeviceName} (terputus)`;
    tone = 'warning';
  } else if (lastDeviceName) {
    dot = '○';
    label = lastDeviceName;
    tone = 'muted';
  } else {
    dot = '○';
    label = 'Belum pair';
    tone = 'muted';
  }

  const dotColor =
    tone === 'success'
      ? 'bg-emerald-400'
      : tone === 'warning'
        ? 'bg-amber-400'
        : tone === 'danger'
          ? 'bg-rose-500'
          : 'bg-neutral-500';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900/60 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
        title={
          error ||
          (connection
            ? `Terhubung: ${connection.device.name || 'printer'}`
            : lastDeviceName
              ? `Terakhir: ${lastDeviceName}`
              : 'Belum pernah pair')
        }
      >
        <span className={`h-2 w-2 rounded-full ${dotColor}`} aria-hidden />
        <span className="font-mono">{dot}</span>
        <span className="hidden md:inline">Printer:</span>
        <span className="max-w-[120px] truncate">{label}</span>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-60 rounded-md border border-neutral-700 bg-neutral-900 p-2 text-sm shadow-lg">
          <div className="mb-1.5 px-1 text-[10px] uppercase tracking-wide text-neutral-500">
            Printer Bluetooth
          </div>
          {!supported && (
            <div className="px-1 py-2 text-xs text-rose-300">
              Browser tidak mendukung Web Bluetooth. Pakai Chrome desktop atau
              Android Chrome.
            </div>
          )}
          {supported && connection && (
            <div className="px-1 py-1 text-xs text-neutral-400">
              Terhubung ke <span className="font-mono text-emerald-300">{connection.device.name || '(tanpa nama)'}</span>
            </div>
          )}
          {supported && !connection && lastDeviceName && (
            <div className="px-1 py-1 text-xs text-neutral-400">
              Terakhir: <span className="font-mono">{lastDeviceName}</span>
            </div>
          )}
          {error && (
            <div className="mx-1 mb-1.5 mt-1 rounded border border-rose-700 bg-rose-950/50 px-2 py-1 text-xs text-rose-200">
              {error}
            </div>
          )}
          <div className="space-y-1">
            {supported && !connection && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleConnect}
                  className="w-full rounded px-2 py-1.5 text-left text-xs text-emerald-300 hover:bg-neutral-800 disabled:opacity-50"
                >
                  {busy ? 'Menghubungkan…' : 'Hubungkan Printer BT'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleConnectAll}
                  className="w-full rounded px-2 py-1.5 text-left text-xs text-neutral-400 hover:bg-neutral-800 disabled:opacity-50"
                  title="Tampilkan semua device BLE (untuk printer NYK L6 dan 58mm China yang advertise service non-standar)"
                >
                  Cari semua device…
                </button>
              </>
            )}
            {supported && connection && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleTest}
                  className="w-full rounded px-2 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                >
                  🖨 Test Print
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="w-full rounded px-2 py-1.5 text-left text-xs text-amber-300 hover:bg-neutral-800"
                >
                  Putuskan
                </button>
              </>
            )}
            {supported && lastDeviceName && !connection && (
              <button
                type="button"
                onClick={handleForget}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-neutral-400 hover:bg-neutral-800"
              >
                Lupakan Device
              </button>
            )}
            <Link
              href="/pos/settings/hardware"
              onClick={() => setOpen(false)}
              className="block rounded px-2 py-1.5 text-left text-xs text-neutral-400 hover:bg-neutral-800"
            >
              Buka Settings Hardware →
            </Link>
            {/* Debug: GATT inspector. Hidden in normal flow — only shows
                when an inspectReport is loaded. Useful for diagnosing
                SPP+BLE hybrid printers (NYK L6 etc.) where the standard
                service filters show 0 results. */}
            <button
              type="button"
              disabled={busy}
              onClick={handleInspect}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-sky-300 hover:bg-neutral-800 disabled:opacity-50"
              title="Dump semua GATT services + characteristics dari printer. Paste ke ops untuk diagnosa."
            >
              🔍 Inspect GATT…
            </button>
          </div>
        </div>
      )}
      {/* Inspect GATT report — rendered as a top-level modal-ish panel
          outside the dropdown so it's readable. Copyable. */}
      {inspectReport && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-neutral-700 bg-neutral-900 p-4 shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-100">
                GATT Inspector Report
              </h3>
              <button
                type="button"
                onClick={() => setInspectReport(null)}
                className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
              >
                Tutup
              </button>
            </div>
            <p className="mb-2 text-[11px] text-neutral-500">
              Salin teks ini dan kirim ke tim dev. Membantu diagnosa printer
              SPP+BLE (NYK L6 dll) yang ga expose writable characteristic
              standar.
            </p>
            <textarea
              readOnly
              value={inspectReport}
              className="h-64 w-full rounded border border-neutral-700 bg-neutral-950 p-2 font-mono text-[11px] text-neutral-200"
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleCopyInspect}
                className="rounded border border-neutral-700 bg-neutral-800 px-3 py-1 text-xs text-neutral-100 hover:bg-neutral-700"
              >
                Salin
              </button>
              <button
                type="button"
                onClick={() => setInspectReport(null)}
                className="rounded bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-500"
              >
                Selesai
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
