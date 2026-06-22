'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useT } from '@/lib/i18n';

type ExportFormat = 'JURNAL' | 'ACCURATE' | 'MEKARI' | 'GENERIC';
type JournalType = 'sales' | 'purchase';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function monthStartIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function formatId(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}

export default function AccountingExportPage() {
  const router = useRouter();
  const { user } = useAuth();
  const t = useT();

  // Last 30 days by default
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(todayIso);
  const [format, setFormat] = useState<ExportFormat>('JURNAL');
  const [journalType, setJournalType] = useState<JournalType>('sales');
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!user) return null;
  // Only OWNER/MANAGER — matches the API guard.
  if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
    if (typeof window !== 'undefined') router.replace('/pos');
    return null;
  }

  const onDownload = useCallback(async () => {
    setError(null);
    setSuccess(null);
    if (!from || !to) {
      setError(t('accountingExport.messages.selectRange'));
      return;
    }
    if (new Date(from) > new Date(to)) {
      setError('From > To');
      return;
    }
    setDownloading(true);
    try {
      const path = `/api/accounting-export/${journalType}-journal.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=${format}`;
      const res = await fetch(path, {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      // Try to extract filename from the Content-Disposition header
      const cd = res.headers.get('content-disposition') || '';
      const m = /filename="?([^"]+)"?/.exec(cd);
      const filename = m?.[1] ?? `${journalType}-journal_${from}_${to}_${format}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccess(t('accountingExport.messages.downloadSuccess'));
    } catch (e) {
      setError((e as Error).message || t('accountingExport.messages.downloadError'));
    } finally {
      setDownloading(false);
    }
  }, [from, to, format, journalType, t]);

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-3 max-w-screen-2xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">
            {t('accountingExport.title')}
          </h1>
          <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
            {t('accountingExport.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setFrom(monthStartIso());
              setTo(todayIso());
            }}
          >
            {t('common.thisMonth')}
          </Button>
        </div>
      </header>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded p-3 text-red-200 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-900/30 border border-emerald-700 rounded p-3 text-emerald-200 text-sm">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader>
            <CardTitle>{t('accountingExport.section.dateRange')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">
                  {t('common.from')}
                </label>
                <Input
                  type="date"
                  value={from}
                  max={to}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">
                  {t('common.to')}
                </label>
                <Input
                  type="date"
                  value={to}
                  min={from}
                  max={todayIso()}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('accountingExport.section.journalType')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="journalType"
                value="sales"
                checked={journalType === 'sales'}
                onChange={() => setJournalType('sales')}
                className="accent-red-600"
              />
              {t('accountingExport.journalType.sales')}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="journalType"
                value="purchase"
                checked={journalType === 'purchase'}
                onChange={() => setJournalType('purchase')}
                className="accent-red-600"
              />
              {t('accountingExport.journalType.purchase')}
            </label>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('accountingExport.section.format')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {(['JURNAL', 'ACCURATE', 'MEKARI', 'GENERIC'] as ExportFormat[]).map((f) => {
              const selected = format === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  className={
                    'p-3 rounded-md border text-left transition-colors ' +
                    (selected
                      ? 'bg-red-900/30 border-red-600 text-red-100'
                      : 'bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:bg-neutral-800')
                  }
                >
                  <div className="font-semibold text-sm">
                    {t(`accountingExport.format.${f}`)}
                  </div>
                  <div className="text-[10px] text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">
                    {t(`accountingExport.info.${f.toLowerCase()}`)}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('accountingExport.info.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">{t(`accountingExport.info.${format.toLowerCase()}`)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={onDownload} disabled={downloading || !from || !to}>
              {downloading
                ? t('accountingExport.actions.downloading')
                : t('accountingExport.actions.download')}
            </Button>
            <span className="text-xs text-neutral-500">
              {journalType === 'sales' ? '📈' : '🛒'} {format} • {from} → {to}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
