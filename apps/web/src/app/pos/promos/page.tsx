'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import {
  api,
  type Promo,
  type PromoCondition,
  type PromoReward,
  type PromoType,
  type MenuItem,
  type Category,
  ApiError,
} from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
import { formatIDR } from '@/lib/format';

const TYPE_LABEL: Record<PromoType, string> = {
  PERCENT: 'Persen',
  AMOUNT: 'Nominal',
  BUY_X_GET_Y: 'Beli X Gratis Y',
  BUNDLE: 'Bundle',
};

interface DraftCondition {
  menuItemId: string;
  categoryId: string;
  minQuantity: string; // user types integer
}

interface DraftReward {
  freeMenuItemId: string;
  freeQuantity: string;
  discountPercentBp: string; // 0-10000 bp
  discountCents: string; // user types IDR
}

interface FormState {
  id?: string;
  code: string;
  name: string;
  type: PromoType;
  valueCents: string; // user types IDR
  percentBp: string; // 0-10000 basis points
  minSubtotalCents: string; // user types IDR
  maxDiscountCents: string; // user types IDR
  validFrom: string;
  validUntil: string;
  usageLimit: string;
  isActive: boolean;
  requiresMember: boolean;
  conditions: DraftCondition[];
  rewards: DraftReward[];
}

function emptyForm(): FormState {
  return {
    code: '',
    name: '',
    type: 'PERCENT',
    valueCents: '',
    percentBp: '1100',
    minSubtotalCents: '0',
    maxDiscountCents: '',
    validFrom: '',
    validUntil: '',
    usageLimit: '',
    isActive: true,
    requiresMember: false,
    conditions: [],
    rewards: [
      { freeMenuItemId: '', freeQuantity: '1', discountPercentBp: '', discountCents: '' },
    ],
  };
}

function isoToLocal(iso?: string | null): string {
  if (!iso) return '';
  return iso.slice(0, 16);
}

function draftConditionsFromApi(conds: PromoCondition[]): DraftCondition[] {
  return conds.map((c) => ({
    menuItemId: c.menuItemId || '',
    categoryId: c.categoryId || '',
    minQuantity: String(c.minQuantity),
  }));
}

function draftRewardsFromApi(rewards: PromoReward[]): DraftReward[] {
  if (rewards.length === 0)
    return [{ freeMenuItemId: '', freeQuantity: '1', discountPercentBp: '', discountCents: '' }];
  return rewards.map((r) => ({
    freeMenuItemId: r.freeMenuItemId || '',
    freeQuantity: String(r.freeQuantity),
    discountPercentBp: r.discountPercentBp != null ? String(r.discountPercentBp) : '',
    discountCents: r.discountCents != null ? String(Math.round(r.discountCents / 100)) : '',
  }));
}

function idrToCents(s: string): number {
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10);
  return Number.isNaN(n) ? 0 : n * 100;
}

