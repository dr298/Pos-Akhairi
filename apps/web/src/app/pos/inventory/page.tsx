'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from 'sonner';

interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  unit: string;
  quantity: string;          // Decimal-as-string
  reorderPoint: string;
  costPerUnit: string;
  isActive?: boolean;
}

const formatIDR = (cents: number) =>
  `Rp ${Number(cents).toLocaleString('id-ID')}`;

export default function InventoryStockPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/inventory', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setItems(json.data?.items ?? []);
    } catch (e) {
      console.error('inventory load failed', e);
      toast.error('Gagal memuat data stok');
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold">Stok Bahan Baku</h1>
        <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
          Daftar semua bahan baku beserta jumlah stok saat ini.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama / SKU…"
          className="flex-1 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm"
        />
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? 'Memuat…' : 'Refresh'}
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent>
            <div className="text-sm text-neutral-500 py-4 text-center">Memuat…</div>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent>
            <div className="text-sm text-neutral-500 py-4 text-center">Tidak ada item.</div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase text-neutral-500 border-b border-neutral-200 dark:border-neutral-800">
                    <th className="text-left py-2 pr-3">SKU</th>
                    <th className="text-left py-2 pr-3">Nama</th>
                    <th className="text-right py-2 pr-3">Stok</th>
                    <th className="text-right py-2 pr-3">Reorder Pt</th>
                    <th className="text-right py-2 pr-3">Harga/Unit</th>
                    <th className="text-center py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((it) => {
                    const qty = Number(it.quantity);
                    const reorder = Number(it.reorderPoint);
                    const isLow = !Number.isNaN(qty) && !Number.isNaN(reorder) && qty < reorder;
                    const active = it.isActive ?? true;
                    return (
                      <tr
                        key={it.id}
                        className="border-b border-neutral-200 dark:border-neutral-800"
                      >
                        <td className="py-2 pr-3 font-mono text-xs text-neutral-500">{it.sku}</td>
                        <td className="py-2 pr-3 font-medium">
                          {it.name}
                          {isLow && (
                            <Badge tone="warning" className="ml-2">
                              Stok rendah
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {qty.toLocaleString('id-ID', { maximumFractionDigits: 4 })} {it.unit}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {reorder.toLocaleString('id-ID', { maximumFractionDigits: 4 })} {it.unit}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatIDR(Number(it.costPerUnit))} /{it.unit}
                        </td>
                        <td className="py-2 text-center">
                          <Badge tone={active ? 'success' : 'muted'}>
                            {active ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
