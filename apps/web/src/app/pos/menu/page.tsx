'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, type Branch, type MenuItem } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { formatIDR } from '@/lib/format';
import { useAuth } from '@/hooks/useAuth';

type Tab = 'items' | 'categories' | 'clone';

interface Category {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export default function MenuManagementPage() {
  const router = useRouter();
  const { user, loading: authLoading, switchBranch } = useAuth();
  const fmt = formatIDR;
  const [tab, setTab] = useState<Tab>('items');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Clone state
  const [cloneSource, setCloneSource] = useState<string>('');
  const [cloneTarget, setCloneTarget] = useState<string>('');
  const [cloneSourceItems, setCloneSourceItems] = useState<MenuItem[]>([]);
  const [priceOverrides, setPriceOverrides] = useState<Record<string, string>>({});
  const [skipExisting, setSkipExisting] = useState(true);
  const [cloning, setCloning] = useState(false);
  const [cloneResult, setCloneResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);

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

  // Init branches
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
    void (async () => {
      try {
        const r = await api.listBranches();
        const bs = r.data?.branches ?? [];
        setBranches(bs);
        if (bs.length > 0) {
          setSelectedBranchId(bs[0].id);
          setCloneSource(bs[0].id);
          setCloneTarget(bs[1]?.id ?? bs[0].id);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
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

  // Load items for selected branch
  const loadItems = useCallback(async () => {
    if (!selectedBranchId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.getMenuItems({ branchId: selectedBranchId });
      setItems((r.data as MenuItem[]) ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  // Load source items for clone
  useEffect(() => {
    if (!cloneSource) return;
    void (async () => {
      try {
        const r = await api.getMenuItems({ branchId: cloneSource });
        setCloneSourceItems((r.data as MenuItem[]) ?? []);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [cloneSource]);

  // Switch active branch when user picks a different one
  const onBranchChange = async (id: string) => {
    setSelectedBranchId(id);
    try {
      await switchBranch(id);
    } catch {
      // non-fatal
    }
  };

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

  const runClone = async () => {
    if (!cloneSource || !cloneTarget) {
      setError('Source dan target branch wajib dipilih');
      return;
    }
    if (cloneSource === cloneTarget) {
      setError('Source dan target harus berbeda');
      return;
    }
    setCloning(true);
    setError(null);
    setCloneResult(null);
    try {
      const overrides: Record<string, { priceCents?: number; costCents?: number }> = {};
      for (const [sku, raw] of Object.entries(priceOverrides)) {
        const price = parseFloat(raw);
        if (!isNaN(price) && price > 0) {
          overrides[sku] = { priceCents: Math.round(price * 100) };
        }
      }
      const r = await api.cloneMenu({
        sourceBranchId: cloneSource,
        targetBranchId: cloneTarget,
        priceOverrides: overrides,
        skipExisting,
      });
      setCloneResult(r.data as any);
      setInfo(
        `Selesai: ${(r.data as any).created} dibuat, ${(r.data as any).updated} diupdate, ${(r.data as any).skipped} dilewati`,
      );
      setTimeout(() => setInfo(null), 5000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCloning(false);
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
          <p className="text-sm text-slate-400 mt-1">Kelola menu, kategori, dan copy antar cabang</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">Cabang:</label>
          <select
            value={selectedBranchId}
            onChange={(e) => onBranchChange(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-100 text-sm rounded px-3 py-1.5"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </select>
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
        {(['items', 'categories', 'clone'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === t
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t === 'items' ? 'Menu Items' : t === 'categories' ? 'Kategori' : 'Copy antar Cabang'}
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
                        <td className="py-2 px-3 text-right text-slate-400">
                          {it.costCents != null ? fmt(it.costCents) : '—'}
                        </td>
                        <td className="py-2 px-3 text-center text-xs">
                          {it.useBranchPpn ? (
                            <Badge tone="info">branch</Badge>
                          ) : (
                            <span className="text-slate-400">{((it.taxRateBp ?? 0) / 100).toFixed(1)}%</span>
                          )}
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
              Kategori dibuat otomatis saat copy menu dari cabang lain, atau via API.
            </p>
          </CardContent>
        </Card>
      )}

      {tab === 'clone' && (
        <div className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Copy Menu Antar Cabang</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-400">
                Pilih cabang sumber (template menu) dan cabang target. Bisa override harga per SKU.
                Item yang sudah ada di target akan di-skip (default) atau di-overwrite dengan harga
                sumber.
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Dari (source)</label>
                  <select
                    value={cloneSource}
                    onChange={(e) => setCloneSource(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 text-sm rounded px-3 py-2"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} — {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Ke (target)</label>
                  <select
                    value={cloneTarget}
                    onChange={(e) => setCloneTarget(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 text-sm rounded px-3 py-2"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} — {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={skipExisting}
                  onChange={(e) => setSkipExisting(e.target.checked)}
                  className="rounded"
                />
                Skip item yang sudah ada di target (recommended)
              </label>

              {cloneSourceItems.length > 0 && cloneSource !== cloneTarget && (
                <div className="mt-3 border border-slate-800 rounded">
                  <div className="px-3 py-2 bg-slate-900/50 text-xs text-slate-400 border-b border-slate-800">
                    {cloneSourceItems.length} item di source — override harga (kosongkan = pakai harga
                    source)
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {cloneSourceItems.map((it) => (
                      <div
                        key={it.id}
                        className="grid grid-cols-[1fr_100px_120px] gap-2 px-3 py-1.5 text-xs border-b border-slate-800/30 items-center"
                      >
                        <div>
                          <div className="text-slate-100">{it.name}</div>
                          <div className="text-slate-500 font-mono">{it.sku}</div>
                        </div>
                        <div className="text-right text-slate-400">{fmt(it.priceCents)}</div>
                        <input
                          type="number"
                          step="100"
                          placeholder="override"
                          value={priceOverrides[it.sku ?? ''] ?? ''}
                          onChange={(e) =>
                            setPriceOverrides((p) => ({ ...p, [it.sku ?? '']: e.target.value }))
                          }
                          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-right text-slate-100"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button onClick={runClone} disabled={cloning}>
                  {cloning ? 'Copying…' : 'Copy Menu'}
                </Button>
                {cloneResult && (
                  <div className="text-sm text-slate-300">
                    Created: <span className="text-emerald-400">{cloneResult.created}</span>, Updated:{' '}
                    <span className="text-amber-400">{cloneResult.updated}</span>, Skipped:{' '}
                    <span className="text-slate-400">{cloneResult.skipped}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Edit: {editing.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
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
                <label className="text-xs text-slate-400 block mb-1">Modal (Rp)</label>
                <Input
                  type="number"
                  step="100"
                  value={editCost}
                  onChange={(e) => setEditCost(e.target.value)}
                />
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
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
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
