'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input, Textarea } from '@/components/ui/Input';
import { toast } from 'sonner';

interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  unit: string;
  quantity: string;          // Decimal-as-string
  reorderPoint: string;
  costPerUnit: string;
  isActive?: boolean;
}

const UNITS = ['pcs', 'kg', 'gram', 'liter', 'ml', 'pack', 'box', 'karton', 'botol', 'lembar'];

const formatIDR = (cents: number) =>
  `Rp ${Number(cents).toLocaleString('id-ID')}`;

export default function InventoryStockPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Create modal state
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ sku: '', name: '', unit: 'pcs', reorderPoint: '', costPerUnit: '', notes: '' });

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/inventory', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setItems(json.data?.items ?? []);
    } catch (e) {
      console.error('inventory load failed', e);
      toast.error('Gagal memuat data stok');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!form.sku.trim() || !form.name.trim()) {
      toast.error('SKU dan Nama wajib diisi');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: form.sku.trim(),
          name: form.name.trim(),
          unit: form.unit,
          reorderPoint: form.reorderPoint || '0',
          costPerUnit: form.costPerUnit || '0',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success('Item berhasil ditambahkan');
      setCreating(false);
      setForm({ sku: '', name: '', unit: 'pcs', reorderPoint: '', costPerUnit: '', notes: '' });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Stok Bahan Baku</h1>
          <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
            Daftar semua bahan baku beserta jumlah stok saat ini.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>+ Tambah Bahan</Button>
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
        <Card>
          <CardContent>
            <div className="text-sm text-neutral-500 py-4 text-center">Memuat…</div>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent>
            <div className="text-sm text-neutral-500 py-4 text-center">
              {search ? 'Tidak ada item yang cocok.' : 'Belum ada bahan baku. Klik "+ Tambah Bahan" untuk membuat.'}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Items ({filtered.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase text-neutral-500 border-b border-neutral-200 dark:border-neutral-800">
                    <th className="text-left py-2 pr-3">SKU</th>
                    <th className="text-left py-2 pr-3">Nama</th>
                    <th className="text-right py-2 pr-3">Stok</th>
                    <th className="text-right py-2 pr-3">Reorder Pt</th>
                    <th className="text-right py-2 pr-3">Harga/Unit</th>
                    <th className="text-center py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((it) => {
                    const qty = Number(it.quantity);
                    const reorder = Number(it.reorderPoint);
                    const isLow = !Number.isNaN(qty) && !Number.isNaN(reorder) && qty < reorder;
                    const active = it.isActive ?? true;
                    return (
                      <tr
                        key={it.id}
                        className="border-b border-neutral-200 dark:border-neutral-800"
                      >
                        <td className="py-2 pr-3 font-mono text-xs text-neutral-500">{it.sku}</td>
                        <td className="py-2 pr-3 font-medium">
                          {it.name}
                          {isLow && (
                            <Badge tone="warning" className="ml-2">
                              Stok rendah
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {qty.toLocaleString('id-ID', { maximumFractionDigits: 4 })} {it.unit}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {reorder.toLocaleString('id-ID', { maximumFractionDigits: 4 })} {it.unit}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatIDR(Number(it.costPerUnit))} /{it.unit}
                        </td>
                        <td className="py-2 text-center">
                          <Badge tone={active ? 'success' : 'muted'}>
                            {active ? 'Active' : 'Inactive'}
                          </Badge>
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

      {/* Create modal */}
      {creating && (
        <div className="fixed inset-0 bg-white dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle>Tambah Bahan Baku</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">SKU *</label>
                  <Input
                    placeholder="Contoh: BAH-001"
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Nama *</label>
                  <Input
                    placeholder="Contoh: Tepung Terigu"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Satuan *</label>
                  <select
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                    className="flex h-10 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Reorder Point</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0"
                    value={form.reorderPoint}
                    onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">Harga per Unit (Rp)</label>
                <Input
                  type="number"
                  step="100"
                  min="0"
                  placeholder="0"
                  value={form.costPerUnit}
                  onChange={(e) => setForm({ ...form, costPerUnit: e.target.value })}
                />
              </div>
              <div className="flex gap-2 justify-end pt-1 border-t border-neutral-200 dark:border-neutral-800">
                <Button variant="outline" onClick={() => setCreating(false)} disabled={saving}>
                  Batal
                </Button>
                <Button onClick={handleCreate} disabled={saving}>
                  {saving ? 'Menyimpan…' : 'Tambah'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
