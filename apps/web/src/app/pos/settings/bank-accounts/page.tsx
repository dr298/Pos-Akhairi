'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { api, BankAccount } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function BankAccountsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ bankName: '', accountName: '', accountNo: '' });

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    if (user.role !== 'OWNER') {
      router.push('/pos');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await api.listBankAccounts();
      setAccounts(res.data.accounts);
    } catch (e) {
      toast.error((e as Error).message || 'Gagal memuat data rekening');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setForm({ bankName: '', accountName: '', accountNo: '' });
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(account: BankAccount) {
    setForm({ bankName: account.bankName, accountName: account.accountName, accountNo: account.accountNo });
    setEditingId(account.id);
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.bankName || !form.accountName || !form.accountNo) {
      toast.error('Semua field wajib diisi');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.updateBankAccount(editingId, form);
        toast.success('Rekening berhasil diupdate');
      } else {
        await api.createBankAccount(form);
        toast.success('Rekening berhasil ditambahkan');
      }
      resetForm();
      await load();
    } catch (e) {
      toast.error((e as Error).message || 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Yakin ingin menghapus rekening ini?')) return;
    try {
      await api.deleteBankAccount(id);
      toast.success('Rekening berhasil dihapus');
      await load();
    } catch (e) {
      toast.error((e as Error).message || 'Gagal menghapus');
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 max-w-3xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Rekening Bank</h1>
          <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
            Master data rekening untuk metode pembayaran Manual Transfer
          </p>
        </div>
        <Button onClick={() => { resetForm(); setShowForm(true); }} size="sm">
          + Tambah Rekening
        </Button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{editingId ? 'Edit Rekening' : 'Tambah Rekening Baru'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-[10px] uppercase text-neutral-500 mb-1 block">Nama Bank</label>
              <Input
                value={form.bankName}
                onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                placeholder="BCA, Mandiri, BRI, dll"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-neutral-500 mb-1 block">Atas Nama</label>
              <Input
                value={form.accountName}
                onChange={(e) => setForm({ ...form, accountName: e.target.value })}
                placeholder="PT Bakmie Khas Jaksel"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-neutral-500 mb-1 block">Nomor Rekening</label>
              <Input
                value={form.accountNo}
                onChange={(e) => setForm({ ...form, accountNo: e.target.value })}
                placeholder="1234567890"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? 'Menyimpan...' : 'Simpan'}
              </Button>
              <Button onClick={resetForm} variant="outline" size="sm">Batal</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Accounts List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Daftar Rekening</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-neutral-500">Memuat...</p>
          ) : accounts.length === 0 ? (
            <p className="text-sm text-neutral-500">Belum ada rekening. Klik "Tambah Rekening" untuk menambahkan.</p>
          ) : (
            <div className="space-y-2">
              {accounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between p-3 border rounded dark:border-neutral-700"
                >
                  <div>
                    <div className="font-medium">{account.bankName}</div>
                    <div className="text-xs text-neutral-500">{account.accountName} — {account.accountNo}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => startEdit(account)} variant="outline" size="sm">Edit</Button>
                    <Button onClick={() => handleDelete(account.id)} variant="outline" size="sm" className="text-red-600">Hapus</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