export default function PromosPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [promos, setPromos] = useState<Promo[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const canManage = user?.role === 'OWNER' || user?.role === 'MANAGER';

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listPromos();
      setPromos((res.data as Promo[]) || []);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal memuat promo');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canManage) {
      toast.error('Hanya Manager/Owner yang boleh mengelola promo');
      router.replace('/pos');
      return;
    }
    refresh();
  }, [canManage, refresh, router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [m, c] = await Promise.all([api.getMenuItems(), api.getCategories()]);
        if (!cancelled) {
          setMenuItems((m.data as MenuItem[]) || []);
          setCategories((c.data as Category[]) || []);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const menuMap = useMemo(() => new Map(menuItems.map((m) => [m.id, m])), [menuItems]);

  function openCreate() {
    setForm(emptyForm());
    setFormOpen(true);
  }

  function openEdit(p: Promo) {
    setForm({
      id: p.id,
      code: p.code,
      name: p.name,
      type: p.type,
      valueCents: p.valueCents != null ? String(Math.round(p.valueCents / 100)) : '',
      percentBp: p.percentBp != null ? String(p.percentBp) : '',
      minSubtotalCents: String(Math.round(p.minSubtotalCents / 100)),
      maxDiscountCents: p.maxDiscountCents != null ? String(Math.round(p.maxDiscountCents / 100)) : '',
      validFrom: isoToLocal(p.validFrom),
      validUntil: isoToLocal(p.validUntil),
      usageLimit: p.usageLimit != null ? String(p.usageLimit) : '',
      isActive: p.isActive,
      requiresMember: p.requiresMember,
      conditions: draftConditionsFromApi(p.conditions),
      rewards: draftRewardsFromApi(p.rewards),
    });
    setFormOpen(true);
  }

  function addCondition() {
    setForm({ ...form, conditions: [...form.conditions, { menuItemId: '', categoryId: '', minQuantity: '1' }] });
  }

  function removeCondition(idx: number) {
    setForm({ ...form, conditions: form.conditions.filter((_, i) => i !== idx) });
  }

  function updateCondition(idx: number, patch: Partial<DraftCondition>) {
    setForm({
      ...form,
      conditions: form.conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    });
  }

  function addReward() {
    setForm({
      ...form,
      rewards: [
        ...form.rewards,
        { freeMenuItemId: '', freeQuantity: '1', discountPercentBp: '', discountCents: '' },
      ],
    });
  }

  function removeReward(idx: number) {
    setForm({ ...form, rewards: form.rewards.filter((_, i) => i !== idx) });
  }

  function updateReward(idx: number, patch: Partial<DraftReward>) {
    setForm({
      ...form,
      rewards: form.rewards.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (!form.code.trim()) {
        toast.error('Kode promo wajib diisi');
        return;
      }
      if (!form.name.trim()) {
        toast.error('Nama promo wajib diisi');
        return;
      }
      if (!form.validUntil) {
        toast.error('Tanggal "Sampai" wajib diisi');
        return;
      }
      // Per-type value validation
      if (form.type === 'PERCENT' && !form.percentBp) {
        toast.error('Promo persen butuh nilai percentBp');
        return;
      }
      if (form.type === 'AMOUNT' && !form.valueCents) {
        toast.error('Promo nominal butuh valueCents');
        return;
      }

      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        type: form.type,
        valueCents: form.valueCents ? idrToCents(form.valueCents) : undefined,
        percentBp: form.percentBp ? parseInt(form.percentBp, 10) : undefined,
        minSubtotalCents: form.minSubtotalCents ? idrToCents(form.minSubtotalCents) : 0,
        maxDiscountCents: form.maxDiscountCents ? idrToCents(form.maxDiscountCents) : null,
        validFrom: form.validFrom ? new Date(form.validFrom).toISOString() : undefined,
        validUntil: new Date(form.validUntil).toISOString(),
        usageLimit: form.usageLimit ? parseInt(form.usageLimit, 10) : null,
        isActive: form.isActive,
        requiresMember: form.requiresMember,
        conditions: form.conditions
          .filter((c) => c.menuItemId || c.categoryId || parseInt(c.minQuantity || '0', 10) > 0)
          .map((c) => ({
            menuItemId: c.menuItemId || undefined,
            categoryId: c.categoryId || undefined,
            minQuantity: c.minQuantity ? parseInt(c.minQuantity, 10) : 1,
          })),
        rewards: form.rewards
          .filter(
            (r) =>
              r.freeMenuItemId ||
              r.discountPercentBp ||
              r.discountCents,
          )
          .map((r) => ({
            freeMenuItemId: r.freeMenuItemId || undefined,
            freeQuantity: r.freeQuantity ? parseInt(r.freeQuantity, 10) : 1,
            discountPercentBp: r.discountPercentBp ? parseInt(r.discountPercentBp, 10) : undefined,
            discountCents: r.discountCents ? idrToCents(r.discountCents) : undefined,
          })),
      };
      if (payload.rewards.length === 0) {
        toast.error('Minimal 1 reward harus diisi');
        return;
      }

      if (form.id) {
        await api.updatePromo(form.id, payload);
        toast.success('Promo diperbarui');
      } else {
        await api.createPromo(payload);
        toast.success('Promo dibuat');
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

  async function handleDelete(p: Promo) {
    if (!confirm(`Nonaktifkan promo "${p.name}"?`)) return;
    try {
      await api.deletePromo(p.id);
      toast.success('Promo dinonaktifkan');
      refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Gagal menghapus');
    }
  }

  async function handleToggle(p: Promo) {
    try {
      await api.updatePromo(p.id, { isActive: !p.isActive });
      refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Gagal mengubah status');
    }
  }

  function describePromo(p: Promo): string {
    switch (p.type) {
      case 'PERCENT':
        return `${((p.percentBp ?? 0) / 100).toFixed(1)}% off`;
      case 'AMOUNT':
        return `-${formatIDR(p.valueCents ?? 0)}`;
      case 'BUY_X_GET_Y':
        return `Beli X gratis Y (${p.rewards.length} reward)`;
      case 'BUNDLE':
        return `Bundle (${p.conditions.length} kondisi, ${p.rewards.length} reward)`;
    }
  }

  return (
    <div className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full overflow-y-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Promo</h1>
        <Button onClick={openCreate}>+ Promo Baru</Button>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Memuat…</p>
      ) : promos.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Belum ada promo. Buat promo pertama.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {promos.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {p.name}
                    <span className="ml-2 text-xs text-neutral-500 font-mono">{p.code}</span>
                  </CardTitle>
                  <Badge tone={p.isActive ? 'success' : 'muted'}>
                    {p.isActive ? 'Aktif' : 'Non-aktif'}
                  </Badge>
                </div>
                <CardDescription>
                  {TYPE_LABEL[p.type]} · {describePromo(p)}
                  {p.minSubtotalCents > 0 && ` · min ${formatIDR(p.minSubtotalCents)}`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex flex-wrap gap-1">
                  <Badge tone="info">{p.conditions.length} kondisi</Badge>
                  <Badge tone="info">{p.rewards.length} reward</Badge>
                  {p.usageLimit != null && (
                    <Badge tone="muted">
                      Dipakai: {p.usedCount}/{p.usageLimit}
                    </Badge>
                  )}
                </div>
                <div className="flex justify-between text-xs text-neutral-500">
                  <span>
                    {new Date(p.validFrom).toLocaleDateString('id-ID')}
                    {' – '}
                    {new Date(p.validUntil).toLocaleDateString('id-ID')}
                  </span>
                  {p.requiresMember && <span className="text-amber-400">Member only</span>}
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => openEdit(p)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleToggle(p)}>
                    {p.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-400" onClick={() => handleDelete(p)}>
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
              <DialogTitle>{form.id ? 'Edit Promo' : 'Promo Baru'}</DialogTitle>
              <CardDescription>Atur kode, tipe, kondisi, dan reward.</CardDescription>
            </div>
            <DialogClose />
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              {/* Basic info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Kode</label>
                  <Input
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                    placeholder="HEMAT20"
                    disabled={Boolean(form.id)}
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Nama</label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Diskon Akhir Pekan"
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Tipe</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as PromoType })}
                    className="flex h-10 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 text-sm text-neutral-900 dark:text-neutral-100"
                  >
                    <option value="PERCENT">Persen</option>
                    <option value="AMOUNT">Nominal</option>
                    <option value="BUY_X_GET_Y">Beli X Gratis Y</option>
                    <option value="BUNDLE">Bundle</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">
                    {form.type === 'PERCENT' ? 'Persen (basis points, 1100=11%)' : form.type === 'AMOUNT' ? 'Nominal Diskon (Rp)' : 'Nilai (opsional)'}
                  </label>
                  {form.type === 'PERCENT' ? (
                    <Input
                      inputMode="numeric"
                      value={form.percentBp}
                      onChange={(e) => setForm({ ...form, percentBp: e.target.value })}
                      placeholder="1100"
                    />
                  ) : form.type === 'AMOUNT' ? (
                    <Input
                      inputMode="numeric"
                      value={form.valueCents}
                      onChange={(e) => setForm({ ...form, valueCents: e.target.value })}
                      placeholder="10000"
                    />
                  ) : (
                    <Input
                      disabled
                      value="(atur di Reward)"
                      onChange={() => {}}
                    />
                  )}
                </div>
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Min Subtotal (Rp)</label>
                  <Input
                    inputMode="numeric"
                    value={form.minSubtotalCents}
                    onChange={(e) => setForm({ ...form, minSubtotalCents: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Maks Diskon (Rp)</label>
                  <Input
                    inputMode="numeric"
                    value={form.maxDiscountCents}
                    onChange={(e) => setForm({ ...form, maxDiscountCents: e.target.value })}
                    placeholder="(opsional)"
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Berlaku Dari</label>
                  <Input
                    type="datetime-local"
                    value={form.validFrom}
                    onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Sampai *</label>
                  <Input
                    type="datetime-local"
                    value={form.validUntil}
                    onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Batas Penggunaan</label>
                  <Input
                    inputMode="numeric"
                    value={form.usageLimit}
                    onChange={(e) => setForm({ ...form, usageLimit: e.target.value })}
                    placeholder="(opsional)"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-200">
                <input
                  type="checkbox"
                  checked={form.requiresMember}
                  onChange={(e) => setForm({ ...form, requiresMember: e.target.checked })}
                />
                Hanya untuk member
              </label>

              {/* Conditions */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Kondisi (semua harus terpenuhi)</h3>
                  <Button size="sm" variant="outline" onClick={addCondition}>
                    + Kondisi
                  </Button>
                </div>
                {form.conditions.length === 0 ? (
                  <p className="text-xs text-neutral-500">Tidak ada kondisi (berlaku untuk semua pesanan).</p>
                ) : (
                  <div className="space-y-2">
                    {form.conditions.map((c, idx) => (
                      <div
                        key={idx}
                        className="flex flex-wrap items-center gap-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md p-2 text-sm"
                      >
                        <select
                          value={c.menuItemId}
                          onChange={(e) =>
                            updateCondition(idx, { menuItemId: e.target.value, categoryId: '' })
                          }
                          className="h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 px-2 text-xs"
                        >
                          <option value="">— Pilih Menu —</option>
                          {menuItems.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <span className="text-neutral-500 text-xs">atau</span>
                        <select
                          value={c.categoryId}
                          onChange={(e) =>
                            updateCondition(idx, { categoryId: e.target.value, menuItemId: '' })
                          }
                          className="h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 px-2 text-xs"
                        >
                          <option value="">— Pilih Kategori —</option>
                          {categories.map((cat) => (
                            <option key={cat.id} value={cat.id}>
                              {cat.name}
                            </option>
                          ))}
                        </select>
                        <Input
                          className="w-20 h-8"
                          inputMode="numeric"
                          placeholder="Qty"
                          value={c.minQuantity}
                          onChange={(e) => updateCondition(idx, { minQuantity: e.target.value })}
                        />
                        <button
                          type="button"
                          onClick={() => removeCondition(idx)}
                          className="text-red-400 px-2"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Rewards */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Reward</h3>
                  <Button size="sm" variant="outline" onClick={addReward}>
                    + Reward
                  </Button>
                </div>
                <div className="space-y-2">
                  {form.rewards.map((r, idx) => (
                    <div
                      key={idx}
                      className="flex flex-wrap items-center gap-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md p-2 text-sm"
                    >
                      <select
                        value={r.freeMenuItemId}
                        onChange={(e) => updateReward(idx, { freeMenuItemId: e.target.value })}
                        className="h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 px-2 text-xs"
                      >
                        <option value="">— Item Gratis (opsional) —</option>
                        {menuItems.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                      <Input
                        className="w-20 h-8"
                        inputMode="numeric"
                        placeholder="Qty"
                        value={r.freeQuantity}
                        onChange={(e) => updateReward(idx, { freeQuantity: e.target.value })}
                      />
                      <Input
                        className="w-28 h-8"
                        inputMode="numeric"
                        placeholder="% bp"
                        value={r.discountPercentBp}
                        onChange={(e) => updateReward(idx, { discountPercentBp: e.target.value })}
                      />
                      <Input
                        className="w-28 h-8"
                        inputMode="numeric"
                        placeholder="Rp"
                        value={r.discountCents}
                        onChange={(e) => updateReward(idx, { discountCents: e.target.value })}
                      />
                      {form.rewards.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeReward(idx)}
                          className="text-red-400 px-2"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
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
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Batal
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim() || !form.code.trim()}>
              {saving ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
