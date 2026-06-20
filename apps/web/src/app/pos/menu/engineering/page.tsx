'use client';

// apps/web/src/app/pos/menu/engineering/page.tsx
//
// Sprint 9.4 — Menu Engineering (BCG Matrix).
//
// Visual 2x2 quadrant view:
//   ┌────────────────────────┬────────────────────────┐
//   │ PUZZLE (Teka-teki)     │ STAR (Bintang)         │
//   │ low pop, high margin   │ high pop, high margin  │
//   ├────────────────────────┼────────────────────────┤
//   │ DOG (Anjing)           │ PLOWHORSE (Kuda)       │
//   │ low pop, low margin    │ high pop, low margin   │
//   └────────────────────────┴────────────────────────┘
//
// The medians used for the split are stored on the snapshot, so the
// quadrant boundaries are stable when you re-open a snapshot later.
//
// Each quadrant card lists its items sorted by totalQty desc. Clicking
// an item opens a side panel with the item's detail (revenue, margin,
// pcts) and a small trend chart if multiple snapshots exist for the
// branch.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import {
  api,
  type MenuEngineeringSnapshot,
  type MenuEngineeringSnapshotDetail,
  type MenuEngineeringItem,
  type MenuEngineeringQuadrant,
} from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { formatIDR } from '@/lib/format';
import { cn } from '@/lib/utils';

const QUADRANT_META: Record<
  MenuEngineeringQuadrant,
  {
    label: string;
    indonesian: string;
    description: string;
    color: string; // tailwind text color
    border: string;
    bg: string;
  }
