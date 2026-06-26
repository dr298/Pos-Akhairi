'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { api, type Discount, type DiscountType, ApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogClose } from '@/components/ui/Dialog';
import { formatIDR } from '@/lib/format';

interface FormState {
  id?: string;
  code: string;
  name: string;
  type: DiscountType;
  value: string;
  minOrderCents: string;
  maxDiscountCents: string;
  validFrom: string;
  validUntil: string;
  usageLimit: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  code: '',
  name: '',
  type: 'PERCENTAGE',
  value: '10',
  minOrderCents: '0',
  maxDiscountCents: '',
  validFrom: '',
  validUntil: '',
  usageLimit: '',
  isActive: true,
};

export default function DiscountsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const canManage = user?.role === 'OWNER' || user?.role === 'MANAGER';

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listDiscounts();
      setDiscounts(res.data || []);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal memuat diskon');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canManage) {
      toast.error('Hanya Manager/Owner yang boleh mengelola diskon');
      router.replace('/pos');
      return;
    }
    refresh();
  }, [canManage, refresh, router]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(d: Discount) {
    setForm({
      id: d.id,
      code: d.code || '',
      name: d.name,
      type: d.type,
      value: String(d.value),
      minOrderCents: String(d.minOrderCents),
      maxDiscountCents: d.maxDiscountCents != null ? String(d.maxDiscountCents) : '',
      validFrom: d.validFrom ? d.validFrom.slice(0, 16) : '',
      validUntil: d.validUntil ? d.validUntil.slice(0, 16) : '',
      usageLimit: d.usageLimit != null ? String(d.usageLimit) : '',
      isActive: d.isActive,
    });
    setFormOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const value = Number(form.value);
      if (Number.isNaN(value) || value < 0) {
        toast.error('Nilai diskon tidak valid');
        return;
      }
      const payload = {
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        type: form.type,
        value: form.type === 'PERCENTAGE' ? Math.round(value) : Math.round(value * 100),
        minOrderCents: Number(form.minOrderCents) || 0,
        maxDiscountCents: form.maxDiscountCents ? Number(form.maxDiscountCents) : null,
        validFrom: form.validFrom ? new Date(form.validFrom).toISOString() : undefined,
        validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : undefined,
        usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
        isActive: form.isActive,
      };
      if (form.id) {
        await api.updateDiscount(form.id, payload);
        toast.success('Diskon diperbarui');
      } else {
        await api.createDiscount(payload);
        toast.success('Diskon dibuat');
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

  async function handleDelete(d: Discount) {
    if (!confirm(`Hapus diskon "${d.name}"?`)) return;
    try {
      await api.deleteDiscount(d.id);
      toast.success('Diskon dinonaktifkan');
      refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Gagal menghapus');
    }
  }

  async function handleToggle(d: Discount) {
    try {
      await api.updateDiscount(d.id, { isActive: !d.isActive });
      refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Gagal mengubah status');
    }
  }

  return (
    <div className="flex-1 p-4 sm:p-6 max-w-5xl mx-auto w-full overflow-y-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Diskon</h1>
        <Button onClick={openCreate}>+ Diskon Baru</Button>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Memuat…</p>
      ) : discounts.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Belum ada diskon. Buat diskon pertama.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {discounts.map((d) => (
            <Card key={d.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {d.name}
                    {d.code && <span className="ml-2 text-xs text-neutral-500 font-mono">{d.code}</span>}
                  </CardTitle>
                  <Badge tone={d.isActive ? 'success' : 'muted'}>
                    {d.isActive ? 'Aktif' : 'Non-aktif'}
                  </Badge>
                </div>
                <CardDescription>
                  {d.type === 'PERCENTAGE' ? `${d.value}%` : `-${formatIDR(d.value)}`}
                  {d.minOrderCents > 0 && ` · min ${formatIDR(d.minOrderCents)}`}
                  {d.maxDiscountCents != null && ` · max ${formatIDR(d.maxDiscountCents)}`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between text-xs text-neutral-500">
                  <span>Dipakai: {d.usageCount}{d.usageLimit ? `/${d.usageLimit}` : ''}</span>
                  <span>
                    {d.validFrom ? new Date(d.validFrom).toLocaleDateString('id-ID') : '∞'}
                    {' – '}
                    {d.validUntil ? new Date(d.validUntil).toLocaleDateString('id-ID') : '∞'}
                  </span>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => openEdit(d)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => handleToggle(d)}>
                    {d.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-400" onClick={() => handleDelete(d)}>
                    Hapus
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={(v) => !saving && setFormOpen(v)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div>
              <DialogTitle>{form.id ? 'Edit Diskon' : 'Diskon Baru'}</DialogTitle>
              <CardDescription>Atur kode, nilai, dan masa berlaku.</CardDescription>
            </div>
            <DialogClose />
          </DialogHeader>
          <DialogBody>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Nama</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Diskon Hari Raya"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Kode (opsional)</label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="HEMAT10"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Tipe</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as DiscountType })}
                    className="flex h-10 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 text-sm text-neutral-900 dark:text-neutral-100"
                  >
                    <option value="PERCENTAGE">Persen (%)</option>
                    <option value="FIXED">Nominal (Rp)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">
                    Nilai {form.type === 'PERCENTAGE' ? '(%)' : '(Rp)'}
                  </label>
                  <Input
                    inputMode="numeric"
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Min Order (Rp)</label>
                  <Input
                    inputMode="numeric"
                    value={form.minOrderCents}
                    onChange={(e) => setForm({ ...form, minOrderCents: e.target.value })}
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
              </div>
              <div className="grid grid-cols-2 gap-3">
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
              <div>
                <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Batas Penggunaan</label>
                <Input
                  inputMode="numeric"
                  value={form.usageLimit}
                  onChange={(e) => setForm({ ...form, usageLimit: e.target.value })}
                  placeholder="(opsional)"
                />
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
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
