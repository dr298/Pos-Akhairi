'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError, type Customer } from '@/lib/api';
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
import { formatIDR, formatNumber } from '@/lib/format';

interface FormState {
  id?: string;
  name: string;
  phone: string;
  email: string;
  birthday: string;
  address: string;
  notes: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  phone: '',
  email: '',
  birthday: '',
  address: '',
  notes: '',
  isActive: true,
};

export default function CustomersPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(
    async (q: string) => {
      setLoading(true);
      try {
        const res = await api.listCustomers({ search: q, limit: 100 });
        setCustomers(res.data || []);
      } catch (e: any) {
        toast.error(e?.message || 'Gagal memuat pelanggan');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      refresh(search);
    }, 250);
    return () => clearTimeout(t);
  }, [search, refresh]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(c: Customer) {
    setForm({
      id: c.id,
      name: c.name || '',
      phone: c.phone || '',
      email: c.email || '',
      birthday: c.birthday ? c.birthday.slice(0, 10) : '',
      address: c.address || '',
      notes: c.notes || '',
      isActive: c.isActive,
    });
    setFormOpen(true);
  }

  async function handleSave() {
    if (!form.phone.trim() && !form.email.trim()) {
      toast.error('Nomor HP atau email wajib diisi');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        birthday: form.birthday || undefined,
        address: form.address.trim() || undefined,
        notes: form.notes.trim() || undefined,
      };
      if (form.id) {
        await api.updateCustomer(form.id, {
          ...payload,
          birthday: form.birthday || null,
          address: form.address.trim() || null,
          notes: form.notes.trim() || null,
          isActive: form.isActive,
        });
        toast.success('Pelanggan diperbarui');
      } else {
        await api.createCustomer(payload);
        toast.success('Pelanggan dibuat');
      }
      setFormOpen(false);
      refresh(search);
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : e?.message || 'Gagal menyimpan';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(c: Customer) {
    try {
      await api.updateCustomer(c.id, { isActive: !c.isActive });
      toast.success(c.isActive ? 'Pelanggan dinonaktifkan' : 'Pelanggan diaktifkan');
      refresh(search);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal mengubah status');
    }
  }

  const role = user?.role;

  return (
    <div className="flex-1 p-4 sm:p-6 max-w-5xl mx-auto w-full overflow-y-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Pelanggan / Member</h1>
          <p className="text-xs text-neutral-500">
            Kelola data pelanggan dan program loyalitas. Pencarian berdasarkan nama, nomor HP, atau email.
          </p>
        </div>
        <Button onClick={openCreate}>+ Pelanggan Baru</Button>
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder="Cari nama / nomor HP / email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch('')}>
            Reset
          </Button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Memuat…</p>
      ) : customers.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {search
                ? 'Tidak ada pelanggan yang cocok dengan pencarian.'
                : 'Belum ada pelanggan. Buat pelanggan pertama.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {customers.map((c) => {
            const totalSpent =
              typeof c.totalSpentCents === 'string'
                ? Number(c.totalSpentCents)
                : c.totalSpentCents;
            return (
              <Card key={c.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base truncate">
                      {c.name || c.phone || c.email || 'Tanpa nama'}
                    </CardTitle>
                    <Badge tone={c.isActive ? 'success' : 'muted'}>
                      {c.isActive ? 'Aktif' : 'Non-aktif'}
                    </Badge>
                  </div>
                  <CardDescription>
                    {c.phone && <span className="font-mono text-xs">{c.phone}</span>}
                    {c.phone && c.email && ' · '}
                    {c.email && <span className="truncate">{c.email}</span>}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="grid grid-cols-2 gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                    <div>
                      <span className="text-neutral-500">Poin:</span>{' '}
                      <span className="text-amber-300 font-semibold">
                        {formatNumber(c.loyaltyPoints)}
                      </span>
                    </div>
                    <div>
                      <span className="text-neutral-500">Kunjungan:</span>{' '}
                      <span className="text-neutral-800 dark:text-neutral-200">{c.visitCount}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-neutral-500">Total belanja:</span>{' '}
                      <span className="text-neutral-800 dark:text-neutral-200">{formatIDR(totalSpent)}</span>
                    </div>
                    {c.lastVisitAt && (
                      <div className="col-span-2">
                        <span className="text-neutral-500">Kunjungan terakhir:</span>{' '}
                        <span className="text-neutral-700 dark:text-neutral-300">
                          {new Date(c.lastVisitAt).toLocaleString('id-ID')}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Link href={`/pos/customers/${c.id}`}>
                      <Button size="sm" variant="outline">Detail</Button>
                    </Link>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleToggle(c)}>
                      {c.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={(v) => !saving && setFormOpen(v)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div>
              <DialogTitle>{form.id ? 'Edit Pelanggan' : 'Pelanggan Baru'}</DialogTitle>
              <CardDescription>
                Minimal isi nomor HP atau email. Bisa dilengkapi nanti.
              </CardDescription>
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
                  placeholder="Budi Santoso"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Nomor HP *</label>
                  <Input
                    inputMode="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="0812…"
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Email</label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="budi@email.com"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Tanggal Lahir</label>
                <Input
                  type="date"
                  value={form.birthday}
                  onChange={(e) => setForm({ ...form, birthday: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Alamat</label>
                <Input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="(opsional)"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Catatan</label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Preferensi, alergi, dll."
                />
              </div>
              {form.id && (
                <label className="flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-200">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  />
                  Aktif
                </label>
              )}
              <p className="text-xs text-neutral-500">
                * Wajib isi salah satu: nomor HP atau email.
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Batal
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || (!form.phone.trim() && !form.email.trim())}
            >
              {saving ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
