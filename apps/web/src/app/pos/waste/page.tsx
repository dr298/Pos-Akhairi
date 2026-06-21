'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  api,
  type MenuItem,
  type WasteEntry,
  type WasteSummary,
  type WasteType,
} from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { useAuth } from '@/hooks/useAuth';
import { useT } from '@/lib/i18n';

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function fmtIdr(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  // Money convention in this codebase: *Cents fields are integer cents
  // (sub-IDR), so we divide by 100 to get the rupiah display value.
  return 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(cents / 100));
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function WastePage() {
  const router = useRouter();
  const { user } = useAuth();
  const t = useT();

  const [entries, setEntries] = useState<WasteEntry[]>([]);
  const [summary, setSummary] = useState<WasteSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<WasteType | ''>('');

  // Quick-entry form
  const [type, setType] = useState<WasteType>('FOOD');
  const [itemSearch, setItemSearch] = useState('');
  const [itemOptions, setItemOptions] = useState<MenuItem[]>([]);
  const [itemId, setItemId] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [reason, setReason] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  if (!user) return null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, sum] = await Promise.all([
        api.listWaste({ limit: 100 }),
        api.getWasteSummary({ days: 30 }),
      ]);
      setEntries(list.data.entries);
      setSummary(sum.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'OWNER' && user.role !== 'MANAGER' && user.role !== 'CASHIER') {
      router.replace('/pos');
      return;
    }
    void load();
  }, [user, router, load]);

  // Search menu items for the picker
  useEffect(() => {
    if (itemSearch.trim().length < 1) {
      setItemOptions([]);
      return;
    }
    let cancelled = false;
    const to = setTimeout(async () => {
      try {
        // The /api/menu/items endpoint returns the array directly under
        // `data` (no nested {items: ...} wrapper). We cast for type safety.
        const r = await api.getMenuItems({ search: itemSearch.trim() });
        if (!cancelled) setItemOptions((r.data as unknown as MenuItem[]).slice(0, 20));
      } catch {
        // ignore
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(to);
    };
  }, [itemSearch]);

  const filteredEntries = useMemo(() => {
    if (!filterType) return entries;
    return entries.filter((e) => e.type === filterType);
  }, [entries, filterType]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemId) {
      setError('Pilih item terlebih dahulu');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Jumlah harus > 0');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.createWaste({
        type,
        menuItemId: type === 'FOOD' ? itemId : null,
        // The waste form in this v1 only allows FOOD items (search via
        // menu). INGREDIENT/PACKAGING form fields are kept for future use.
        quantity,
        reason: reason.trim() || null,
        notes: notes.trim() || null,
      });
      setItemId('');
      setItemSearch('');
      setItemOptions([]);
      setQuantity(1);
      setReason('');
      setNotes('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!user || user.role !== 'OWNER') return;
    if (!confirm('Hapus catatan waste ini?')) return;
    try {
      await api.deleteWaste(id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-3 max-w-screen-2xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">{t('waste.title')}</h1>
          <p className="text-xs sm:text-sm text-neutral-400">{t('waste.subtitle')}</p>
        </div>
      </header>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded p-3 text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label={t('waste.summary.monthTotal')}
          value={summary ? fmtIdr(summary.totalCostCents) : '—'}
          accent="red"
        />
        <SummaryCard
          label={t('waste.summary.count')}
          value={summary ? String(summary.totalCount) : '—'}
          accent="amber"
        />
        {summary &&
          (['FOOD', 'INGREDIENT', 'PACKAGING'] as WasteType[]).map((tt) => (
            <SummaryCard
              key={tt}
              label={t(`waste.form.type${tt}`)}
              value={fmtIdr(summary.byType[tt].costCents)}
              sub={`${summary.byType[tt].count} entri`}
              accent="neutral"
            />
          ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Quick entry */}
        <Card>
          <CardHeader>
            <CardTitle>{t('waste.form.submit')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">
                  {t('waste.form.type')}
                </label>
                <div className="grid grid-cols-3 gap-1">
                  {(['FOOD', 'INGREDIENT', 'PACKAGING'] as WasteType[]).map((tt) => (
                    <button
                      key={tt}
                      type="button"
                      onClick={() => setType(tt)}
                      className={
                        'h-9 px-2 text-xs rounded-md border ' +
                        (type === tt
                          ? 'bg-red-600 border-red-600 text-white'
                          : 'bg-neutral-900 border-neutral-700 text-neutral-200 hover:bg-neutral-800')
                      }
                    >
                      {t(`waste.form.type${tt}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-neutral-400 mb-1">
                  {t('waste.form.item')}
                </label>
                <Input
                  type="text"
                  value={itemSearch}
                  onChange={(e) => {
                    setItemSearch(e.target.value);
                    setItemId('');
                  }}
                  placeholder={t('waste.form.searchItem')}
                />
                {itemOptions.length > 0 && (
                  <div className="mt-1 max-h-40 overflow-y-auto rounded border border-neutral-700 bg-neutral-950">
                    {itemOptions.map((it) => (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => {
                          setItemId(it.id);
                          setItemSearch(it.name);
                          setItemOptions([]);
                        }}
                        className="w-full text-left px-2 py-1 text-sm hover:bg-neutral-800"
                      >
                        {it.name}{' '}
                        <span className="text-[10px] text-neutral-500">
                          {it.sku ? `(${it.sku})` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {itemId && (
                  <p className="text-[10px] text-emerald-400 mt-1">
                    ✓ {itemSearch}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs text-neutral-400 mb-1">
                  {t('waste.form.quantity')}
                </label>
                <Input
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={quantity}
                  onChange={(e) => setQuantity(parseFloat(e.target.value) || 0)}
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-neutral-400 mb-1">
                  {t('waste.form.reason')}
                </label>
                <Input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t('waste.form.reasonPlaceholder')}
                  maxLength={200}
                />
              </div>

              <div>
                <label className="block text-xs text-neutral-400 mb-1">
                  {t('waste.form.notes')}
                </label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={500}
                />
              </div>

              <Button type="submit" size="sm" disabled={submitting || !itemId}>
                {submitting ? t('waste.form.submitting') : t('waste.form.submit')}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Top items */}
        <Card>
          <CardHeader>
            <CardTitle>{t('waste.summary.topItems')}</CardTitle>
          </CardHeader>
          <CardContent>
            {summary?.topItems && summary.topItems.length > 0 ? (
              <ol className="space-y-2 text-sm">
                {summary.topItems.map((it, i) => (
                  <li
                    key={it.key}
                    className="flex items-center justify-between gap-2 border-b border-neutral-800 pb-2 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <span className="text-neutral-500 mr-2">{i + 1}.</span>
                      <span className="text-neutral-100">{it.name}</span>
                      <span className="text-[10px] text-neutral-500 ml-2">
                        {t(`waste.form.type${it.type}`)}
                      </span>
                    </div>
                    <div className="text-right text-xs">
                      <div className="font-mono text-neutral-200">
                        {fmtIdr(it.costCents)}
                      </div>
                      <div className="text-[10px] text-neutral-500">
                        {it.count} entri
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-neutral-500">{t('waste.summary.noData')}</p>
            )}
          </CardContent>
        </Card>

        {/* Reason breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>{t('waste.summary.byReason')}</CardTitle>
          </CardHeader>
          <CardContent>
            {summary?.byReason && summary.byReason.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {summary.byReason.map((r) => (
                  <li
                    key={r.reason}
                    className="flex items-center justify-between gap-2 border-b border-neutral-800 pb-2 last:border-b-0"
                  >
                    <span className="text-neutral-200">{r.reason}</span>
                    <div className="text-right text-xs">
                      <div className="font-mono text-neutral-100">
                        {fmtIdr(r.costCents)}
                      </div>
                      <div className="text-[10px] text-neutral-500">
                        {r.count}×
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-neutral-500">{t('waste.summary.noData')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>
            {t('waste.list.title')} ({filteredEntries.length})
          </CardTitle>
          <div className="flex items-center gap-1">
            <FilterChip
              label={t('common.all')}
              active={filterType === ''}
              onClick={() => setFilterType('')}
            />
            {(['FOOD', 'INGREDIENT', 'PACKAGING'] as WasteType[]).map((tt) => (
              <FilterChip
                key={tt}
                label={t(`waste.form.type${tt}`)}
                active={filterType === tt}
                onClick={() => setFilterType(tt)}
              />
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-neutral-400 text-sm">{t('common.loading')}</div>
          ) : filteredEntries.length === 0 ? (
            <p className="text-center text-neutral-500 py-6 text-sm">
              {t('waste.list.empty')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase text-neutral-500">
                  <tr>
                    <th className="text-left p-2">{t('waste.list.headers.date')}</th>
                    <th className="text-left p-2">{t('waste.list.headers.type')}</th>
                    <th className="text-left p-2">{t('waste.list.headers.item')}</th>
                    <th className="text-right p-2">{t('waste.list.headers.qty')}</th>
                    <th className="text-right p-2">{t('waste.list.headers.cost')}</th>
                    <th className="text-left p-2">{t('waste.list.headers.reason')}</th>
                    <th className="text-left p-2">{t('waste.list.headers.recordedBy')}</th>
                    {user.role === 'OWNER' && (
                      <th className="text-left p-2">{t('common.actions')}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((e) => (
                    <tr
                      key={e.id}
                      className="border-t border-neutral-800 hover:bg-neutral-900/40"
                    >
                      <td className="p-2 text-xs">{fmtDateTime(e.recordedAt)}</td>
                      <td className="p-2 text-xs">
                        <TypeBadge type={e.type} />
                      </td>
                      <td className="p-2 text-sm">
                        {e.menuItem?.name ?? e.inventoryItem?.name ?? '—'}
                      </td>
                      <td className="p-2 text-right font-mono text-xs">
                        {e.quantity}
                      </td>
                      <td className="p-2 text-right font-mono text-xs">
                        {fmtIdr(e.totalCostCents)}
                      </td>
                      <td className="p-2 text-xs text-neutral-300">{e.reason ?? '—'}</td>
                      <td className="p-2 text-xs text-neutral-400">
                        {e.recordedBy?.name ?? '—'}
                      </td>
                      {user.role === 'OWNER' && (
                        <td className="p-2">
                          <button
                            type="button"
                            onClick={() => void onDelete(e.id)}
                            className="text-red-400 hover:text-red-300 text-xs"
                          >
                            {t('common.delete')}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: 'red' | 'amber' | 'neutral';
}) {
  const ring = {
    red: 'border-red-700/60',
    amber: 'border-amber-700/60',
    neutral: 'border-neutral-700',
  }[accent];
  return (
    <Card className={ring}>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-neutral-500">
          {label}
        </div>
        <div className="text-lg sm:text-xl font-semibold mt-1 font-mono">
          {value}
        </div>
        {sub && <div className="text-[10px] text-neutral-500 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'h-7 px-2 text-[11px] rounded-md border ' +
        (active
          ? 'bg-red-600 border-red-600 text-white'
          : 'bg-neutral-900 border-neutral-700 text-neutral-300 hover:bg-neutral-800')
      }
    >
      {label}
    </button>
  );
}

function TypeBadge({ type }: { type: WasteType }) {
  const colors: Record<WasteType, string> = {
    FOOD: 'bg-red-900/50 text-red-200 border-red-800',
    INGREDIENT: 'bg-amber-900/50 text-amber-200 border-amber-800',
    PACKAGING: 'bg-sky-900/50 text-sky-200 border-sky-800',
  };
  return (
    <span
      className={`inline-block text-[10px] px-1.5 py-0.5 rounded border ${colors[type]}`}
    >
      {type}
    </span>
  );
}
