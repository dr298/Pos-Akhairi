'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type Supplier } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { useAuth } from '@/hooks/useAuth';

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
}

export default function SuppliersPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.listSuppliers({
        includeInactive,
        search: search.trim() || undefined,
      });
      setSuppliers(r.data.suppliers);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user, includeInactive, search]);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
      router.replace('/pos');
      return;
    }
    void load();
  }, [user, router, load]);

  // Auth guard — after all hooks (React rule #310).
  const isAuthorized = user?.role === 'OWNER' || user?.role === 'MANAGER';

  if (!isAuthorized) {
    if (!user) return null;
    router.replace('/pos');
    return null;
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 md:p-6 space-y-3 max-w-screen-2xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Supplier</h1>
          <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
            Daftar vendor / pemasok stok untuk branch ini
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Cari nama / telepon…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48"
          />
          <label className="flex items-center gap-1 text-xs text-neutral-700 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="accent-red-600"
            />
            Tampilkan non-aktif
          </label>
          <Button size="sm" variant="outline" onClick={load}>
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            + Tambah Supplier
          </Button>
        </div>
      </header>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded p-3 text-red-200 text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Daftar Supplier ({suppliers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-neutral-500">
                <tr>
                  <th className="text-left p-2">Nama</th>
                  <th className="text-left p-2">Kontak</th>
                  <th className="text-left p-2">Telepon</th>
                  <th className="text-left p-2">Email</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Dibuat</th>
                  <th className="text-left p-2">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id} className="border-t border-neutral-200 dark:border-neutral-800 hover:bg-white dark:bg-neutral-900/40">
                    <td className="p-2">
                      <div className="font-medium">{s.name}</div>
                      {s.notes && (
                        <div className="text-[10px] text-neutral-500 truncate max-w-xs">
                          {s.notes}
                        </div>
                      )}
                    </td>
                    <td className="p-2 text-xs">{s.contactName || '—'}</td>
                    <td className="p-2 text-xs">{s.phone || '—'}</td>
                    <td className="p-2 text-xs">{s.email || '—'}</td>
                    <td className="p-2">
                      <Badge
                        tone={s.isActive ? 'success' : 'muted'}
                        className="text-[10px]"
                      >
                        {s.isActive ? 'Aktif' : 'Non-aktif'}
                      </Badge>
                    </td>
                    <td className="p-2 text-xs text-neutral-500 dark:text-neutral-400">
                      {fmtDateTime(s.createdAt)}
                    </td>
                    <td className="p-2">
                      <button
                        type="button"
                        onClick={() => setEditing(s)}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {suppliers.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="text-center text-neutral-500 py-6">
                      Belum ada supplier
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {loading && <div className="text-neutral-500 dark:text-neutral-400 text-sm py-3">Memuat…</div>}
        </CardContent>
      </Card>

      {showCreate && (
        <SupplierFormModal
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}
      {editing && (
        <SupplierFormModal
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function SupplierFormModal({
  existing,
  onClose,
  onSaved,
}: {
  existing?: Supplier;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [contactName, setContactName] = useState(existing?.contactName ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [address, setAddress] = useState(existing?.address ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Nama wajib diisi');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        contactName: contactName.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
        isActive,
      };
      if (existing) {
        await api.updateSupplier(existing.id, payload);
      } else {
        await api.createSupplier(payload);
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-white dark:bg-black/60 flex items-center justify-center p-3 z-50">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <form onSubmit={onSubmit}>
          <div className="p-4 border-b border-neutral-200 dark:border-neutral-800">
            <h2 className="text-lg font-semibold">
              {existing ? 'Edit Supplier' : 'Tambah Supplier'}
            </h2>
          </div>
          <div className="p-4 space-y-3">
            {error && (
              <div className="bg-red-900/30 border border-red-700 rounded p-2 text-red-200 text-sm">
                {error}
              </div>
            )}
            <div>
              <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Nama *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Nama Kontak</label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Telepon</label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Alamat</label>
              <Textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                rows={2}
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Catatan</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="accent-red-600"
              />
              <span>Aktif (supplier non-aktif tidak muncul di pilihan PO)</span>
            </label>
          </div>
          <div className="p-3 border-t border-neutral-200 dark:border-neutral-800 flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Menyimpan…' : existing ? 'Simpan Perubahan' : 'Tambah'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
