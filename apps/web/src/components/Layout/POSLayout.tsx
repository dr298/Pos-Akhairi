'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

const NAV: { href: string; label: string; match: (p: string) => boolean; managerOnly?: boolean; ownerOnly?: boolean }[] = [
  { href: '/pos', label: 'Order', match: (p) => p === '/pos' },
  { href: '/pos/history', label: 'Riwayat', match: (p) => p.startsWith('/pos/history') },
  { href: '/pos/delivery', label: 'Delivery', match: (p) => p.startsWith('/pos/delivery') },
  { href: '/pos/shift', label: 'Shift', match: (p) => p.startsWith('/pos/shift') },
  { href: '/pos/transfers', label: 'Transfer', match: (p) => p.startsWith('/pos/transfers'), managerOnly: true },
  { href: '/pos/z-report', label: 'Z-Report', match: (p) => p.startsWith('/pos/z-report'), managerOnly: true },
  { href: '/pos/discounts', label: 'Diskon', match: (p) => p.startsWith('/pos/discounts'), managerOnly: true },
  { href: '/pos/channels', label: 'Channels', match: (p) => p.startsWith('/pos/channels'), managerOnly: true },
  { href: '/pos/chain', label: 'Chain', match: (p) => p.startsWith('/pos/chain'), ownerOnly: true },
  { href: '/display', label: 'Display', match: () => false },
];

function formatTime(d: Date): string {
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short' });
}

export function POSLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, switchBranch } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [now, setNow] = useState<Date | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

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

  // Click-outside to close branch switcher
  useEffect(() => {
    if (!switcherOpen) return;
    const onClick = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [switcherOpen]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-300 text-sm">
        Memuat…
      </div>
    );
  }

  const accessList = user.branchAccess ?? [];
  const canSwitch = accessList.length > 1;

  const onSwitch = async (branchId: string) => {
    if (branchId === user.branchId) {
      setSwitcherOpen(false);
      return;
    }
    setSwitching(true);
    try {
      await switchBranch(branchId);
      setSwitcherOpen(false);
      // Reload to flush any cached data tied to the old branch
      router.refresh();
    } catch (e) {
      console.error('Branch switch failed:', e);
      alert('Gagal pindah branch. Coba lagi.');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-30 border-b border-neutral-800 bg-neutral-950/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link href="/pos" className="font-semibold text-red-500 whitespace-nowrap">
              🍜 BKJ POS
            </Link>
            <span className="text-neutral-500 hidden sm:inline">·</span>
            {canSwitch ? (
              <div className="relative" ref={switcherRef}>
                <button
                  type="button"
                  onClick={() => setSwitcherOpen((v) => !v)}
                  className="hidden sm:flex flex-col items-start min-w-0 px-2 py-0.5 rounded hover:bg-neutral-800 transition-colors"
                >
                  <span className="text-sm text-neutral-200 truncate flex items-center gap-1">
                    {user.branch?.name ?? 'Branch'}
                    <span className="text-[10px] text-neutral-500">▼</span>
                  </span>
                  <span className="text-[10px] text-neutral-500 truncate">
                    {user.branch?.code} · klik untuk pindah
                  </span>
                </button>
                {switcherOpen && (
                  <div className="absolute left-0 top-full mt-1 z-40 min-w-[220px] bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1">
                    {accessList.map((a) => (
                      <button
                        key={a.branchId}
                        type="button"
                        disabled={switching}
                        onClick={() => onSwitch(a.branchId)}
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm hover:bg-neutral-800 disabled:opacity-50 flex items-center justify-between gap-2',
                          a.branchId === user.branchId && 'bg-neutral-800/50',
                        )}
                      >
                        <span className="truncate">
                          <span className="block text-neutral-100">{a.branch.name}</span>
                          <span className="block text-[10px] text-neutral-500">
                            {a.branch.code} · {a.role}
                            {a.isDefault ? ' · default' : ''}
                          </span>
                        </span>
                        {a.branchId === user.branchId && (
                          <span className="text-[10px] text-red-400">aktif</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="hidden sm:flex flex-col min-w-0">
                <span className="text-sm text-neutral-200 truncate">{user.branch?.name ?? 'Branch'}</span>
                <span className="text-[10px] text-neutral-500 truncate">{user.branch?.code}</span>
              </div>
            )}
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {NAV.filter((n) => {
              if (n.ownerOnly && user.role !== 'OWNER') return false;
              if (n.managerOnly && user.role !== 'OWNER' && user.role !== 'MANAGER') return false;
              return true;
            }).map((n) => (
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
          {NAV.filter((n) => {
            if (n.ownerOnly && user.role !== 'OWNER') return false;
            if (n.managerOnly && user.role !== 'OWNER' && user.role !== 'MANAGER') return false;
            return true;
          }).map((n) => (
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
