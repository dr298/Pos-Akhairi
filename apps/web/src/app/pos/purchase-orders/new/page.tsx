'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, type Supplier, type PurchaseOrder } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { useAuth } from '@/hooks/useAuth';
import { formatIDR, parseIDR } from '@/lib/format';

interface InventoryOpt {
  id: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  costPerUnit: number; // decimal in IDR
}

interface LineDraft {
  inventoryItemId: string;
  qty: string; // user-typed string, supports decimals
  unitCostIdr: string; // user-typed IDR
  notes: string;
}

const emptyLine: LineDraft = { inventoryItemId: '', qty: '', unitCostIdr: '', notes: '' };

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [inventory, setInventory] = useState<InventoryOpt[]>([]);
  const [loadingInv, setLoadingInv] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([{ ...emptyLine }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
      router.replace('/pos');
      return;
    }
    void (async () => {
      try {
        const r = await api.listSuppliers({});
        setSuppliers(r.data.suppliers);
        if (r.data.suppliers.length > 0) {
          setSupplierId((cur) => cur || r.data.suppliers[0].id);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [user, router]);

  // Load inventory
  useEffect(() => {
    setLoadingInv(true);
    void (async () => {
      try {
        // The transfers/inventory route is being consolidated to a global
        // (non-branch-scoped) inventory endpoint. We hit the same path
        // without the trailing branch id; backend returns all active items.
        const res = await fetch('/api/transfers/inventory', {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        const items: InventoryOpt[] = (j.data?.items ?? []).map((it: any) => ({
          id: it.id,
          sku: it.sku,
          name: it.name,
          unit: it.unit,
          quantity: Number(it.quantity),
          costPerUnit: Number(it.costPerUnit),
        }));
        setInventory(items);
      } catch (e) {
        setError(`Gagal load inventory: ${(e as Error).message}`);
      } finally {
        setLoadingInv(false);
      }
    })();
  }, [user]);

  const totalCents = useMemo(() => {
    let total = 0;
    for (const ln of lines) {
      const q = parseFloat(ln.qty);
      const cents = parseIDR(ln.unitCostIdr);
      if (Number.isFinite(q) && q > 0) {
        total += Math.round(q * cents);
      }
    }
    return total;
  }, [lines]);

  const updateLine = (i: number, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((ln, idx) => (idx === i ? { ...ln, ...patch } : ln)));
  };
  const addLine = () => setLines((prev) => [...prev, { ...emptyLine }]);
  const removeLine = (i: number) =>
    setLines((prev) => prev.filter((_, idx) => idx !== i));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId) {
      setError('Pilih supplier');
      return;
    }
    const validLines = lines
      .map((ln) => ({
        inventoryItemId: ln.inventoryItemId,
        qtyOrdered: parseFloat(ln.qty),
        unitCostCents: parseIDR(ln.unitCostIdr),
        notes: ln.notes.trim() || null,
      }))
      .filter((l) => l.inventoryItemId && l.qtyOrdered > 0);
    if (validLines.length === 0) {
      setError('Minimal 1 item dengan qty > 0');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.createPurchaseOrder({
        supplierId,
        notes: notes.trim() || null,
        expectedAt: expectedAt ? new Date(expectedAt).toISOString() : null,
        items: validLines,
      });
      router.push(`/pos/purchase-orders/${r.data.purchaseOrder.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return null;

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-3 max-w-screen-2xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Buat Purchase Order</h1>
          <p className="text-xs sm:text-sm text-neutral-400">
            PO baru dimulai sebagai DRAFT — kirim ke supplier setelah disimpan
          </p>
        </div>
        <Link href="/pos/purchase-orders" className="text-xs text-red-400 hover:text-red-300">
          ← Kembali ke daftar PO
        </Link>
      </header>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded p-3 text-red-200 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-3">
        <Card>
          <CardHeader>
            <CardTitle>Header</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">Supplier *</label>
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                  required
                >
                  <option value="">— pilih supplier —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {suppliers.length === 0 && (
                  <p className="text-[10px] text-amber-400 mt-1">
                    Belum ada supplier. <Link href="/pos/suppliers" className="underline">Tambah supplier</Link> dulu.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs text-neutral-400 mb-1">Estimasi Tiba</label>
                <Input
                  type="date"
                  value={expectedAt}
                  onChange={(e) => setExpectedAt(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-neutral-400 mb-1">Catatan</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Catatan PO (opsional)"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Item ({lines.length})</CardTitle>
            <Button type="button" size="sm" variant="outline" onClick={addLine}>
              + Tambah Baris
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {loadingInv && (
              <div className="text-neutral-400 text-sm">Memuat inventory…</div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase text-neutral-500">
                  <tr>
                    <th className="text-left p-2">Item *</th>
                    <th className="text-right p-2 w-24">Qty *</th>
                    <th className="text-right p-2 w-32">Harga Satuan</th>
                    <th className="text-right p-2 w-32">Subtotal</th>
                    <th className="text-left p-2">Catatan</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((ln, i) => {
                    const inv = inventory.find((x) => x.id === ln.inventoryItemId);
                    const q = parseFloat(ln.qty);
                    const cents = parseIDR(ln.unitCostIdr);
                    const lineTotal =
                      Number.isFinite(q) && q > 0 ? Math.round(q * cents) : 0;
                    return (
                      <tr key={i} className="border-t border-neutral-800 align-top">
                        <td className="p-2">
                          <select
                            value={ln.inventoryItemId}
                            onChange={(e) => {
                              const id = e.target.value;
                              const picked = inventory.find((x) => x.id === id);
                              updateLine(i, {
                                inventoryItemId: id,
                                // Auto-fill last price if blank
                                unitCostIdr:
                                  ln.unitCostIdr ||
                                  (picked ? String(Math.round(Number(picked.costPerUnit) * 100) / 100) : ''),
                              });
                            }}
                            className="flex h-9 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
                            required
                          >
                            <option value="">— pilih item —</option>
                            {inventory.map((it) => (
                              <option key={it.id} value={it.id}>
                                {it.sku} — {it.name} ({it.unit})
                              </option>
                            ))}
                          </select>
                          {inv && (
                            <div className="text-[10px] text-neutral-500 mt-1">
                              Stok saat ini: {inv.quantity} {inv.unit}
                            </div>
                          )}
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            step="0.001"
                            min="0"
                            value={ln.qty}
                            onChange={(e) => updateLine(i, { qty: e.target.value })}
                            className="h-9 text-right"
                            placeholder="0"
                            required
                          />
                        </td>
                        <td className="p-2">
                          <Input
                            type="text"
                            value={ln.unitCostIdr}
                            onChange={(e) => updateLine(i, { unitCostIdr: e.target.value })}
                            className="h-9 text-right"
                            placeholder="0"
                            required
                          />
                          <div className="text-[10px] text-neutral-500 mt-1">
                            per {inv?.unit ?? 'unit'}
                          </div>
                        </td>
                        <td className="p-2 text-right font-mono text-xs">
                          {formatIDR(lineTotal)}
                        </td>
                        <td className="p-2">
                          <Input
                            value={ln.notes}
                            onChange={(e) => updateLine(i, { notes: e.target.value })}
                            className="h-9"
                            placeholder="(opsional)"
                          />
                        </td>
                        <td className="p-2">
                          <button
                            type="button"
                            onClick={() => removeLine(i)}
                            disabled={lines.length === 1}
                            className="text-red-400 hover:text-red-300 text-xs disabled:opacity-30"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-neutral-700">
                    <td colSpan={3} className="p-2 text-right text-sm font-semibold">
                      Total
                    </td>
                    <td className="p-2 text-right font-mono text-sm font-semibold">
                      {formatIDR(totalCents)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-2">
          <Link href="/pos/purchase-orders">
            <Button type="button" variant="outline" size="md">
              Batal
            </Button>
          </Link>
          <Button type="submit" size="md" disabled={submitting}>
            {submitting ? 'Menyimpan…' : 'Simpan sebagai DRAFT'}
          </Button>
        </div>
      </form>
    </div>
  );
}
