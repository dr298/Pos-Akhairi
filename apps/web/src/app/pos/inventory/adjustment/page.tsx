'use client';

// Sprint 21 — Inventory Adjustment (Stock Opname)
//
// Manager walks the kitchen, counts actual physical stock of each
// inventory item, and enters the count here. The system shows the
// current (system) qty side-by-side with the actual count, computes
// delta, and writes an ADJUSTMENT log.
//
//   Positive delta (actual > system) = GAIN / keuntungan
//   Negative delta (actual < system) = LOSS / kerugian
//
// Each adjustment is auditable via /api/inventory/:id/adjustments.

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  unit: string;
  quantity: string;          // Decimal-as-string
  reorderPoint: string;
  costPerUnit: string;
}

type Row = {
  item: InventoryItem;
  actualInput: string;       // user-entered text
  submitted: boolean;
  lastDelta?: string;
  lastDirection?: 'GAIN' | 'LOSS' | 'NOOP';
};

function formatQty(s: string, unit: string) {
  const n = Number(s);
  if (Number.isNaN(n)) return `${s} ${unit}`;
  return `${n.toLocaleString('id-ID', { maximumFractionDigits: 4 })} ${unit}`;
}

export default function InventoryAdjustmentPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/inventory', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const list: InventoryItem[] = json.data?.items ?? [];
      setItems(list);
      // Seed rows
      const init: Record<string, Row> = {};
      for (const it of list) {
        init[it.id] = { item: it, actualInput: '', submitted: false };
      }
      setRows(init);
    } catch (e) {
      console.error('inventory load failed', e);
      toast.error('Gagal memuat inventory');
    } finally {
      setLoading(false);
    }
  }

  function setActual(id: string, val: string) {
    setRows((r) => ({
      ...r,
      [id]: { ...r[id], actualInput: val },
    }));
  }

  async function submit(id: string) {
    const row = rows[id];
    if (!row) return;
    const actual = row.actualInput.trim();
    if (!/^\d+(\.\d{1,4})?$/.test(actual)) {
      toast.error('Actual qty harus angka desimal (max 4 angka di belakang koma)');
      return;
    }
    const reason = window.prompt(
      `Alasan adjustment untuk "${row.item.name}"?\n(min. 3 karakter, max 200)`,
      'Stock opname bulanan',
    );
    if (!reason || reason.trim().length < 3) {
      toast.error('Alasan minimal 3 karakter');
      return;
    }
    setSubmitting(id);
    try {
      const res = await fetch(`/api/inventory/${id}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ actualQty: actual, reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const body = await res.json();
      const dir: 'GAIN' | 'LOSS' | 'NOOP' = body.direction ?? 'NOOP';
      setRows((r) => ({
        ...r,
        [id]: {
          ...r[id],
          actualInput: '',
          submitted: true,
          lastDelta: body.delta ?? '0',
          lastDirection: dir,
        },
      }));
      // Update local item quantity to reflect server
      setItems((it) =>
        it.map((i) => (i.id === id ? { ...i, quantity: body.item?.quantity ?? actual } : i)),
      );
      toast.success(
        dir === 'GAIN'
          ? `Keuntungan tercatat: +${body.delta} ${row.item.unit}`
          : dir === 'LOSS'
            ? `Kerugian tercatat: ${body.delta} ${row.item.unit}`
            : 'Stok tidak berubah',
      );
    } catch (e) {
      console.error('adjust failed', e);
      toast.error((e as Error).message || 'Gagal menyimpan adjustment');
    } finally {
      setSubmitting(null);
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q),
    );
  }, [items, search]);

  // Aggregate stats across submitted-this-session rows
  const stats = useMemo(() => {
    let gain = 0;
    let loss = 0;
    let adjusted = 0;
    for (const r of Object.values(rows)) {
      if (r.lastDirection === 'GAIN') {
        gain += Number(r.lastDelta ?? 0);
        adjusted += 1;
      } else if (r.lastDirection === 'LOSS') {
        loss += Number(r.lastDelta ?? 0);
        adjusted += 1;
      }
    }
    return { gain, loss, adjusted };
  }, [rows]);

  return (
    <div className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold">Stock Opname</h1>
        <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
          Hitung fisik stok, masukkan jumlah sebenarnya. Selisih tercatat sebagai
          keuntungan (gain) atau kerugian (loss).
        </p>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">Disesuaikan</div>
          <div className="text-2xl font-semibold tabular-nums mt-0.5">{stats.adjusted}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">Total Gain</div>
          <div className="text-2xl font-semibold tabular-nums mt-0.5 text-emerald-500">
            {stats.gain > 0 ? `+${stats.gain.toLocaleString('id-ID', { maximumFractionDigits: 4 })}` : '0'}
          </div>
        </div>
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">Total Loss</div>
          <div className="text-2xl font-semibold tabular-nums mt-0.5 text-red-500">
            {stats.loss < 0 ? stats.loss.toLocaleString('id-ID', { maximumFractionDigits: 4 }) : '0'}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama / SKU…"
          className="flex-1 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm"
        />
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? 'Memuat…' : 'Refresh'}
        </Button>
      </div>

      {loading ? (
        <Card><CardContent><div className="text-sm text-neutral-500 py-4 text-center">Memuat…</div></CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card><CardContent><div className="text-sm text-neutral-500 py-4 text-center">Tidak ada item.</div></CardContent></Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase text-neutral-500 border-b border-neutral-200 dark:border-neutral-800">
                    <th className="text-left py-2 pr-3">Item</th>
                    <th className="text-left py-2 pr-3">SKU</th>
                    <th className="text-right py-2 pr-3">System</th>
                    <th className="text-right py-2 pr-3">Actual</th>
                    <th className="text-right py-2 pr-3">Delta</th>
                    <th className="text-right py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((it) => {
                    const row = rows[it.id];
                    if (!row) return null;
                    const sys = Number(it.quantity);
                    const act = Number(row.actualInput);
                    const hasInput = row.actualInput.trim() !== '' && !Number.isNaN(act);
                    const delta = hasInput ? act - sys : 0;
                    return (
                      <tr
                        key={it.id}
                        className="border-b border-neutral-200 dark:border-neutral-800"
                      >
                        <td className="py-2 pr-3 font-medium">{it.name}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-neutral-500">{it.sku}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatQty(it.quantity, it.unit)}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row.actualInput}
                            onChange={(e) => setActual(it.id, e.target.value)}
                            placeholder="0"
                            disabled={submitting === it.id}
                            className="w-24 text-right tabular-nums rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {hasInput && delta !== 0 ? (
                            <Badge tone={delta > 0 ? 'success' : 'danger'}>
                              {delta > 0 ? '+' : ''}
                              {delta.toLocaleString('id-ID', { maximumFractionDigits: 4 })}{' '}
                              {it.unit}
                            </Badge>
                          ) : hasInput ? (
                            <span className="text-neutral-400 text-xs">sama</span>
                          ) : (
                            <span className="text-neutral-300">—</span>
                          )}
                          {row.lastDirection && row.submitted && (
                            <div className="text-[10px] mt-0.5">
                              <span
                                className={cn(
                                  'font-medium',
                                  row.lastDirection === 'GAIN' ? 'text-emerald-500' : 'text-red-500',
                                )}
                              >
                                {row.lastDirection === 'GAIN' ? '✓ GAIN' : '✓ LOSS'}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => submit(it.id)}
                            disabled={!hasInput || submitting === it.id}
                          >
                            {submitting === it.id ? 'Menyimpan…' : 'Submit'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
