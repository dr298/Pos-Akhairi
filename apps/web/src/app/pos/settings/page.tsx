'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface Setting {
  key: string;
  value: string;
  description: string | null;
  updatedById: string | null;
  updatedAt: string;
  createdAt: string;
}

export default function PosSettingsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [ppnPercent, setPpnPercent] = useState<string>('0');
  const [saving, setSaving] = useState(false);

  // Route guard: OWNER only (settings can change tax behaviour for the
  // whole resto; we don't want any cashier to flip this).
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

  // Pull existing settings on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.listSettings();
        if (cancelled) return;
        setSettings(res.data.settings);
        const ppn = res.data.settings.find((s) => s.key === 'DEFAULT_PPN_BP');
        if (ppn) {
          // Display in percent (divide by 100). "1100" basis points → "11"
          setPpnPercent((Number(ppn.value) / 100).toString());
        }
      } catch (e) {
        toast.error('Gagal memuat settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const savePpn = async () => {
    const percent = Number(ppnPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      toast.error('PPN harus 0-100%');
      return;
    }
    setSaving(true);
    try {
      const bp = Math.round(percent * 100);
      await api.upsertSetting('DEFAULT_PPN_BP', String(bp), 'Default PPN / VAT rate in basis points');
      toast.success(`PPN diset ke ${percent}% (${bp} basis points)`);
      // Reload
      const res = await api.listSettings();
      setSettings(res.data.settings);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal menyimpan';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="p-6 text-zinc-500">Memuat…</div>
    );
  }

  const ppnBp = settings.find((s) => s.key === 'DEFAULT_PPN_BP');

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Settings</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Pengaturan global resto. Perubahan tersimpan ke database dan langsung berlaku
          untuk order berikutnya.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>PPN / Pajak</CardTitle>
          <CardDescription>
            Tarif PPN default yang ditambahkan ke setiap order. Disimpan dalam basis
            points (11% = 1100). Kalau 0%, kolom PPN hilang dari POS dan struk.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block mb-1">
                PPN (%)
              </label>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={ppnPercent}
                onChange={(e) => setPpnPercent(e.target.value)}
                placeholder="0"
              />
            </div>
            <Button onClick={savePpn} disabled={saving}>
              {saving ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </div>
          {ppnBp && (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>Aktif:</span>
              <Badge>
                {Number(ppnBp.value) === 0
                  ? 'Non-PPN (PPN tidak ditampilkan)'
                  : `${Number(ppnBp.value) / 100}%`}
              </Badge>
              <span>·</span>
              <span>
                Update terakhir: {new Date(ppnBp.updatedAt).toLocaleString('id-ID')}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pengaturan lain</CardTitle>
          <CardDescription>
            Daftar semua setting aktif. Hanya key yang dikenali yang bisa diubah dari
            sini (lihat <code>KNOWN_SETTINGS</code> di service).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2">Key</th>
                <th className="py-2">Value</th>
                <th className="py-2">Update</th>
              </tr>
            </thead>
            <tbody>
              {settings.map((s) => (
                <tr key={s.key} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="py-2 font-mono text-xs">{s.key}</td>
                  <td className="py-2 font-mono text-xs">{s.value}</td>
                  <td className="py-2 text-zinc-500 text-xs">
                    {new Date(s.updatedAt).toLocaleString('id-ID')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
