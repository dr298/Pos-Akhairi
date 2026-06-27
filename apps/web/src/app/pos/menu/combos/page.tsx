'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { api, type Combo, type ComboItem, type MenuItem, ApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@/components/ui/Dialog';
import { formatIDR, parseIDR } from '@/lib/format';

interface DraftItem {
  menuItemId: string;
  quantity: number;
  overridesPriceCents: number | null;
}

interface FormState {
  id?: string;
  name: string;
  description: string;
  priceCents: string; // user types IDR
  imageUrl: string;
  validFrom: string;
  validUntil: string;
  isActive: boolean;
  items: DraftItem[];
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  priceCents: '50000',
  imageUrl: '',
  validFrom: '',
  validUntil: '',
  isActive: true,
  items: [],
};

export default function CombosPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [combos, setCombos] = useState<Combo[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const canManage = user?.role === 'OWNER' || user?.role === 'MANAGER';

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listCombos({ includeInactive: true });
      setCombos((res.data as Combo[]) || []);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal memuat combo');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canManage) {
      toast.error('Hanya Manager/Owner yang boleh mengelola combo');
      router.replace('/pos');
      return;
    }
    refresh();
  }, [canManage, refresh, router]);

  // Load menu items for the picker (right pane in the form).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.getMenuItems();
        if (!cancelled) setMenuItems((r.data as MenuItem[]) || []);
      } catch {
        // ignore — non-critical
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredMenu = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return menuItems;
    return menuItems.filter((m) => m.name.toLowerCase().includes(q) || (m.sku || '').toLowerCase().includes(q));
  }, [menuItems, search]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(c: Combo) {
    setForm({
      id: c.id,
      name: c.name,
      description: c.description || '',
      priceCents: String(Math.round(c.priceCents / 100)),
      imageUrl: c.imageUrl || '',
      validFrom: c.validFrom ? c.validFrom.slice(0, 16) : '',
      validUntil: c.validUntil ? c.validUntil.slice(0, 16) : '',
      isActive: c.isActive,
      items: c.items.map((ci: ComboItem) => ({
        menuItemId: ci.menuItemId,
        quantity: ci.quantity,
        overridesPriceCents: ci.overridesPriceCents,
      })),
    });
    setFormOpen(true);
  }

  function addItem(menuItemId: string) {
    if (form.items.find((i) => i.menuItemId === menuItemId)) {
      toast.error('Item sudah ada di combo');
      return;
    }
    setForm({ ...form, items: [...form.items, { menuItemId, quantity: 1, overridesPriceCents: null }] });
  }

  function removeItem(menuItemId: string) {
    setForm({ ...form, items: form.items.filter((i) => i.menuItemId !== menuItemId) });
  }

  function updateItem(menuItemId: string, patch: Partial<DraftItem>) {
    setForm({
      ...form,
      items: form.items.map((i) => (i.menuItemId === menuItemId ? { ...i, ...patch } : i)),
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (form.items.length === 0) {
        toast.error('Tambahkan minimal 1 item ke combo');
        return;
      }
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        priceCents: parseIDR(form.priceCents),
        imageUrl: form.imageUrl.trim() || undefined,
        validFrom: form.validFrom ? new Date(form.validFrom).toISOString() : undefined,
        validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : undefined,
        isActive: form.isActive,
        items: form.items.map((i) => ({
          menuItemId: i.menuItemId,
          quantity: i.quantity,
          overridesPriceCents: i.overridesPriceCents,
        })),
      };
      if (form.id) {
        await api.updateCombo(form.id, payload);
        toast.success('Combo diperbarui');
      } else {
        await api.createCombo(payload);
        toast.success('Combo dibuat');
      }
      setFormOpen(false);
      refresh();
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : e?.message || 'Gagal menyimpan';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(c: Combo) {
    if (!confirm(`Nonaktifkan combo "${c.name}"?`)) return;
    try {
      await api.deleteCombo(c.id);
      toast.success('Combo dinonaktifkan');
      refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Gagal menghapus');
    }
  }

  async function handleToggle(c: Combo) {
    try {
      await api.updateCombo(c.id, { isActive: !c.isActive });
      refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Gagal mengubah status');
    }
  }

  // Build a lookup from menuItemId -> MenuItem for displaying prices
  const menuMap = useMemo(() => new Map(menuItems.map((m) => [m.id, m])), [menuItems]);

  const comboItemsTotal = useMemo(() => {
    return form.items.reduce((sum, it) => {
      const m = menuMap.get(it.menuItemId);
      if (!m) return sum;
      const unit = it.overridesPriceCents ?? m.priceCents;
      return sum + unit * it.quantity;
    }, 0);
  }, [form.items, menuMap]);

  const comboPriceCents = parseIDR(form.priceCents);
  const savings = Math.max(0, comboItemsTotal - comboPriceCents);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 max-w-6xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Combo / Paket</h1>
        <Button onClick={openCreate}>+ Combo Baru</Button>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Memuat…</p>
      ) : combos.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Belum ada combo. Buat combo pertama.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {combos.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <Badge tone={c.isActive ? 'success' : 'muted'}>
                    {c.isActive ? 'Aktif' : 'Non-aktif'}
                  </Badge>
                </div>
                <CardDescription>
                  {formatIDR(c.priceCents)} · {c.items.length} item
                  {c.description ? ` · ${c.description}` : ''}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <ul className="text-xs text-neutral-500 dark:text-neutral-400 space-y-0.5">
                  {c.items.map((it) => {
                    const m = it.menuItem;
                    return (
                      <li key={it.id} className="flex justify-between">
                        <span>
                          {it.quantity}× {m?.name || it.menuItemId}
                        </span>
                        <span className="text-neutral-500">
                          {it.overridesPriceCents != null
                            ? formatIDR(it.overridesPriceCents)
                            : m?.priceCents != null
                            ? formatIDR(m.priceCents)
                            : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex flex-wrap gap-2 pt-1 text-xs text-neutral-500">
                  {c.validFrom && <span>dari {new Date(c.validFrom).toLocaleDateString('id-ID')}</span>}
                  {c.validUntil && <span>s/d {new Date(c.validUntil).toLocaleDateString('id-ID')}</span>}
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => openEdit(c)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleToggle(c)}>
                    {c.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-400" onClick={() => handleDelete(c)}>
                    Hapus
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={(v) => !saving && setFormOpen(v)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <div>
              <DialogTitle>{form.id ? 'Edit Combo' : 'Combo Baru'}</DialogTitle>
              <CardDescription>Atur nama, harga paket, dan item-item di dalamnya.</CardDescription>
            </div>
            <DialogClose />
          </DialogHeader>
          <DialogBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Left: form fields */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Nama</label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Paket Hemat A"
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Deskripsi</label>
                  <Textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Nasi Goreng + Es Teh + Kerupuk"
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Harga Combo (Rp)</label>
                  <Input
                    inputMode="numeric"
                    value={form.priceCents}
                    onChange={(e) => setForm({ ...form, priceCents: e.target.value })}
                  />
                  <p className="text-[10px] text-neutral-500 mt-1">
                    Total item: {formatIDR(comboItemsTotal)} · Hemat: {formatIDR(savings)}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">URL Gambar (opsional)</label>
                  <Input
                    value={form.imageUrl}
                    onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                    placeholder="https://…"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Berlaku Dari</label>
                    <Input
                      type="datetime-local"
                      value={form.validFrom}
                      onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Sampai</label>
                    <Input
                      type="datetime-local"
                      value={form.validUntil}
                      onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-200">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  />
                  Aktif
                </label>
              </div>

              {/* Right: items */}
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Item dalam Combo</label>
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Cari menu…"
                  />
                </div>
                <div className="border border-neutral-200 dark:border-neutral-800 rounded-md max-h-48 overflow-y-auto">
                  {filteredMenu.length === 0 ? (
                    <p className="p-3 text-xs text-neutral-500">Tidak ada menu.</p>
                  ) : (
                    filteredMenu.map((m) => {
                      const inCombo = form.items.find((i) => i.menuItemId === m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          disabled={Boolean(inCombo)}
                          onClick={() => addItem(m.id)}
                          className="w-full text-left px-3 py-2 text-sm border-b border-neutral-200 dark:border-neutral-800 last:border-0 hover:bg-neutral-100 dark:bg-neutral-800/50 disabled:opacity-50 disabled:hover:bg-transparent flex justify-between"
                        >
                          <span className="text-neutral-900 dark:text-neutral-100">{m.name}</span>
                          <span className="text-xs text-neutral-500">{formatIDR(m.priceCents)}</span>
                        </button>
                      );
                    })
                  )}
                </div>
                {form.items.length > 0 && (
                  <div className="space-y-1">
                    {form.items.map((it) => {
                      const m = menuMap.get(it.menuItemId);
                      return (
                        <div
                          key={it.menuItemId}
                          className="flex items-center gap-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md p-2 text-sm"
                        >
                          <span className="flex-1 truncate">{m?.name || it.menuItemId}</span>
                          <Input
                            className="w-16 h-8"
                            inputMode="numeric"
                            value={String(it.quantity)}
                            onChange={(e) =>
                              updateItem(it.menuItemId, {
                                quantity: Math.max(1, parseInt(e.target.value || '1', 10)),
                              })
                            }
                          />
                          <Input
                            className="w-24 h-8"
                            inputMode="numeric"
                            placeholder={`@${m ? formatIDR(m.priceCents) : ''}`}
                            value={it.overridesPriceCents != null ? String(Math.round(it.overridesPriceCents / 100)) : ''}
                            onChange={(e) =>
                              updateItem(it.menuItemId, {
                                overridesPriceCents: e.target.value ? parseIDR(e.target.value) : null,
                              })
                            }
                          />
                          <button
                            type="button"
                            onClick={() => removeItem(it.menuItemId)}
                            className="text-red-400 px-2"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Batal
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim() || form.items.length === 0}>
              {saving ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
