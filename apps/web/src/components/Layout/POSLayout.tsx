'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LanguageSwitcher } from '@/components/Layout/LanguageSwitcher';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';
import { Icon, type IconName } from '@/components/ui/Icon';

// Role-based access helpers
const isOwner = (r?: string) => r === 'OWNER';
const isManager = (r?: string) => r === 'OWNER' || r === 'MANAGER';

// Nav groups: each group has a label + items. Items have a role gate.
type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  match: (p: string) => boolean;
  show: (role?: string) => boolean;
  shortcut?: string;
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

const NAV: NavGroup[] = [
  {
    id: 'operasional',
    label: 'Operasional',
    items: [
      { href: '/pos',              label: 'Order',        icon: 'cart',     match: p => p === '/pos',                          show: () => true,        shortcut: 'O' },
      { href: '/pos/history',      label: 'Riwayat',      icon: 'history',  match: p => p.startsWith('/pos/history'),          show: () => true,        shortcut: 'H' },
      { href: '/pos/reservations', label: 'Reservasi',    icon: 'calendar', match: p => p.startsWith('/pos/reservations'),     show: () => true,        shortcut: 'R' },
      { href: '/pos/shift',        label: 'Shift',        icon: 'clock',    match: p => p.startsWith('/pos/shift'),            show: () => true,        shortcut: 'S' },
      { href: '/pos/shifts/history', label: 'Histori Shift', icon: 'history', match: p => p.startsWith('/pos/shifts/history'),  show: () => true },
      { href: '/pos/waiter',       label: 'Waiter',       icon: 'bell',     match: p => p.startsWith('/pos/waiter'),           show: () => true },
      { href: '/pos/waste',        label: 'Waste',        icon: 'trash',    match: p => p.startsWith('/pos/waste'),            show: r => isManager(r) },
    ],
  },
  {
    id: 'menu',
    label: 'Menu',
    items: [
      { href: '/pos/menu',                  label: 'Daftar Menu', icon: 'menu',     match: p => p === '/pos/menu',                                     show: r => isManager(r), shortcut: 'M' },
      { href: '/pos/menu/engineering',      label: 'Engineering',  icon: 'cog',      match: p => p.startsWith('/pos/menu/engineering'),                 show: r => isManager(r) },
      { href: '/pos/menu/combos',           label: 'Combo',        icon: 'layers',   match: p => p.startsWith('/pos/menu/combos'),                      show: r => isManager(r) },
      { href: '/pos/prep-sheets',           label: 'Prep Sheet',   icon: 'clipboard',match: p => p.startsWith('/pos/prep-sheets'),                      show: r => isManager(r) },
      { href: '/pos/promos',                label: 'Promo',        icon: 'tag',      match: p => p.startsWith('/pos/promos'),                           show: r => isManager(r) },
      { href: '/pos/discounts',             label: 'Diskon',       icon: 'percent',  match: p => p.startsWith('/pos/discounts'),                        show: r => isManager(r) },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      { href: '/pos/customers',         label: 'Pelanggan', icon: 'users',  match: p => p.startsWith('/pos/customers') && !p.includes('/customers/['), show: () => true, shortcut: 'P' },
      { href: '/pos/suppliers',         label: 'Supplier',  icon: 'truck',  match: p => p.startsWith('/pos/suppliers'),                                  show: r => isManager(r) },
    ],
  },
  {
    id: 'finance',
    label: 'Keuangan',
    items: [
      { href: '/pos/z-report',              label: 'Z-Report',          icon: 'doc',     match: p => p.startsWith('/pos/z-report'),         show: r => isManager(r), shortcut: 'Z' },
      { href: '/pos/transfers',             label: 'Transfer Kas',      icon: 'arrow',   match: p => p.startsWith('/pos/transfers'),        show: r => isManager(r) },
      { href: '/pos/accounting-export',     label: 'Export Akunting',   icon: 'download',match: p => p.startsWith('/pos/accounting-export'), show: r => isManager(r) },
      { href: '/pos/purchase-orders',       label: 'Purchase Order',    icon: 'cart',    match: p => p.startsWith('/pos/purchase-orders') && !p.endsWith('/new'), show: r => isManager(r) },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    items: [
      { href: '/pos/kiosk',                label: 'Kiosk',         icon: 'kiosk',   match: () => false, show: () => true,        shortcut: 'K' },
      { href: '/pos/orders/[id]',          label: 'Order Detail',  icon: 'receipt', match: p => /^\/pos\/orders\/[^/]+$/.test(p) || /^\/pos\/success\//.test(p), show: () => true },
      { href: '/pos/orders/[id]/receipt',  label: 'Receipt',       icon: 'printer', match: p => p.includes('/receipt'), show: () => true },
      { href: '/display',                  label: 'Customer Display', icon: 'tv',   match: p => p.startsWith('/display'), show: () => true,        shortcut: 'D' },
      { href: '/pos/settings/hardware',    label: 'Hardware',      icon: 'cog',     match: p => p.startsWith('/pos/settings/hardware'), show: r => isManager(r) },
    ],
  },
];

// Flat helper for quick-search
const ALL_ITEMS: Array<NavItem & { group: string }> = NAV.flatMap(g =>
  g.items.map(i => ({ ...i, group: g.label })),
);

function formatTime(d: Date): string {
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short' });
}

export function POSLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [now, setNow] = useState<Date | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const userMenuRef = useRef<HTMLDivElement>(null);

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

  // Click-outside handlers
  useEffect(() => {
    if (!userMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [userMenuOpen]);

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Lock body scroll when drawer open
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't trigger on inputs
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'k') { e.preventDefault(); setSearchOpen(true); return; }
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setDrawerOpen(false);
        setUserMenuOpen(false);
      }
      if (searchOpen) return; // search input handles its own
      // Find shortcut match
      const item = ALL_ITEMS.find(i => i.shortcut?.toLowerCase() === e.key.toLowerCase() && i.show(user?.role));
      if (item) {
        e.preventDefault();
        router.push(item.href.replace(/\[id\]/g, ''));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user, router, searchOpen]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 text-neutral-700 dark:text-neutral-300 text-sm">
        Memuat…
      </div>
    );
  }

  // Filter items visible for this role
  const visibleGroups = NAV
    .map(g => ({ ...g, items: g.items.filter(i => i.show(user.role)) }))
    .filter(g => g.items.length > 0);

  // Search filter
  const searchResults = searchQuery
    ? ALL_ITEMS
        .filter(i => i.show(user.role))
        .filter(i => i.label.toLowerCase().includes(searchQuery.toLowerCase()))
        .slice(0, 10)
    : [];

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 print:bg-white">
      <header
        className="sticky top-0 z-30 border-b border-neutral-200 dark:border-white/5 bg-neutral-50 dark:bg-neutral-950/80 backdrop-blur-md print:hidden"
        style={{ fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}
      >
        <div className="flex items-center justify-between gap-2 sm:gap-3 px-3 sm:px-5 h-14">
          {/* Left: logo */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="md:hidden h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-neutral-100 dark:bg-white/5 active:bg-neutral-200 dark:bg-white/10 transition-colors"
              aria-label="Open menu"
            >
              <Icon name="menu" className="h-5 w-5" />
            </button>
            <Link href="/pos" className="flex items-center gap-2 font-semibold whitespace-nowrap">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-red-600 text-neutral-900 dark:text-white text-sm font-bold">BKJ</span>
              <span className="hidden sm:inline text-neutral-900 dark:text-neutral-100">POS</span>
            </Link>
          </div>

          {/* Center: search (desktop only) */}
          <div className="hidden md:flex flex-1 max-w-md">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="w-full h-9 px-3 flex items-center gap-2 rounded-md bg-neutral-100 dark:bg-white/5 hover:bg-white/[0.07] border border-neutral-200 dark:border-white/5 text-sm text-neutral-500 transition-colors"
            >
              <Icon name="search" className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">Cari menu, order, customer…</span>
              <kbd className="hidden lg:inline text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-white/5 border border-neutral-300 dark:border-white/10 text-neutral-500 font-mono">⌘K</kbd>
            </button>
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={toggle}
              className="h-9 w-9 inline-flex items-center justify-center rounded-md text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:bg-white/5 dark:text-neutral-300 dark:hover:bg-neutral-100 dark:bg-white/5 text-neutral-600 hover:bg-neutral-100 transition-colors"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? (
                <Icon name="sun" className="h-4 w-4" />
              ) : (
                <Icon name="moon" className="h-4 w-4" />
              )}
            </button>
            <LanguageSwitcher />
            <div className="hidden lg:flex flex-col items-end leading-tight">
              <span className="text-xs tabular-nums text-neutral-800 dark:text-neutral-200 font-medium">
                {now ? formatTime(now) : '--:--:--'}
              </span>
              <span className="text-[10px] text-neutral-500">{now ? formatDate(now) : ''}</span>
            </div>
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setUserMenuOpen(v => !v)}
                className="flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-md hover:bg-neutral-100 dark:bg-white/5 transition-colors"
              >
                <span className="h-7 w-7 inline-flex items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-red-700 text-neutral-900 dark:text-white text-xs font-semibold">
                  {user.name?.charAt(0) ?? '?'}
                </span>
                <span className="hidden sm:flex flex-col items-start leading-tight min-w-0">
                  <span className="text-xs text-neutral-900 dark:text-neutral-100 truncate max-w-[120px]">{user.name}</span>
                  <span className="text-[10px] text-neutral-500">{user.role}</span>
                </span>
                <Icon name="chevron-down" className="hidden sm:inline h-3 w-3 text-neutral-500" />
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-40 min-w-[220px] bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-white/10 rounded-lg shadow-2xl py-1">
                  <div className="px-3 py-2 border-b border-neutral-200 dark:border-white/5">
                    <div className="text-xs text-neutral-900 dark:text-neutral-100 truncate">{user.name}</div>
                    <div className="text-[10px] text-neutral-500 truncate">{user.email}</div>
                    <Badge tone="muted" className="mt-1 text-[10px]">{user.role}</Badge>
                  </div>
                  <Link
                    href="/pos/shift"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-100 dark:bg-white/5 flex items-center gap-2 text-neutral-800 dark:text-neutral-200 transition-colors"
                  >
                    <Icon name="clock" className="h-3.5 w-3.5" />
                    <span>Shift</span>
                  </Link>
                  <Link
                    href="/pos/settings/hardware"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-100 dark:bg-white/5 flex items-center gap-2 text-neutral-800 dark:text-neutral-200 transition-colors"
                  >
                    <Icon name="cog" className="h-3.5 w-3.5" />
                    <span>Settings</span>
                  </Link>
                  <div className="border-t border-neutral-200 dark:border-white/5 my-1" />
                  <button
                    type="button"
                    onClick={logout}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-100 dark:bg-white/5 flex items-center gap-2 text-red-400 transition-colors"
                  >
                    <Icon name="logout" className="h-3.5 w-3.5" />
                    <span>Keluar</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sub-nav: current section + breadcrumbs (desktop) */}
        <div className="hidden md:flex items-center gap-1 px-3 sm:px-5 h-10 border-t border-neutral-200 dark:border-white/5 overflow-x-auto">
          {visibleGroups.flatMap(g => g.items).slice(0, 14).map(item => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href.replace(/\[id\]/g, '')}
                className={cn(
                  'h-8 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap',
                  active
                    ? 'bg-neutral-200 dark:bg-white/10 text-neutral-900 dark:text-white'
                    : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:bg-white/5 hover:text-neutral-800 dark:text-neutral-200',
                )}
              >
                <Icon name={item.icon} className="h-3.5 w-3.5" />
                <span>{item.label}</span>
                {item.shortcut && (
                  <kbd className="hidden xl:inline text-[9px] px-1 rounded bg-neutral-100 dark:bg-white/5 text-neutral-500 font-mono ml-0.5">
                    {item.shortcut}
                  </kbd>
                )}
              </Link>
            );
          })}
        </div>
      </header>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-white dark:bg-black/70 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
          />
          <aside className="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-neutral-50 dark:bg-neutral-950 border-r border-neutral-300 dark:border-white/10 flex flex-col">
            <div className="flex items-center justify-between px-4 h-14 border-b border-neutral-200 dark:border-white/5 shrink-0">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-red-600 text-neutral-900 dark:text-white text-sm font-bold">BKJ</span>
                <span className="font-semibold">Bakmie Kota Juang</span>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-neutral-100 dark:bg-white/5"
                aria-label="Close"
              >
                <Icon name="x" className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-2">
              {visibleGroups.map(group => (
                <div key={group.id} className="mb-3">
                  <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
                    {group.label}
                  </div>
                  {group.items.map(item => {
                    const active = item.match(pathname);
                    return (
                      <Link
                        key={item.href}
                        href={item.href.replace(/\[id\]/g, '')}
                        className={cn(
                          'flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                          active
                            ? 'bg-neutral-200 dark:bg-white/10 text-neutral-900 dark:text-white border-l-2 border-red-500'
                            : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:bg-white/5 border-l-2 border-transparent',
                        )}
                      >
                        <Icon name={item.icon} className="h-4 w-4 shrink-0" />
                        <span className="flex-1">{item.label}</span>
                        {item.shortcut && (
                          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-white/5 border border-neutral-300 dark:border-white/10 text-neutral-500 font-mono">
                            {item.shortcut}
                          </kbd>
                        )}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
            <div className="border-t border-neutral-200 dark:border-white/5 px-4 py-3 shrink-0">
              <div className="flex items-center gap-2">
                <span className="h-8 w-8 inline-flex items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-red-700 text-neutral-900 dark:text-white text-xs font-semibold">
                  {user.name?.charAt(0) ?? '?'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-neutral-900 dark:text-neutral-100 truncate">{user.name}</div>
                  <div className="text-[10px] text-neutral-500">{user.role}</div>
                </div>
                <Button size="sm" variant="outline" onClick={logout}>Keluar</Button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Command palette / search */}
      {searchOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-white dark:bg-black/70 backdrop-blur-sm"
            onClick={() => setSearchOpen(false)}
          />
          <div className="absolute left-1/2 top-[20%] -translate-x-1/2 w-full max-w-lg px-4">
            <div className="bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 h-12 border-b border-neutral-200 dark:border-white/5">
                <Icon name="search" className="h-4 w-4 text-neutral-500" />
                <input
                  autoFocus
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && searchResults[0]) {
                      router.push(searchResults[0].href.replace(/\[id\]/g, ''));
                      setSearchOpen(false);
                      setSearchQuery('');
                    }
                  }}
                  placeholder="Cari menu, order, customer…"
                  className="flex-1 bg-transparent text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 outline-none"
                />
                <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-white/5 border border-neutral-300 dark:border-white/10 text-neutral-500 font-mono">ESC</kbd>
              </div>
              <div className="max-h-80 overflow-y-auto py-1">
                {searchQuery && searchResults.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-neutral-500">
                    Tidak ada hasil untuk "{searchQuery}"
                  </div>
                )}
                {!searchQuery && (
                  <div className="px-4 py-6 text-center text-sm text-neutral-500">
                    Ketik untuk mencari di {ALL_ITEMS.filter(i => i.show(user.role)).length} menu
                  </div>
                )}
                {searchResults.map(item => (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => {
                      router.push(item.href.replace(/\[id\]/g, ''));
                      setSearchOpen(false);
                      setSearchQuery('');
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-neutral-100 dark:bg-white/5 text-left transition-colors"
                  >
                    <Icon name={item.icon} className="h-4 w-4 text-neutral-500" />
                    <span className="flex-1 text-neutral-900 dark:text-neutral-100">{item.label}</span>
                    <span className="text-[10px] text-neutral-500">{item.group}</span>
                    {item.shortcut && (
                      <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-white/5 border border-neutral-300 dark:border-white/10 text-neutral-500 font-mono">
                        {item.shortcut}
                      </kbd>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 min-h-0 flex flex-col">{children}</main>
    </div>
  );
}