> = {
  STAR: {
    label: 'Star',
    indonesian: 'Bintang',
    description: 'Penjualan tinggi, margin tinggi',
    color: 'text-emerald-400',
    border: 'border-emerald-700/60',
    bg: 'bg-emerald-900/20',
  },
  PLOWHORSE: {
    label: 'Plowhorse',
    indonesian: 'Kuda',
    description: 'Penjualan tinggi, margin rendah',
    color: 'text-amber-400',
    border: 'border-amber-700/60',
    bg: 'bg-amber-900/20',
  },
  PUZZLE: {
    label: 'Puzzle',
    indonesian: 'Teka-teki',
    description: 'Penjualan rendah, margin tinggi',
    color: 'text-sky-400',
    border: 'border-sky-700/60',
    bg: 'bg-sky-900/20',
  },
  DOG: {
    label: 'Dog',
    indonesian: 'Anjing',
    description: 'Penjualan rendah, margin rendah',
    color: 'text-rose-400',
    border: 'border-rose-700/60',
    bg: 'bg-rose-900/20',
  },
};

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function startOfMonthISO(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export default function MenuEngineeringPage() {
  return (
    <Suspense fallback={
      <div className="flex-1 p-6 text-neutral-400 text-sm">Memuat…</div>
    }>
      <MenuEngineeringPageContent />
    </Suspense>
  );
}

function MenuEngineeringPageContent() {
  const { user } = useAuth();
  const branchId = user?.branchId || '';

  const [snapshots, setSnapshots] = useState<MenuEngineeringSnapshot[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MenuEngineeringSnapshotDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MenuEngineeringItem | null>(null);

  // Period range for "Generate" form (defaults to current month)
  const [periodStart, setPeriodStart] = useState(startOfMonthISO());
  const [periodEnd, setPeriodEnd] = useState(todayISO());

  // Load the latest snapshot list
  const refreshList = useCallback(async () => {
    if (!branchId) return;
    setLoadingList(true);
    try {
      const res = await api.listMenuEngineeringSnapshots({ branchId, limit: 12 });
      setSnapshots(res.data || []);
      if (!activeId && res.data && res.data.length > 0) {
        setActiveId(res.data[0].id);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Gagal memuat snapshot');
    } finally {
      setLoadingList(false);
    }
  }, [branchId, activeId]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // Load active snapshot detail
  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    (async () => {
      try {
        const res = await api.getMenuEngineeringSnapshot(activeId);
        if (cancelled) return;
        setDetail(res.data);
      } catch (e: any) {
        toast.error(e?.message || 'Gagal memuat detail snapshot');
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  async function handleGenerate() {
    if (!branchId) {
      toast.error('Pilih branch dulu');
      return;
    }
    if (!periodStart || !periodEnd) {
      toast.error('Tanggal periode wajib diisi');
      return;
    }
    if (periodEnd < periodStart) {
      toast.error('Tanggal akhir harus setelah tanggal mulai');
      return;
    }
    setGenerating(true);
    try {
      const res = await api.createMenuEngineeringSnapshot({
        branchId,
        periodStart: `${periodStart}T00:00:00+07:00`,
        periodEnd: `${periodEnd}T23:59:59+07:00`,
      });
      toast.success('Snapshot dibuat');
      setActiveId(res.data.id);
      void refreshList();
    } catch (e: any) {
      toast.error(e?.message || 'Gagal membuat snapshot');
    } finally {
      setGenerating(false);
    }
  }

  // Group items by quadrant
  const byQuadrant = useMemo(() => {
    const map: Record<MenuEngineeringQuadrant, MenuEngineeringItem[]> = {
      STAR: [],
      PLOWHORSE: [],
      PUZZLE: [],
      DOG: [],
    };
    if (detail) {
      for (const it of detail.items) {
        map[it.quadrant].push(it);
      }
    }
    for (const q of Object.keys(map) as MenuEngineeringQuadrant[]) {
      map[q].sort((a, b) => b.totalQty - a.totalQty);
    }
    return map;
  }, [detail]);

  if (!user) {
    return <div className="flex-1 p-6 text-neutral-400 text-sm">Memuat sesi…</div>;
  }

  return (
    <div className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Menu Engineering</h1>
        <p className="text-xs text-neutral-500">
          Analisis BCG (Boston Consulting Group) untuk memahami performa setiap menu
          berdasarkan popularitas dan kontribusi margin.
        </p>
      </div>

      {/* Generate + snapshot selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Generate Snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">Dari</label>
              <Input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="h-9 w-[150px]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">Sampai</label>
              <Input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="h-9 w-[150px]"
              />
            </div>
            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? 'Membuat…' : 'Buat Snapshot'}
            </Button>
            <div className="flex-1" />
            <div className="min-w-[220px]">
              <label className="block text-[11px] text-neutral-400 mb-1">Snapshot</label>
              <select
                value={activeId || ''}
                onChange={(e) => setActiveId(e.target.value)}
                className="h-9 w-full bg-neutral-900 border border-neutral-800 rounded-md text-sm text-neutral-100 px-2"
              >
                {loadingList ? (
                  <option value="">Memuat…</option>
                ) : snapshots.length === 0 ? (
                  <option value="">Belum ada snapshot</option>
                ) : (
                  snapshots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {new Date(s.periodStart).toISOString().slice(0, 10)} →{' '}
                      {new Date(s.periodEnd).toISOString().slice(0, 10)} ·{' '}
                      {new Date(s.generatedAt).toLocaleString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Snapshot meta */}
      {loadingDetail ? (
        <div className="text-sm text-neutral-400 py-6 text-center">Memuat detail…</div>
      ) : !detail ? (
        <Card>
          <CardContent>
            <div className="text-sm text-neutral-400 py-6 text-center">
              Pilih atau buat snapshot untuk melihat matriks BCG.
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <Stat label="Order" value={String(detail.totals.totalOrders)} />
            <Stat label="Item Terjual" value={String(detail.totals.totalItems)} />
            <Stat label="Pendapatan" value={formatIDR(detail.totals.totalRevenueCents)} />
            <Stat label="Margin" value={formatIDR(detail.totals.totalMarginCents)} />
          </div>

          {/* BCG matrix 2x2 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Top-left: PUZZLE (Teka-teki) — low pop, high margin */}
            <QuadrantCard
              quadrant="PUZZLE"
              items={byQuadrant.PUZZLE}
              medianPop={detail.totals.medianPopularityPct}
              medianMar={detail.totals.medianMarginPct}
              onItemClick={setSelectedItem}
            />
            {/* Top-right: STAR (Bintang) — high pop, high margin */}
            <QuadrantCard
              quadrant="STAR"
              items={byQuadrant.STAR}
              medianPop={detail.totals.medianPopularityPct}
              medianMar={detail.totals.medianMarginPct}
              onItemClick={setSelectedItem}
            />
            {/* Bottom-left: DOG (Anjing) — low pop, low margin */}
            <QuadrantCard
              quadrant="DOG"
              items={byQuadrant.DOG}
              medianPop={detail.totals.medianPopularityPct}
              medianMar={detail.totals.medianMarginPct}
              onItemClick={setSelectedItem}
            />
            {/* Bottom-right: PLOWHORSE (Kuda) — high pop, low margin */}
            <QuadrantCard
              quadrant="PLOWHORSE"
              items={byQuadrant.PLOWHORSE}
              medianPop={detail.totals.medianPopularityPct}
              medianMar={detail.totals.medianMarginPct}
              onItemClick={setSelectedItem}
            />
          </div>
        </>
      )}

      {selectedItem && detail ? (
        <ItemDetailPanel
          item={selectedItem}
          snapshot={detail}
          onClose={() => setSelectedItem(null)}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-md p-2">
      <div className="text-[10px] uppercase text-neutral-500">{label}</div>
      <div className="text-sm font-semibold text-neutral-100 mt-0.5">{value}</div>
    </div>
  );
}

function QuadrantCard({
  quadrant,
  items,
  medianPop,
  medianMar,
  onItemClick,
}: {
  quadrant: MenuEngineeringQuadrant;
  items: MenuEngineeringItem[];
  medianPop: number;
  medianMar: number;
  onItemClick: (it: MenuEngineeringItem) => void;
}) {
  const meta = QUADRANT_META[quadrant];
  const totalQty = items.reduce((s, i) => s + i.totalQty, 0);
  return (
    <div className={cn('rounded-lg border p-3', meta.border, meta.bg)}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className={cn('text-base font-semibold', meta.color)}>
            {meta.indonesian}
          </div>
          <div className="text-[10px] text-neutral-400">
            {meta.label} · {meta.description}
          </div>
        </div>
        <Badge tone="default" className="text-[10px]">
          {items.length} item · {totalQty} terjual
        </Badge>
      </div>
      <div className="text-[10px] text-neutral-500 mb-2">
        Median: pop {fmtPct(medianPop)} · margin {fmtPct(medianMar)}
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-neutral-500 py-3 text-center">Tidak ada item.</div>
      ) : (
        <ul className="space-y-1 max-h-72 overflow-y-auto">
          {items.map((it) => (
            <li key={it.menuItemId}>
              <button
                type="button"
                onClick={() => onItemClick(it)}
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 bg-neutral-900/60 hover:bg-neutral-800 rounded text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-neutral-100 truncate">{it.name}</div>
                  <div className="text-[10px] text-neutral-500">
                    {it.totalQty}× · pop {fmtPct(it.popularityPct)} · margin {fmtPct(it.marginPct)}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-neutral-200">{formatIDR(it.totalRevenueCents)}</div>
                  <div className={cn('text-[10px]', it.marginCents >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                    {formatIDR(it.marginCents)}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ItemDetailPanel({
  item,
  snapshot,
  onClose,
}: {
  item: MenuEngineeringItem;
  snapshot: MenuEngineeringSnapshotDetail;
  onClose: () => void;
}) {
  const meta = QUADRANT_META[item.quadrant];
  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-end sm:items-center sm:justify-center p-3">
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg w-full max-w-md p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-base font-semibold text-neutral-100">{item.name}</div>
            <div className={cn('text-xs', meta.color)}>
              Kuadran: {meta.indonesian} ({meta.label})
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded bg-neutral-800 text-neutral-100"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <DetailRow label="Qty Terjual" value={String(item.totalQty)} />
          <DetailRow label="Pendapatan" value={formatIDR(item.totalRevenueCents)} />
          <DetailRow label="HPP" value={formatIDR(item.totalCostCents)} />
          <DetailRow
            label="Margin"
            value={formatIDR(item.marginCents)}
            tone={item.marginCents >= 0 ? 'good' : 'bad'}
          />
          <DetailRow label="% Popularitas" value={fmtPct(item.popularityPct)} />
          <DetailRow label="% Margin" value={fmtPct(item.marginPct)} />
        </div>
        <div className="text-[11px] text-neutral-500 pt-2 border-t border-neutral-800">
          Snapshot: {new Date(snapshot.periodStart).toISOString().slice(0, 10)} →{' '}
          {new Date(snapshot.periodEnd).toISOString().slice(0, 10)} · dibuat{' '}
          {new Date(snapshot.generatedAt).toLocaleString('id-ID')}
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className="bg-neutral-950 border border-neutral-800 rounded p-2">
      <div className="text-[10px] uppercase text-neutral-500">{label}</div>
      <div
        className={cn(
          'text-sm font-semibold mt-0.5',
          tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-rose-400' : 'text-neutral-100',
        )}
      >
        {value}
      </div>
    </div>
  );
}
