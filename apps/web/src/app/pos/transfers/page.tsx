'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, type StockTransfer, type StockTransferStatus, type Branch } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';

const STATUS_TONE: Record<StockTransferStatus, 'muted' | 'info' | 'success' | 'danger'> = {
  DRAFT: 'muted',
  IN_TRANSIT: 'info',
  RECEIVED: 'success',
  CANCELLED: 'danger',
};

const STATUS_LABEL: Record<StockTransferStatus, string> = {
  DRAFT: 'Draft',
  IN_TRANSIT: 'In Transit',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

interface InventoryItemOpt {
  id: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
}

export default function TransfersPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StockTransferStatus | 'ALL'>('ALL');
  const [selected, setSelected] = useState<StockTransfer | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { status?: string; branchId?: string } = {};
      if (statusFilter !== 'ALL') params.status = statusFilter;
      const r = await api.listTransfers(params);
      setTransfers(r.data.transfers);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
      router.replace('/pos');
      return;
    }
    void load();
  }, [user, router, load]);

  if (!user) return null;
  const branches = user.branchAccess?.map((b) => b.branch) ?? (user.branch ? [user.branch] : []);

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-3 max-w-screen-2xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Stock Transfer</h1>
          <p className="text-xs sm:text-sm text-neutral-400">
            Perpindahan stok antar branch — DRAFT → IN_TRANSIT → RECEIVED
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StockTransferStatus | 'ALL')}
            className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm text-neutral-100"
          >
            <option value="ALL">Semua status</option>
            <option value="DRAFT">Draft</option>
            <option value="IN_TRANSIT">In Transit</option>
            <option value="RECEIVED">Received</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <Button size="sm" variant="outline" onClick={load}>
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            + Buat Transfer
          </Button>
        </div>
      </header>

      {loading && <div className="text-neutral-400 text-sm">Memuat…</div>}
      {error && <div className="text-red-400 text-sm">Error: {error}</div>}

      <Card>
        <CardHeader>
          <CardTitle>Daftar Transfer ({transfers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-neutral-500">
                <tr>
                  <th className="text-left p-2">Created</th>
                  <th className="text-left p-2">From → To</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Items</th>
                  <th className="text-left p-2">Sent/Received</th>
                  <th className="text-left p-2">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id} className="border-t border-neutral-800 hover:bg-neutral-900/40">
                    <td className="p-2 text-xs text-neutral-400 whitespace-nowrap">{fmtDateTime(t.createdAt)}</td>
                    <td className="p-2">
                      <div className="text-sm">{t.fromBranch?.name ?? t.fromBranchId}</div>
                      <div className="text-[10px] text-neutral-500">→ {t.toBranch?.name ?? t.toBranchId}</div>
                    </td>
                    <td className="p-2">
                      <Badge tone={STATUS_TONE[t.status]} className="text-[10px]">{STATUS_LABEL[t.status]}</Badge>
                    </td>
                    <td className="p-2 text-xs">{t.items.length} item</td>
                    <td className="p-2 text-xs text-neutral-400">
                      <div>Sent: {fmtDateTime(t.sentAt)}</div>
                      <div>Recv: {fmtDateTime(t.receivedAt)}</div>
                    </td>
                    <td className="p-2">
                      <button
                        type="button"
                        onClick={() => setSelected(t)}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >
                        Detail
                      </button>
                    </td>
                  </tr>
                ))}
                {transfers.length === 0 && !loading && (
                  <tr><td colSpan={6} className="text-center text-neutral-500 py-6">Belum ada transfer</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {selected && (
        <TransferDetail
          transfer={selected}
          onClose={() => setSelected(null)}
          onChange={() => {
            void load();
            setSelected(null);
          }}
        />
      )}

      {showCreate && (
        <CreateTransferModal
          branches={branches}
          defaultFromBranchId={user.branchId}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            void load();
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

function TransferDetail({ transfer, onClose, onChange }: { transfer: StockTransfer; onClose: () => void; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiveOverrides, setReceiveOverrides] = useState<Record<string, number>>({});

  const onSend = async () => {
    if (!confirm('Kirim transfer ini? Stok di branch asal akan berkurang.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.sendTransfer(transfer.id);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onReceive = async () => {
    if (!confirm('Terima transfer ini? Stok di branch tujuan akan bertambah.')) return;
    setBusy(true);
    setError(null);
    try {
      const items = Object.entries(receiveOverrides).map(([transferItemId, qtyReceived]) => ({
        transferItemId,
        qtyReceived,
      }));
      await api.receiveTransfer(transfer.id, items.length > 0 ? items : undefined);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    if (!confirm('Batalkan transfer ini?')) return;
    setBusy(true);
    setError(null);
    try {
      await api.cancelTransfer(transfer.id);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" onClick={onClose}>
      <div
        className="bg-neutral-950 border border-neutral-800 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-neutral-950 border-b border-neutral-800 p-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Transfer Detail</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-100 text-xl">×</button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-neutral-500">From</div>
              <div className="text-neutral-100">{transfer.fromBranch?.name}</div>
              <div className="text-neutral-500">{transfer.fromBranch?.code}</div>
            </div>
            <div>
              <div className="text-neutral-500">To</div>
              <div className="text-neutral-100">{transfer.toBranch?.name}</div>
              <div className="text-neutral-500">{transfer.toBranch?.code}</div>
            </div>
            <div>
              <div className="text-neutral-500">Status</div>
              <Badge tone={STATUS_TONE[transfer.status]} className="text-[10px]">{STATUS_LABEL[transfer.status]}</Badge>
            </div>
            <div>
              <div className="text-neutral-500">Created by</div>
              <div className="text-neutral-100">{transfer.createdBy?.name ?? '—'}</div>
            </div>
            {transfer.notes && (
              <div className="col-span-2">
                <div className="text-neutral-500">Notes</div>
                <div className="text-neutral-200 whitespace-pre-wrap">{transfer.notes}</div>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Items</h3>
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-neutral-500">
                <tr>
                  <th className="text-left p-1">SKU</th>
                  <th className="text-left p-1">Item</th>
                  <th className="text-right p-1">Sent</th>
                  <th className="text-right p-1">Received</th>
                </tr>
              </thead>
              <tbody>
                {transfer.items.map((it) => {
                  const inv = it.inventoryItem;
                  const sent = it.qtyTransferred;
                  const recv = it.qtyReceived ?? sent;
                  const canEditRecv = transfer.status === 'IN_TRANSIT';
                  return (
                    <tr key={it.id} className="border-t border-neutral-800">
                      <td className="p-1 text-xs text-neutral-500">{inv?.sku ?? '—'}</td>
                      <td className="p-1">{inv?.name ?? it.inventoryItemId}</td>
                      <td className="p-1 text-right tabular-nums">{sent} {inv?.unit}</td>
                      <td className="p-1 text-right tabular-nums">
                        {canEditRecv ? (
                          <input
                            type="number"
                            min={0}
                            max={sent}
                            defaultValue={recv}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setReceiveOverrides((m) => ({ ...m, [it.id]: v }));
                            }}
                            className="w-20 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 text-right"
                          />
                        ) : (
                          <span>{it.qtyReceived ?? '—'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {transfer.status === 'IN_TRANSIT' && (
              <p className="text-[10px] text-neutral-500 mt-1">
                Kosongkan semua override = terima semua sesuai qty sent
              </p>
            )}
          </div>

          {error && <div className="text-red-400 text-xs">Error: {error}</div>}

          <div className="flex flex-wrap gap-2 pt-2 border-t border-neutral-800">
            {transfer.status === 'DRAFT' && (
              <>
                <Button size="sm" onClick={onSend} disabled={busy}>Kirim</Button>
                <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>Batal</Button>
              </>
            )}
            {transfer.status === 'IN_TRANSIT' && (
              <>
                <Button size="sm" onClick={onReceive} disabled={busy}>Terima</Button>
                <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>Batal (restore stok)</Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateTransferModal({
  branches,
  defaultFromBranchId,
  onClose,
  onCreated,
}: {
  branches: Branch[];
  defaultFromBranchId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [fromBranchId, setFromBranchId] = useState(defaultFromBranchId);
  const [toBranchId, setToBranchId] = useState(branches.find((b) => b.id !== defaultFromBranchId)?.id ?? '');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<InventoryItemOpt[]>([]);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [loadingInv, setLoadingInv] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load inventory for the source branch
  useEffect(() => {
    if (!fromBranchId) return;
    setLoadingInv(true);
    setPicked({});
    setItems([]);
    void (async () => {
      try {
        const res = await fetch(`/api/transfers/inventory/${fromBranchId}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        setItems(j.data?.items ?? []);
      } catch (e) {
        setError(`Gagal load inventory: ${(e as Error).message}`);
      } finally {
        setLoadingInv(false);
      }
    })();
  }, [fromBranchId]);

  const onSubmit = async () => {
    if (!fromBranchId || !toBranchId) {
      setError('Pilih branch asal dan tujuan');
      return;
    }
    if (fromBranchId === toBranchId) {
      setError('Branch asal dan tujuan harus berbeda');
      return;
    }
    const lines = Object.entries(picked)
      .filter(([, q]) => q > 0)
      .map(([inventoryItemId, qtyTransferred]) => ({ inventoryItemId, qtyTransferred }));
    if (lines.length === 0) {
      setError('Pilih minimal 1 item dengan qty > 0');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.createTransfer({ fromBranchId, toBranchId, notes: notes || undefined, items: lines });
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" onClick={onClose}>
      <div
        className="bg-neutral-950 border border-neutral-800 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-neutral-950 border-b border-neutral-800 p-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Buat Transfer (Draft)</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-100 text-xl">×</button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500">From</label>
              <select
                value={fromBranchId}
                onChange={(e) => setFromBranchId(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500">To</label>
              <select
                value={toBranchId}
                onChange={(e) => setToBranchId(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
              >
                <option value="">— pilih —</option>
                {branches.filter((b) => b.id !== fromBranchId).map((b) => (
                  <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-neutral-500">Notes (opsional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
            />
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Items dari {branches.find((b) => b.id === fromBranchId)?.name ?? 'branch'}</h3>
            {loadingInv ? (
              <div className="text-neutral-500 text-xs">Memuat inventory…</div>
            ) : items.length === 0 ? (
              <div className="text-neutral-500 text-xs">Tidak ada inventory item</div>
            ) : (
              <div className="max-h-64 overflow-y-auto border border-neutral-800 rounded">
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase text-neutral-500 sticky top-0 bg-neutral-900">
                    <tr>
                      <th className="text-left p-1.5">SKU</th>
                      <th className="text-left p-1.5">Item</th>
                      <th className="text-right p-1.5">Stok</th>
                      <th className="text-right p-1.5">Qty Kirim</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.id} className="border-t border-neutral-800">
                        <td className="p-1.5 text-xs text-neutral-500">{it.sku}</td>
                        <td className="p-1.5">{it.name} <span className="text-neutral-500 text-xs">({it.unit})</span></td>
                        <td className="p-1.5 text-right tabular-nums">{Number(it.quantity)}</td>
                        <td className="p-1.5 text-right">
                          <input
                            type="number"
                            min={0}
                            max={Number(it.quantity)}
                            value={picked[it.id] ?? 0}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setPicked((m) => {
                                const n = { ...m };
                                if (v > 0) n[it.id] = v;
                                else delete n[it.id];
                                return n;
                              });
                            }}
                            className="w-20 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 text-right"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {error && <div className="text-red-400 text-xs">Error: {error}</div>}

          <div className="flex justify-end gap-2 pt-2 border-t border-neutral-800">
            <Button size="sm" variant="outline" onClick={onClose}>Batal</Button>
            <Button size="sm" onClick={onSubmit} disabled={submitting || loadingInv}>
              {submitting ? 'Menyimpan…' : 'Buat Draft'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
