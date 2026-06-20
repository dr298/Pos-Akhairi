'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [email, setEmail] = useState('cashier@bkj.id');
  const [password, setPassword] = useState('password123');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await login(email, password);
      const next = searchParams.get('next');
      router.push(next || '/pos');
    } catch (e: any) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e?.message || 'Login gagal';
      setErr(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 sm:p-8 bg-neutral-950">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <span className="text-red-500">🍜 BKJ POS</span>
          </CardTitle>
          <CardDescription>Masuk untuk mulai shift</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm text-neutral-200" htmlFor="email">
                Email
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-neutral-200" htmlFor="pw">
                Password
              </label>
              <Input
                id="pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            {err && (
              <p className="text-sm text-red-400 bg-red-950/30 border border-red-900/50 rounded-md px-2 py-1.5">
                {err}
              </p>
            )}
            <Button type="submit" disabled={loading} className="w-full" size="lg">
              {loading ? 'Masuk…' : 'Masuk'}
            </Button>
            <div className="text-xs text-neutral-500 space-y-0.5 pt-2 border-t border-neutral-800">
              <p>Akun seed:</p>
              <p>owner@bkj.id · manager@bkj.id · cashier@bkj.id</p>
              <p>Password: <code className="text-neutral-400">password123</code></p>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
