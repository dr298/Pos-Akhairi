'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type PrepSheet, type PrepSheetDetail, type PrepSheetItem } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { useAuth } from '@/hooks/useAuth';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
}

export default function PrepSheetsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [sheets, setSheets] = useState<PrepSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Generate form
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lookbackDays, setLookbackDays] = useState(14);
  const [notes, setNotes] = useState('');
  const [generating, setGenerating] = useState(false);

  // Detail view
  const [selected, setSelected] = useState<PrepSheetDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.listPrepSheets({});
      setSheets(r.data.prepSheets);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
      router.replace('/pos');
      return;
    }
    void load();
  }, [user, router, load]);

  const onGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    setError(null);
    try {
      const r = await api.generatePrepSheet({
        date,
        lookbackDays,
        notes: notes.trim() || null,
      });
      setSelected(r.data);
      setNotes('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const onSelect = async (s: PrepSheet) => {
    setDetailLoading(true);
    setError(null);
    try {
      const r = await api.getPrepSheet(s.id);
      setSelected(r.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  };

  const onPrint = () => {
    if (typeof window !== 'undefined') window.print();
  };

  if (!user) return null;

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-3 max-w-screen-2xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Prep Sheet (Kitchen)</h1>
          <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
            Panduan prep harian untuk dapur berdasarkan pola penjualan
          </p>
        </div>
      </header>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded p-3 text-red-200 text-sm print:hidden">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 print:hidden">
        <Card>
          <CardHeader>
            <CardTitle>Generate Prep Sheet</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onGenerate} className="space-y-3">
              <div>
                <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Tanggal</label>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">
                  Lookback (hari)
                </label>
                <Input
                  type="number"
                  min={3}
                  max={60}
                  value={lookbackDays}
                  onChange={(e) => setLookbackDays(parseInt(e.target.value, 10) || 14)}
                  required
                />
                <p className="text-[10px] text-neutral-500 mt-1">
                  Default 14 hari. Makin panjang, makin akurat tapi makin lambat
                  bereaksi terhadap perubahan tren.
                </p>
              </div>
              <div>
                <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Catatan</label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="(opsional) untuk edisi khusus / event"
                />
              </div>
              <Button type="submit" size="sm" disabled={generating}>
                {generating ? 'Membuat…' : 'Generate'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Riwayat ({sheets.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && <div className="text-neutral-500 dark:text-neutral-400 text-sm">Memuat…</div>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase text-neutral-500">
                  <tr>
                    <th className="text-left p-2">Tanggal</th>
                    <th className="text-left p-2">Lookback</th>
                    <th className="text-left p-2">Dibuat</th>
                    <th className="text-left p-2">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {sheets.map((s) => (
                    <tr key={s.id} className="border-t border-neutral-200 dark:border-neutral-800 hover:bg-white dark:bg-neutral-900/40">
                      <td className="p-2 text-sm">{fmtDate(s.date)}</td>
                      <td className="p-2 text-xs">{s.lookbackDays} hari</td>
                      <td className="p-2 text-xs text-neutral-500 dark:text-neutral-400">
                        {fmtDateTime(s.generatedAt)}
                      </td>
                      <td className="p-2">
                        <button
                          type="button"
                          onClick={() => void onSelect(s)}
                          className="text-red-400 hover:text-red-300 text-xs"
                        >
                          Lihat
                        </button>
                      </td>
                    </tr>
                  ))}
                  {sheets.length === 0 && !loading && (
                    <tr>
                      <td colSpan={4} className="text-center text-neutral-500 py-6">
                        Belum ada prep sheet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {detailLoading && <div className="text-neutral-500 dark:text-neutral-400 text-sm print:hidden">Memuat detail…</div>}

      {selected && <PrepSheetView sheet={selected} onPrint={onPrint} />}
    </div>
  );
}

function PrepSheetView({
  sheet,
  onPrint,
}: {
  sheet: PrepSheetDetail;
  onPrint: () => void;
}) {
  // Group by categoryName (fallback: "Lainnya")
  const grouped = useMemo(() => {
    const map = new Map<string, PrepSheetItem[]>();
    for (const it of sheet.itemsJson) {
      const k = it.categoryName ?? 'Lainnya';
      const list = map.get(k) ?? [];
      list.push(it);
      map.set(k, list);
    }
    // Sort items within each group by recommendedQty desc
    for (const list of map.values()) {
      list.sort((a, b) => b.recommendedQty - a.recommendedQty);
    }
    // Sort groups by their top recommended qty
    return Array.from(map.entries()).sort(([, a], [, b]) => {
      const at = a[0]?.recommendedQty ?? 0;
      const bt = b[0]?.recommendedQty ?? 0;
      return bt - at;
    });
  }, [sheet.itemsJson]);

  const totalItems = sheet.itemsJson.length;
  const totalQty = sheet.itemsJson.reduce((s, i) => s + i.recommendedQty, 0);

  return (
    <Card className="print:bg-white print:text-black print:border-0">
      <CardHeader className="flex flex-row items-center justify-between print:hidden">
        <CardTitle>Detail Prep Sheet</CardTitle>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onPrint}>
            🖨️ Cetak
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="print:py-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3 print:mb-2">
            <h2 className="text-lg font-semibold print:text-xl">
              Prep Sheet — {fmtDate(sheet.date)}
            </h2>
            <div className="text-xs text-neutral-500 dark:text-neutral-400 print:text-black">
              Lookback {sheet.lookbackDays} hari •{' '}
              {totalItems} item • Total {totalQty} prep
            </div>
          </div>
          {sheet.notes && (
            <div className="text-xs italic text-neutral-500 dark:text-neutral-400 mb-2 print:text-black print:mb-1">
              Catatan: {sheet.notes}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm print:text-xs">
              <thead className="text-[10px] uppercase text-neutral-500 print:text-black print:border-b print:border-black">
                <tr>
                  <th className="text-left p-2 w-10">#</th>
                  <th className="text-left p-2">Kategori / Item</th>
                  <th className="text-right p-2 w-20">Rata-rata/hari</th>
                  <th className="text-right p-2 w-20">Faktor DOW</th>
                  <th className="text-right p-2 w-20">7 hari</th>
                  <th className="text-right p-2 w-24">Prep</th>
                  <th className="text-left p-2 w-24 print:hidden">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(([category, items]) => (
                  <CategoryGroup
                    key={category}
                    category={category}
                    items={items}
                    startIndex={sheet.itemsJson.findIndex(
                      (it) => (it.categoryName ?? 'Lainnya') === category,
                    )}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-neutral-300 dark:border-neutral-700 print:border-black">
                  <td colSpan={5} className="p-2 text-right font-semibold">
                    Total
                  </td>
                  <td className="p-2 text-right font-mono font-semibold">{totalQty}</td>
                  <td className="print:hidden" />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-[10px] text-neutral-500 mt-3 print:hidden">
            DOW = Day of Week. Faktor menyesuaikan rekomendasi dengan pola
            penjualan di hari yang sama minggu-minggu sebelumnya.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function CategoryGroup({
  category,
  items,
  startIndex,
}: {
  category: string;
  items: PrepSheetItem[];
  startIndex: number;
}) {
  return (
    <>
      <tr className="bg-neutral-100 dark:bg-neutral-800/50 print:bg-gray-200">
        <td colSpan={7} className="p-2 text-xs font-semibold uppercase tracking-wider print:text-black">
          {category}
        </td>
      </tr>
      {items.map((it, i) => (
        <tr
          key={it.menuItemId}
          className="border-t border-neutral-200 dark:border-neutral-800 print:border-gray-300"
        >
          <td className="p-2 text-xs text-neutral-500 print:text-black">
            {startIndex + i + 1}
          </td>
          <td className="p-2 text-sm print:text-black">{it.name}</td>
          <td className="p-2 text-right font-mono text-xs print:text-black">
            {it.avgQtyPerDay.toFixed(2)}
          </td>
          <td className="p-2 text-right font-mono text-xs print:text-black">
            ×{it.dayOfWeekFactor.toFixed(2)}
          </td>
          <td className="p-2 text-right font-mono text-xs text-neutral-500 dark:text-neutral-400 print:text-black">
            {it.last7DayQty}
          </td>
          <td className="p-2 text-right font-mono text-sm font-semibold print:text-black print:text-base print:border-l print:border-gray-400">
            {it.recommendedQty}
          </td>
          <td className="p-2 print:hidden">
            <span className="text-[10px] text-neutral-500">—</span>
          </td>
        </tr>
      ))}
    </>
  );
}
