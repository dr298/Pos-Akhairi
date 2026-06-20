'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type Channel, type ChannelConfig, type ChannelAnalyticsSummary } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/hooks/useAuth';
import { formatIDR } from '@/lib/format';

const CHANNELS: Channel[] = ['GOFOOD', 'GRABFOOD', 'SHOPEEFOOD'];

export default function ChannelsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [configs, setConfigs] = useState<ChannelConfig[]>([]);
  const [analytics, setAnalytics] = useState<ChannelAnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [days, setDays] = useState(7);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
      router.replace('/pos');
      return;
    }
    void refresh();
  }, [user, router, days]);

  async function refresh() {
    setLoading(true);
    try {
      const [c, a] = await Promise.all([api.listChannels(), api.getChannelAnalyticsSummary(days)]);
      setConfigs(c.data);
      setAnalytics(a.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Delivery Channels</h1>
          <p className="text-sm text-slate-400">Manage GoFood, GrabFood, ShopeeFood integrations</p>
        </div>
        <Button variant="secondary" onClick={() => router.push('/pos')}>
          ← Back
        </Button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {CHANNELS.map((ch) => {
          const cfg = configs.find((c) => c.channel === ch);
          return (
            <ChannelCard
              key={ch}
              channel={ch}
              config={cfg}
              onConfigure={() => setEditing(ch)}
              onTest={async () => {
                try {
                  const r = await api.testChannel(ch);
                  alert(r.data.ok ? `${ch}: connection OK` : `${ch}: ${r.data.message}`);
                } catch (e) {
                  alert(`Test failed: ${(e as Error).message}`);
                }
              }}
              onPoll={async () => {
                try {
                  const r = await api.pollChannel(ch);
                  alert(`Polled ${ch}: ${r.data.polled} new orders`);
                  void refresh();
                } catch (e) {
                  alert(`Poll failed: ${(e as Error).message}`);
                }
              }}
            />
          );
        })}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Analytics ({analytics?.windowDays ?? days} days)</CardTitle>
          <div className="flex gap-2">
            {[7, 14, 30].map((d) => (
              <Button
                key={d}
                size="sm"
                variant={d === days ? 'primary' : 'secondary'}
                onClick={() => setDays(d)}
              >
                {d}d
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loading || !analytics ? (
            <div className="text-slate-500">Loading…</div>
          ) : analytics.byChannel.length === 0 ? (
            <div className="text-slate-500">No channel orders in the selected window.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-800">
                  <th className="py-2">Channel</th>
                  <th className="py-2">Orders</th>
                  <th className="py-2">Revenue</th>
                  <th className="py-2">Commissions</th>
                  <th className="py-2">Delivery Fees</th>
                </tr>
              </thead>
              <tbody>
                {analytics.byChannel.map((c) => (
                  <tr key={c.channel} className="border-b border-slate-900">
                    <td className="py-2 font-medium">{c.channel}</td>
                    <td className="py-2">{c.orderCount}</td>
                    <td className="py-2">{formatIDR(c.totalRevenueCents)}</td>
                    <td className="py-2 text-rose-300">{formatIDR(c.totalCommissionCents)}</td>
                    <td className="py-2 text-emerald-300">{formatIDR(c.totalDeliveryFeeCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {editing && (
        <ChannelConfigDialog
          channel={editing}
          existing={configs.find((c) => c.channel === editing)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function ChannelCard({
  channel,
  config,
  onConfigure,
  onTest,
  onPoll,
}: {
  channel: Channel;
  config?: ChannelConfig;
  onConfigure: () => void;
  onTest: () => void;
  onPoll: () => void;
}) {
  const enabled = config?.enabled ?? false;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{channelLabel(channel)}</CardTitle>
          <span
            className={`text-xs px-2 py-0.5 rounded ${
              enabled ? 'bg-emerald-900 text-emerald-300' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {config ? (
          <dl className="text-xs text-slate-400 space-y-1">
            <div>
              <dt className="inline">Store ID: </dt>
              <dd className="inline font-mono">{config.storeId ?? '—'}</dd>
            </div>
            <div>
              <dt className="inline">API Key: </dt>
              <dd className="inline">{config.hasApiKey ? '*** set' : 'missing'}</dd>
            </div>
            <div>
              <dt className="inline">API Secret: </dt>
              <dd className="inline">{config.hasApiSecret ? '*** set' : 'missing'}</dd>
            </div>
            <div>
              <dt className="inline">Last polled: </dt>
              <dd className="inline">
                {config.lastPolledAt ? new Date(config.lastPolledAt).toLocaleString() : 'never'}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-xs text-slate-500">Not configured yet</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onConfigure}>
            {config ? 'Edit' : 'Configure'}
          </Button>
          {config && (
            <>
              <Button size="sm" variant="secondary" onClick={onTest}>
                Test
              </Button>
              <Button size="sm" variant="secondary" onClick={onPoll}>
                Poll now
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ChannelConfigDialog({
  channel,
  existing,
  onClose,
  onSaved,
}: {
  channel: Channel;
  existing?: ChannelConfig;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [storeId, setStoreId] = useState(existing?.storeId ?? '');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [pollIntervalSec, setPollIntervalSec] = useState(existing?.pollIntervalSec ?? 60);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!storeId) {
      setError('Store ID required');
      return;
    }
    if (!apiKey && !existing?.hasApiKey) {
      setError('API key required');
      return;
    }
    if (!apiSecret && !existing?.hasApiSecret) {
      setError('API secret required');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await api.upsertChannel(channel, {
        enabled,
        storeId,
        apiKey: apiKey || 'placeholder',
        apiSecret: apiSecret || 'placeholder',
        webhookSecret: webhookSecret || undefined,
        pollIntervalSec,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Configure {channelLabel(channel)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Enable this channel</span>
          </label>
          <div>
            <label className="text-xs text-slate-400">Store ID</label>
            <Input value={storeId} onChange={(e) => setStoreId(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-slate-400">
              API Key {existing?.hasApiKey && <span className="text-slate-600">(unchanged = leave blank)</span>}
            </label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={existing?.hasApiKey ? '•••••••' : ''}
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">
              API Secret {existing?.hasApiSecret && <span className="text-slate-600">(unchanged = leave blank)</span>}
            </label>
            <Input
              type="password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder={existing?.hasApiSecret ? '•••••••' : ''}
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Webhook Secret (optional)</label>
            <Input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Poll interval (sec)</label>
            <Input
              type="number"
              value={pollIntervalSec}
              onChange={(e) => setPollIntervalSec(Number(e.target.value))}
            />
          </div>
          {error && <div className="text-rose-400 text-sm">{error}</div>}
          <div className="flex gap-2 pt-2">
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {existing && (
              <Button
                variant="danger"
                onClick={async () => {
                  if (!confirm(`Delete ${channel} config?`)) return;
                  await api.deleteChannel(channel);
                  onSaved();
                }}
                className="ml-auto"
              >
                Delete
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function channelLabel(c: Channel): string {
  switch (c) {
    case 'GOFOOD':
      return 'GoFood';
    case 'GRABFOOD':
      return 'GrabFood';
    case 'SHOPEEFOOD':
      return 'ShopeeFood';
  }
}
