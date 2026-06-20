'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

const NAV: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: '/pos', label: 'Order', match: (p) => p === '/pos' },
  { href: '/pos/history', label: 'Riwayat', match: (p) => p.startsWith('/pos/history') },
  { href: '/pos/shift', label: 'Shift', match: (p) => p.startsWith('/pos/shift') },
];

function formatTime(d: Date): string {
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short' });
}

export function POSLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-300 text-sm">
        Memuat…
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-30 border-b border-neutral-800 bg-neutral-950/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link href="/pos" className="font-semibold text-red-500 whitespace-nowrap">
              🍜 BKJ POS
            </Link>
            <span className="text-neutral-500 hidden sm:inline">·</span>
            <div className="hidden sm:flex flex-col min-w-0">
              <span className="text-sm text-neutral-200 truncate">{user.branch?.name ?? 'Branch'}</span>
              <span className="text-[10px] text-neutral-500 truncate">{user.branch?.code}</span>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  'h-9 px-3 inline-flex items-center text-sm rounded-md transition-colors',
                  n.match(pathname)
                    ? 'bg-red-600 text-white'
                    : 'text-neutral-300 hover:bg-neutral-800',
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-sm tabular-nums text-neutral-200">
                {now ? formatTime(now) : '--:--:--'}
              </span>
              <span className="text-[10px] text-neutral-500">{now ? formatDate(now) : ''}</span>
            </div>
            <div className="flex flex-col items-end min-w-0 max-w-[140px]">
              <span className="text-sm text-neutral-100 truncate">{user.name}</span>
              <Badge tone="muted" className="text-[10px]">{user.role}</Badge>
            </div>
            <Button size="sm" variant="outline" onClick={logout}>
              Keluar
            </Button>
          </div>
        </div>
        <div className="md:hidden flex items-center gap-1 px-2 pb-2 overflow-x-auto">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                'h-8 px-3 inline-flex items-center text-xs rounded-md transition-colors whitespace-nowrap',
                n.match(pathname)
                  ? 'bg-red-600 text-white'
                  : 'text-neutral-300 bg-neutral-900 border border-neutral-800',
              )}
            >
              {n.label}
            </Link>
          ))}
        </div>
      </header>
      <main className="flex-1 min-h-0 flex flex-col">{children}</main>
    </div>
  );
}
