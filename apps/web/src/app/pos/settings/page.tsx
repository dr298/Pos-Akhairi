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
  // Sprint 15 — general business identity.
  const [businessName, setBusinessName] = useState<string>('');
  const [businessAddress, setBusinessAddress] = useState<string>('');
  const [receiptFooter, setReceiptFooter] = useState<string>('');
  const [savingGeneral, setSavingGeneral] = useState(false);
  // Sprint 19 — printer paper width. Default 80mm.
  const [paperWidthMm, setPaperWidthMm] = useState<58 | 80>(80);
  const [savingPaper, setSavingPaper] = useState(false);
  // Payment Providers — Xendit & Midtrans keys
  const [xenditSecretKey, setXenditSecretKey] = useState<string>('');
  const [xenditWebhookSecret, setXenditWebhookSecret] = useState<string>('');
  const [xenditPublicKey, setXenditPublicKey] = useState<string>('');
  const [midtransServerKey, setMidtransServerKey] = useState<string>('');
  const [midtransClientKey, setMidtransClientKey] = useState<string>('');
  const [midtransEnv, setMidtransEnv] = useState<'sandbox' | 'production'>('sandbox');
  const [savingPayment, setSavingPayment] = useState(false);
  const [showKeys, setShowKeys] = useState(false);

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
        // Sprint 15 — hydrate business identity fields.
        const name = res.data.settings.find((s) => s.key === 'BUSINESS_NAME');
        if (name) setBusinessName(name.value);
        const addr = res.data.settings.find((s) => s.key === 'BUSINESS_ADDRESS');
        if (addr) setBusinessAddress(addr.value);
        const footer = res.data.settings.find((s) => s.key === 'RECEIPT_FOOTER');
        if (footer) setReceiptFooter(footer.value);
        // Sprint 19 — hydrate paper width from settings.
        const pw = res.data.settings.find((s) => s.key === 'PRINTER_PAPER_WIDTH');
        if (pw && (pw.value === '58' || pw.value === '80')) {
          setPaperWidthMm(pw.value === '58' ? 58 : 80);
        }
        // Payment providers — hydrate keys
        const xsk = res.data.settings.find((s) => s.key === 'XENDIT_SECRET_KEY');
        if (xsk) setXenditSecretKey(xsk.value);
        const xwh = res.data.settings.find((s) => s.key === 'XENDIT_WEBHOOK_SECRET');
        if (xwh) setXenditWebhookSecret(xwh.value);
        const xpk = res.data.settings.find((s) => s.key === 'XENDIT_PUBLIC_KEY');
        if (xpk) setXenditPublicKey(xpk.value);
        const msk = res.data.settings.find((s) => s.key === 'MIDTRANS_SERVER_KEY');
        if (msk) setMidtransServerKey(msk.value);
        const mck = res.data.settings.find((s) => s.key === 'MIDTRANS_CLIENT_KEY');
        if (mck) setMidtransClientKey(mck.value);
        const menv = res.data.settings.find((s) => s.key === 'MIDTRANS_ENV');
        if (menv && (menv.value === 'sandbox' || menv.value === 'production')) {
          setMidtransEnv(menv.value);
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

  const saveGeneral = async () => {
    if (!businessName.trim()) {
      toast.error('Nama bisnis tidak boleh kosong');
      return;
    }
    setSavingGeneral(true);
    try {
      await api.upsertSetting('BUSINESS_NAME', businessName.trim(), null);
      await api.upsertSetting('BUSINESS_ADDRESS', businessAddress.trim(), null);
      await api.upsertSetting('RECEIPT_FOOTER', receiptFooter.trim(), null);
      toast.success('Identitas bisnis disimpan');
      const res = await api.listSettings();
      setSettings(res.data.settings);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal menyimpan';
      toast.error(msg);
    } finally {
      setSavingGeneral(false);
    }
  };

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

  const savePayment = async () => {
    setSavingPayment(true);
    try {
      await api.upsertSetting('XENDIT_SECRET_KEY', xenditSecretKey || '', null);
      await api.upsertSetting('XENDIT_WEBHOOK_SECRET', xenditWebhookSecret || '', null);
      await api.upsertSetting('XENDIT_PUBLIC_KEY', xenditPublicKey || '', null);
      await api.upsertSetting('MIDTRANS_SERVER_KEY', midtransServerKey || '', null);
      await api.upsertSetting('MIDTRANS_CLIENT_KEY', midtransClientKey || '', null);
      await api.upsertSetting('MIDTRANS_ENV', midtransEnv, null);
      toast.success('Payment config disimpan');
      const res = await api.listSettings();
      setSettings(res.data.settings);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal menyimpan payment config';
      toast.error(msg);
    } finally {
      setSavingPayment(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="p-6 text-zinc-500">Memuat…</div>
    );
  }

  const ppnBp = settings.find((s) => s.key === 'DEFAULT_PPN_BP');

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Settings</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Pengaturan global resto. Perubahan tersimpan ke database dan langsung berlaku
          untuk order berikutnya. <span className="text-amber-600 dark:text-amber-400 font-medium">Hanya OWNER yang bisa mengubah.</span>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identitas Bisnis (General)</CardTitle>
          <CardDescription>
            Nama, alamat, dan pesan penutup yang muncul di struk dan header POS.
            Berlaku untuk semua order berikutnya.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block mb-1">
              Nama Bisnis <span className="text-rose-400">*</span>
            </label>
            <Input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Bakmie BKJ"
              maxLength={80}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block mb-1">
              Alamat
            </label>
            <Input
              type="text"
              value={businessAddress}
              onChange={(e) => setBusinessAddress(e.target.value)}
              placeholder="Jl. Raya Serang No. 88, Tangerang"
              maxLength={200}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block mb-1">
              Footer Struk
            </label>
            <Input
              type="text"
              value={receiptFooter}
              onChange={(e) => setReceiptFooter(e.target.value)}
              placeholder="Terima kasih, sampai jumpa lagi!"
              maxLength={200}
            />
            <p className="mt-1 text-[10px] text-zinc-500">
              Pesan penutup di bawah struk. Kosongkan untuk default "Terima kasih!".
            </p>
          </div>
          <div className="flex justify-end">
            <Button onClick={saveGeneral} disabled={savingGeneral}>
              {savingGeneral ? 'Menyimpan…' : 'Simpan Identitas'}
            </Button>
          </div>
        </CardContent>
      </Card>

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
          <CardTitle>Printer Thermal</CardTitle>
          <CardDescription>
            Lebar kertas printer Bluetooth. 80mm = 42 karakter per baris (lebih
            luang). 58mm = 32 karakter per baris (lebih hemat kertas).
            Berlaku untuk struk BT dan preview print browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block mb-1">
                Lebar Kertas
              </label>
              <div className="flex gap-2">
                <Button
                  variant={paperWidthMm === 80 ? 'primary' : 'outline'}
                  onClick={() => setPaperWidthMm(80)}
                  type="button"
                >
                  80mm
                </Button>
                <Button
                  variant={paperWidthMm === 58 ? 'primary' : 'outline'}
                  onClick={() => setPaperWidthMm(58)}
                  type="button"
                >
                  58mm
                </Button>
              </div>
            </div>
            <Button
              onClick={async () => {
                setSavingPaper(true);
                try {
                  await api.upsertSetting(
                    'PRINTER_PAPER_WIDTH',
                    String(paperWidthMm),
                    null,
                  );
                  const res = await api.listSettings();
                  setSettings(res.data.settings);
                  toast.success(`Paper width diset ke ${paperWidthMm}mm`);
                } catch (e) {
                  toast.error('Gagal menyimpan paper width');
                } finally {
                  setSavingPaper(false);
                }
              }}
              disabled={savingPaper}
            >
              {savingPaper ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </div>
          {settings.find((s) => s.key === 'PRINTER_PAPER_WIDTH') && (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>Aktif:</span>
              <Badge>
                {settings.find((s) => s.key === 'PRINTER_PAPER_WIDTH')?.value}mm
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment Providers</CardTitle>
          <CardDescription>
            Konfigurasi API key untuk payment gateway. Nilai di sini meng-override env var.
            Kosongkan untuk gunakan default dari environment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => setShowKeys(!showKeys)}
              type="button"
            >
              {showKeys ? 'Sembunyikan Key' : 'Tampilkan Key'}
            </Button>
          </div>

          {/* Xendit */}
          <div>
            <h4 className="text-sm font-medium text-zinc-800 dark:text-zinc-200 mb-3">Xendit</h4>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block mb-1">
                  Secret Key
                </label>
                {showKeys ? (
                  <Input
                    type="text"
                    value={xenditSecretKey}
                    onChange={(e) => setXenditSecretKey(e.target.value)}
                    placeholder="xnd_development_xxx..."
                    maxLength={200}
                  />
                ) : (
                  <div className="flex items-center h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-sm text-zinc-400">
                    <Badge>{xenditSecretKey ? '••••••••' : 'Belum diatur'}</Badge>
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block mb-1">
                  Webhook Secret
                </label>
                {showKeys ? (
                  <Input
                    type="text"
                    value={xenditWebhookSecret}
                    onChange={(e) => setXenditWebhookSecret(e.target.value)}
                    placeholder="your_webhook_token"
                    maxLength={200}
                  />
                ) : (
                  <div className="flex items-center h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-sm text-zinc-400">
                    <Badge>{xenditWebhookSecret ? '••••••••' : 'Belum diatur'}</Badge>
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block mb-1">
                  Public Key
                </label>
                {showKeys ? (
                  <Input
                    type="text"
                    value={xenditPublicKey}
                    onChange={(e) => setXenditPublicKey(e.target.value)}
                    placeholder="xnd_public_xxx..."
                    maxLength={200}
                  />
                ) : (
                  <div className="flex items-center h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-sm text-zinc-400">
                    <Badge>{xenditPublicKey ? '••••••••' : 'Belum diatur'}</Badge>
                  </div>
                )}
              </div>
            </div>
          </div>

          <hr className="border-zinc-200 dark:border-zinc-800" />

          {/* Midtrans */}
          <div>
            <h4 className="text-sm font-medium text-zinc-800 dark:text-zinc-200 mb-3">Midtrans</h4>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block mb-1">
                  Server Key
                </label>
                {showKeys ? (
                  <Input
                    type="text"
                    value={midtransServerKey}
                    onChange={(e) => setMidtransServerKey(e.target.value)}
                    placeholder="SB-Mid-server-xxx..."
                    maxLength={200}
                  />
                ) : (
                  <div className="flex items-center h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-sm text-zinc-400">
                    <Badge>{midtransServerKey ? '••••••••' : 'Belum diatur'}</Badge>
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block mb-1">
                  Client Key
                </label>
                {showKeys ? (
                  <Input
                    type="text"
                    value={midtransClientKey}
                    onChange={(e) => setMidtransClientKey(e.target.value)}
                    placeholder="SB-Mid-client-xxx..."
                    maxLength={200}
                  />
                ) : (
                  <div className="flex items-center h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-sm text-zinc-400">
                    <Badge>{midtransClientKey ? '••••••••' : 'Belum diatur'}</Badge>
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block mb-1">
                  Environment
                </label>
                <div className="flex gap-2">
                  <Button
                    variant={midtransEnv === 'sandbox' ? 'primary' : 'outline'}
                    onClick={() => setMidtransEnv('sandbox')}
                    type="button"
                  >
                    Sandbox
                  </Button>
                  <Button
                    variant={midtransEnv === 'production' ? 'primary' : 'outline'}
                    onClick={() => setMidtransEnv('production')}
                    type="button"
                  >
                    Production
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={savePayment} disabled={savingPayment}>
              {savingPayment ? 'Menyimpan…' : 'Simpan Payment Config'}
            </Button>
          </div>
        </CardContent>
      </Card>

      
      <Card>
        <CardHeader>
          <CardTitle>Rekening Bank</CardTitle>
          <CardDescription>
            Master data rekening untuk metode pembayaran Manual Transfer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <a href="/pos/settings/bank-accounts" className="text-blue-600 hover:underline text-sm">
            Kelola Rekening Bank →
          </a>
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
          <div className="overflow-x-auto">
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
