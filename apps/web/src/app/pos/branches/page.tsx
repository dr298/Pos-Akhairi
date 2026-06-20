'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type Branch } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/hooks/useAuth';

export default function BranchSettingsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [branch, setBranch] = useState<Branch | null>(null);
  const [ppnPercentBp, setPpnPercentBp] = useState<string>('0');
  const [ppnInclusive, setPpnInclusive] = useState(false);
  const [savingPpn, setSavingPpn] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    if (user.role !== 'OWNER') {
      router.push('/pos');
      return;
    }
    void (async () => {
      try {
        const r = await api.listBranches();
        const bs = (r.data?.branches ?? []) as Branch[];
        setBranches(bs);
        if (bs.length > 0) setSelectedId(bs[0].id);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [user, authLoading, router]);

  // Load selected branch
  useEffect(() => {
    if (!selectedId) return;
    void (async () => {
      try {
        const r = await api.getBranch(selectedId);
        const b = (r.data?.branch ?? null) as Branch | null;
        setBranch(b);
        if (b) {
          setPpnPercentBp((b.ppnPercent ?? 0).toString());
          setPpnInclusive(b.ppnInclusive ?? false);
          setName(b.name ?? '');
          setAddress(b.address ?? '');
          setCity(b.city ?? '');
          setPhone(b.phone ?? '');
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [selectedId]);

  const savePpn = async () => {
    if (!selectedId) return;
    setSavingPpn(true);
    setError(null);
    setInfo(null);
    try {
      const bp = parseInt(ppnPercentBp, 10);
      if (isNaN(bp) || bp < 0 || bp > 10000) {
        setError('PPN harus 0..10000 basis points (0..100%)');
        return;
      }
      const r = await api.updateBranchPpn(selectedId, {
        ppnPercent: bp,
        ppnInclusive,
      });
      setBranch((r.data as any).branch);
      setInfo('Konfigurasi PPN disimpan');
      setTimeout(() => setInfo(null), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingPpn(false);
    }
  };

  const saveInfo = async () => {
    if (!selectedId) return;
    setSavingInfo(true);
    setError(null);
    setInfo(null);
    try {
      const r = await api.updateBranch(selectedId, {
        name,
        address: address || null,
        city: city || null,
        phone: phone || null,
      });
      setBranch((r.data as any).branch);
      setInfo('Informasi cabang disimpan');
      setTimeout(() => setInfo(null), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingInfo(false);
    }
  };

  if (authLoading || !user) {
    return <div className="p-6 text-slate-400">Loading…</div>;
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Pengaturan Cabang</h1>
        <p className="text-sm text-slate-400 mt-1">
          Konfigurasi PPN per cabang (NPWP berbeda) dan info dasar cabang
        </p>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-800 text-red-200 text-sm rounded px-3 py-2">
          {error}
        </div>
      )}
      {info && (
        <div className="bg-emerald-950/40 border border-emerald-800 text-emerald-200 text-sm rounded px-3 py-2">
          {info}
        </div>
      )}

      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-400">Cabang:</label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="flex-1 max-w-xs bg-slate-800 border border-slate-700 text-slate-100 text-sm rounded px-3 py-1.5"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} — {b.name}
            </option>
          ))}
        </select>
      </div>

      {branch && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* PPN config */}
          <Card>
            <CardHeader>
              <CardTitle>Konfigurasi PPN</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-400">
                Berlaku untuk item dengan <code className="text-amber-400">useBranchPpn=true</code> dan{' '}
                <code className="text-amber-400">taxRateBp=0</code>. 1100 = 11%.
              </p>
              <div>
                <label className="text-xs text-slate-400 block mb-1">PPN (basis points)</label>
                <Input
                  type="number"
                  min={0}
                  max={10000}
                  step={50}
                  value={ppnPercentBp}
                  onChange={(e) => setPpnPercentBp(e.target.value)}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Saat ini: <span className="text-slate-300">{(parseInt(ppnPercentBp || '0', 10) / 100).toFixed(2)}%</span>
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={ppnInclusive}
                  onChange={(e) => setPpnInclusive(e.target.checked)}
                />
                PPN sudah termasuk di harga jual
              </label>
              <div className="flex gap-2 justify-end pt-2">
                <Button onClick={savePpn} disabled={savingPpn}>
                  {savingPpn ? 'Saving…' : 'Simpan PPN'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Branch info */}
          <Card>
            <CardHeader>
              <CardTitle>Informasi Cabang</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Nama *</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Alamat</label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Kota</label>
                  <Input value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Telepon</label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
              </div>
              <div className="text-xs text-slate-500 pt-1">Kode: {branch.code}</div>
              <div className="flex gap-2 justify-end pt-2">
                <Button onClick={saveInfo} disabled={savingInfo}>
                  {savingInfo ? 'Saving…' : 'Simpan Info'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Cara Kerja PPN Per Cabang</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-300 space-y-2">
          <p>
            Setiap item menu punya <code className="text-amber-400">taxRateBp</code> (default 1100 = 11%) dan flag{' '}
            <code className="text-amber-400">useBranchPpn</code>.
          </p>
          <ol className="list-decimal pl-5 space-y-1 text-slate-400">
            <li>
              Jika <code>useBranchPpn=false</code>, PPN item = <code>taxRateBp</code>.
            </li>
            <li>
              Jika <code>useBranchPpn=true</code> dan <code>taxRateBp &gt; 0</code>, item menang
              eksplisit.
            </li>
            <li>
              Jika <code>useBranchPpn=true</code> dan <code>taxRateBp=0</code>, pakai PPN cabang.
            </li>
            <li>
              Mode inklusif: harga jual sudah termasuk PPN, back-calculated dari subtotal
              PPN-bearing lines.
            </li>
          </ol>
          <p className="text-xs text-slate-500 pt-2">
            Set <code>useBranchPpn</code> via API/edit per item. UI manajemen menu belum expose
            field ini (todo Sprint 5.4 follow-up).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
