'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type ChainReport } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/hooks/useAuth';
import { formatIDR } from '@/lib/format';

export default function ChainReportPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [report, setReport] = useState<ChainReport | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'OWNER') {
      router.replace('/pos');
      return;
    }
    void load();
  }, [user, router, date]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.getChainReport(date);
      setReport(r.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!user) return null;
  if (user.role !== 'OWNER') return null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Chain Report</h1>
          <p className="text-sm text-slate-400">
            Cross-branch performance for {date}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm"
          />
          <button
            onClick={() => load()}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-sm"
          >
            Refresh
          </button>
        </div>
      </header>

      {loading && <div className="text-slate-400">Loading...</div>}
      {error && (
        <div className="bg-rose-900/30 border border-rose-700 rounded p-3 text-rose-200 text-sm">
          {error}
        </div>
      )}
      {report && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-slate-400">Branches</div>
                <div className="text-2xl font-semibold mt-1">
                  {report.totals.branches}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-slate-400">Orders</div>
                <div className="text-2xl font-semibold mt-1">
                  {report.totals.orders}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-slate-400">Gross</div>
                <div className="text-2xl font-semibold mt-1">
                  {formatIDR(report.totals.grossCents)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-slate-400">Mismatches</div>
                <div className="text-2xl font-semibold mt-1 flex items-center gap-2">
                  {report.totals.mismatches}
                  {report.totals.mismatches > 0 && (
                    <Badge tone="warning">action needed</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Per-branch breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-slate-800">
                      <th className="py-2 pr-3">Branch</th>
                      <th className="py-2 pr-3">Orders</th>
                      <th className="py-2 pr-3">Paid</th>
                      <th className="py-2 pr-3">Voided</th>
                      <th className="py-2 pr-3">Refunded</th>
                      <th className="py-2 pr-3 text-right">Gross</th>
                      <th className="py-2 pr-3">EOD</th>
                      <th className="py-2 pr-3">Mismatches</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.branches.map((b) => (
                      <tr
                        key={b.branch.id}
                        className="border-b border-slate-800/50 hover:bg-slate-900/50"
                      >
                        <td className="py-2 pr-3">
                          <div className="font-medium">{b.branch.code}</div>
                          <div className="text-xs text-slate-400">
                            {b.branch.name}
                          </div>
                        </td>
                        <td className="py-2 pr-3">{b.orders.total}</td>
                        <td className="py-2 pr-3 text-emerald-400">
                          {b.orders.paid}
                        </td>
                        <td className="py-2 pr-3 text-amber-400">
                          {b.orders.voided}
                        </td>
                        <td className="py-2 pr-3 text-rose-400">
                          {b.orders.refunded}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono">
                          {formatIDR(b.orders.grossCents)}
                        </td>
                        <td className="py-2 pr-3">
                          {b.dailyClose ? (
                            <Badge
                              tone={
                                b.dailyClose.status === 'CLOSED'
                                  ? 'success'
                                  : 'info'
                              }
                            >
                              {b.dailyClose.status}
                            </Badge>
                          ) : (
                            <Badge tone="muted">not closed</Badge>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          {b.mismatches > 0 ? (
                            <Badge tone="warning">{b.mismatches}</Badge>
                          ) : (
                            <span className="text-slate-500">0</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
