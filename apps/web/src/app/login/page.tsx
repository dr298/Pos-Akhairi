'use client';

// apps/web/src/app/login/page.tsx
//
// Sprint 25 — login page now also bounces already-authed users to /pos.
// Before: visiting /login while still authed (e.g. tab restore, browser
// back from /pos) would show the form. Filling it and clicking Masuk
// would log the user in AGAIN (POST /api/auth/login always returns a new
// session), wasting a session rotation. Now we short-circuit.
//
// Two trigger paths:
//   1. user is non-null  → AuthProvider already resolved, redirect.
//   2. isAuthed() (localStorage flag) → AuthProvider not yet resolved
//      but we have a local hint, push to /pos optimistically. The
//      POSLayout's own auth gate will bounce us back if the cookie is
//      actually stale.
//
// After successful login we use window.location.href (hard nav) instead
// of router.push. The /pos tree's providers (Cart, Printer, WS, etc.)
// re-mount cleanly with no leftover state. This is the same pattern
// used in the logout flow (see useAuth.logout comment).

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { isAuthed } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, login } = useAuth();
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Sprint 26 — AGGRESSIVE: Clear browser auto-fill on mount and focus
  useEffect(() => {
    // First: immediately clear on mount (before auto-fill happens)
    const emailInput = document.getElementById('email') as HTMLInputElement
    const pwInput = document.getElementById('pw') as HTMLInputElement
    
    if (emailInput) {
      emailInput.value = ''
      emailInput.setAttribute('readonly', 'readonly')
      setTimeout(() => emailInput.removeAttribute('readonly'), 100)
    }
    if (pwInput) {
      pwInput.value = ''
      pwInput.setAttribute('readonly', 'readonly')
      setTimeout(() => pwInput.removeAttribute('readonly'), 100)
    }

    // Second: clear on focus (in case browser auto-fill overrides)
    const clearOnFocus = (input: HTMLInputElement | null) => {
      if (input) {
        input.addEventListener('focus', () => {
          if (input.value && input.value !== '') {
            input.value = ''
            input.dispatchEvent(new Event('input', { bubbles: true }))
          }
        })
      }
    }
    clearOnFocus(emailInput)
    clearOnFocus(pwInput)
  }, [])

  // Sprint 25 — if already authed, kick over to /pos immediately.
  useEffect(() => {
    if (loading) return;
    if (user || isAuthed()) {
      const next = searchParams.get('next');
      router.replace(next || '/pos');
    }
  }, [user, loading, router, searchParams]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setErr(null);
    setSubmitting(true);
    try {
      await login(email, password);
      // Sprint 25 — hard nav so the /pos tree re-mounts with a clean
      // provider state (no race with /api/auth/me call kicked off by
      // POSLayout). Same pattern as logout.
      const next = searchParams.get('next');
      if (typeof window !== 'undefined') {
        window.location.href = next || '/pos';
      } else {
        router.push(next || '/pos');
      }
    } catch (e: any) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e?.message || 'Login gagal';
      setErr(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 sm:p-8 bg-neutral-50 dark:bg-neutral-950">
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
              <label className="text-sm text-neutral-800 dark:text-neutral-200" htmlFor="email">
                Email
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-neutral-800 dark:text-neutral-200" htmlFor="pw">
                Password
              </label>
              <Input
                id="pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="off"
              />
            </div>
            {err && (
              <p className="text-sm text-red-400 bg-red-950/30 border border-red-900/50 rounded-md px-2 py-1.5">
                {err}
              </p>
            )}
            <Button type="submit" disabled={submitting} className="w-full" size="lg">
              {submitting ? 'Masuk…' : 'Masuk'}
            </Button>
            <div className="text-xs text-neutral-500 space-y-0.5 pt-2 border-t border-neutral-200 dark:border-neutral-800">
              <p>Akun seed:</p>
              <p>owner@bkj.id · manager@bkj.id · cashier@bkj.id</p>
              <p>Password: <code className="text-neutral-500 dark:text-neutral-400">password123</code></p>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
