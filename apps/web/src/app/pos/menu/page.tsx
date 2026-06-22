'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, type MenuItem } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { formatIDR } from '@/lib/format';
import { useAuth } from '@/hooks/useAuth';

type Tab = 'items' | 'categories';

interface Category {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export default function MenuManagementPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const fmt = formatIDR;
  const [tab, setTab] = useState<Tab>('items');
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Item edit modal
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editCost, setEditCost] = useState('');
  const [editAvailable, setEditAvailable] = useState(true);
  const [saving, setSaving] = useState(false);

  // New item modal
  const [creating, setCreating] = useState(false);
  const [newItem, setNewItem] = useState({
    name: '',
    sku: '',
    priceCents: '',
    costCents: '0',
    categoryId: '',
    description: '',
  });
  const [creatingItem, setCreatingItem] = useState(false);

  // Auth gate
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
      router.push('/pos');
      return;
    }
  }, [user, authLoading, router]);

  // Load categories
  const loadCategories = useCallback(async () => {
    try {
      const r = await api.getCategories();
      setCategories((r.data as Category[]) ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  // Load items
  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.getMenuItems();
      setItems((r.data as MenuItem[]) ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  // Filter items by search
  const filtered = items.filter((it) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return it.name.toLowerCase().includes(s) || (it.sku ?? '').toLowerCase().includes(s);
  });

  const openEdit = (it: MenuItem) => {
    setEditing(it);
    setEditPrice((it.priceCents / 100).toString());
    setEditCost(((it.costCents ?? 0) / 100).toString());
    setEditAvailable(it.isAvailable);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const priceCents = Math.round(parseFloat(editPrice) * 100);
      const costCents = Math.round(parseFloat(editCost || '0') * 100);
      if (isNaN(priceCents) || priceCents <= 0) {
        setError('Harga tidak valid');
        return;
      }
      await api.updateMenuItem(editing.id, {
        priceCents,
        costCents,
        isAvailable: editAvailable,
      } as any);
      setInfo(`Harga ${editing.name} diperbarui`);
      setEditing(null);
      await loadItems();
      setTimeout(() => setInfo(null), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const createItem = async () => {
    if (!newItem.name || !newItem.sku || !newItem.priceCents || !newItem.categoryId) {
      setError('Nama, SKU, harga, kategori wajib diisi');
      return;
    }
    setCreatingItem(true);
    setError(null);
    try {
      const priceCents = Math.round(parseFloat(newItem.priceCents) * 100);
      const costCents = Math.round(parseFloat(newItem.costCents || '0') * 100);
      await api.createMenuItem({
        name: newItem.name,
        sku: newItem.sku,
        priceCents,
        costCents,
        categoryId: newItem.categoryId,
        description: newItem.description || undefined,
        isAvailable: true,
        isActive: true,
      } as any);
      setInfo(`Menu ${newItem.name} ditambahkan`);
      setCreating(false);
      setNewItem({ name: '', sku: '', priceCents: '', costCents: '0', categoryId: '', description: '' });
      await loadItems();
      setTimeout(() => setInfo(null), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreatingItem(false);
    }
  };

  if (authLoading || !user) {
    return <div className="p-6 text-slate-400">Loading…</div>;
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Manajemen Menu</h1>
          <p className="text-sm text-slate-400 mt-1">Kelola menu dan kategori</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-800 text-red-200 text-sm rounded px-3 py-2">{error}</div>
      )}
      {info && (
        <div className="bg-emerald-950/40 border border-emerald-800 text-emerald-200 text-sm rounded px-3 py-2">
          {info}
        </div>
      )}

      <div className="flex gap-2 border-b border-slate-800">
        {(['items', 'categories'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === t
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t === 'items' ? 'Menu Items' : 'Kategori'}
          </button>
        ))}
      </div>

      {tab === 'items' && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
            <Input
              placeholder="Cari menu (nama / SKU)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1"
            />
            <Button onClick={() => setCreating(true)}>+ Menu Baru</Button>
          </div>

          {loading ? (
            <div className="text-slate-400 text-sm py-4 text-center">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-slate-400 text-sm py-4 text-center">Tidak ada menu</div>
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="text-left py-2 px-3">SKU</th>
                      <th className="text-left py-2 px-3">Nama</th>
                      <th className="text-left py-2 px-3">Kategori</th>
                      <th className="text-right py-2 px-3">Harga</th>
                      <th className="text-right py-2 px-3">Modal</th>
                      <th className="text-center py-2 px-3">PPN</th>
                      <th className="text-center py-2 px-3">Status</th>
                      <th className="text-right py-2 px-3">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((it) => (
                      <tr key={it.id} className="border-b border-slate-800/50 hover:bg-slate-900/50">
                        <td className="py-2 px-3 text-slate-300 font-mono text-xs">{it.sku ?? '—'}</td>
                        <td className="py-2 px-3 text-slate-100">{it.name}</td>
                        <td className="py-2 px-3 text-slate-400 text-xs">
                          {it.category?.name ?? '—'}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-100 font-medium">
                          {fmt(it.priceCents)}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-400 group relative">
                          {it.hppSource === 'RECIPE' && it.computedHppCents != null ? (
                            <>
                              <span className="text-emerald-400 cursor-help">
                                {fmt(it.computedHppCents)}
                                <sup className="text-[10px] ml-0.5">†</sup>
                              </span>
                              {it.hppBreakdown && it.hppBreakdown.length > 0 && (
                                <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover:block bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-3 min-w-[200px] text-xs">
                                  <div className="text-slate-300 font-medium mb-1.5">Rincian HPP</div>
                                  {it.hppBreakdown.map((b, i) => (
                                    <div key={i} className="flex justify-between gap-4 py-0.5">
                                      <span className="text-slate-400">{b.name}</span>
                                      <span className="text-slate-200">{fmt(b.cents)}</span>
                                    </div>
                                  ))}
                                  <div className="border-t border-slate-700 mt-1 pt-1 flex justify-between font-medium">
                                    <span className="text-slate-300">Total</span>
                                    <span className="text-emerald-400">{fmt(it.computedHppCents!)}</span>
                                  </div>
                                  {it.hppShortfall && (
                                    <p className="text-amber-400 mt-1 text-[10px]">⚠ Beberapa bahan habis — HPP estimasi</p>
                                  )}
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              {it.costCents != null ? fmt(it.costCents) : '—'}
                              <span className="text-[10px] text-slate-500 ml-1">(manual)</span>
                            </>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center text-xs">
                          <span className="text-slate-400">{((it.taxRateBp ?? 0) / 100).toFixed(1)}%</span>
                        </td>
                        <td className="py-2 px-3 text-center">
                          {it.isAvailable ? (
                            <Badge tone="success">Aktif</Badge>
                          ) : (
                            <Badge tone="warning">Off</Badge>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <Button size="sm" variant="outline" onClick={() => openEdit(it)}>
                            Edit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === 'categories' && (
        <Card>
          <CardHeader>
            <CardTitle>Kategori Menu</CardTitle>
          </CardHeader>
          <CardContent>
            {categories.length === 0 ? (
              <p className="text-sm text-slate-400">Belum ada kategori</p>
            ) : (
              <ul className="space-y-1">
                {categories.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between py-2 px-3 border-b border-slate-800/50"
                  >
                    <span className="text-slate-100">{c.name}</span>
                    <span className="text-xs text-slate-400">sort: {c.sortOrder}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-500 mt-3">
              Kategori dibuat via API atau menu Settings.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-white dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Edit: {editing.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* HPP source indicator */}
              {editing.hppSource === 'RECIPE' && editing.computedHppCents != null && (
                <div className="bg-emerald-950/40 border border-emerald-800/40 rounded-lg px-3 py-2">
                  <p className="text-xs text-emerald-400 font-medium">HPP Auto (Recipe + FIFO)</p>
                  <p className="text-sm text-emerald-300 mt-0.5">
                    {fmt(editing.computedHppCents)}
                    <span className="text-slate-500 ml-2">
                      Margin: {fmt(editing.priceCents - editing.computedHppCents)}
                    </span>
                  </p>
                  {editing.hppBreakdown && editing.hppBreakdown.length > 0 && (
                    <p className="text-[11px] text-slate-500 mt-1">
                      {editing.hppBreakdown.map((b) => b.name).join(' + ')}
                    </p>
                  )}
                  <p className="text-[10px] text-slate-600 mt-1">Modal dihitung dari resep bahan baku</p>
                </div>
              )}
              {editing.hppSource === 'MANUAL' && (
                <div className="bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2">
                  <p className="text-xs text-slate-400">HPP Manual</p>
                  <p className="text-[10px] text-slate-600 mt-0.5">Belum ada resep bahan baku — modal diinput manual</p>
                </div>
              )}
              <div>
                <label className="text-xs text-slate-400 block mb-1">Harga (Rp)</label>
                <Input
                  type="number"
                  step="100"
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Modal (Rp)
                  {editing.hppSource === 'RECIPE' && (
                    <span className="text-emerald-400/60 ml-1">dari resep</span>
                  )}
                </label>
                <Input
                  type="number"
                  step="100"
                  value={editCost}
                  disabled={editing.hppSource === 'RECIPE'}
                  className={editing.hppSource === 'RECIPE' ? 'opacity-50 cursor-not-allowed' : ''}
                />
                {editing.hppSource === 'RECIPE' && (
                  <p className="text-[10px] text-slate-600 mt-0.5">Edit via resep bahan baku, bukan di sini</p>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={editAvailable}
                  onChange={(e) => setEditAvailable(e.target.checked)}
                />
                Tersedia untuk dijual
              </label>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
                  Batal
                </Button>
                <Button onClick={saveEdit} disabled={saving}>
                  {saving ? 'Saving…' : 'Simpan'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Create modal */}
      {creating && (
        <div className="fixed inset-0 bg-white dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Menu Baru</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Nama *</label>
                <Input
                  value={newItem.name}
                  onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">SKU *</label>
                <Input
                  value={newItem.sku}
                  onChange={(e) => setNewItem({ ...newItem, sku: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Harga (Rp) *</label>
                  <Input
                    type="number"
                    step="100"
                    value={newItem.priceCents}
                    onChange={(e) => setNewItem({ ...newItem, priceCents: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Modal (Rp)</label>
                  <Input
                    type="number"
                    step="100"
                    value={newItem.costCents}
                    onChange={(e) => setNewItem({ ...newItem, costCents: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Kategori *</label>
                <select
                  value={newItem.categoryId}
                  onChange={(e) => setNewItem({ ...newItem, categoryId: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-100 text-sm rounded px-3 py-2"
                >
                  <option value="">Pilih kategori…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Deskripsi</label>
                <Textarea
                  value={newItem.description}
                  onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                  rows={2}
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setCreating(false)} disabled={creatingItem}>
                  Batal
                </Button>
                <Button onClick={createItem} disabled={creatingItem}>
                  {creatingItem ? 'Creating…' : 'Buat'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
