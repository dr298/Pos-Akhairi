'use client';

// apps/web/src/app/kiosk/page.tsx
//
// Sprint 9.1 — Self-Order Kiosk landing page.
//
// Public (no auth), fullscreen, touch-friendly. The customer picks a
// branch (the kiosk hardware is assigned to one branch; in dev we let
// the customer pick), browses the menu, adds items to a cart, then
// hits "Bayar di Kasir" to convert the cart into a real Order with
// type=KIOSK. The Order shows on the cashier's POS where they take
// payment.
//
// The page reads `?branchId=X` from the URL. If absent and the user is
// not authed, we render a branch picker. The branch picker is for dev
// convenience — in production, the kiosk is tied to a single branch
// via URL/deep-link.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { api, type Branch } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { formatIDR } from '@/lib/format';

interface KioskMenuItem {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  imageUrl: string | null;
  categoryId: string;
}

interface KioskCategory {
  id: string;
  name: string;
  sortOrder: number;
  items: KioskMenuItem[];
}

interface CartItem {
  id: string;
  menuItemId: string;
  name: string;
  priceCents: number;
  quantity: number;
  notes?: string;
  lineTotalCents: number;
}

const CART_STORAGE_KEY = 'kiosk:cart';

function readStoredCart(): { sessionId: string | null; items: CartItem[] } {
  if (typeof window === 'undefined') return { sessionId: null, items: [] };
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return { sessionId: null, items: [] };
    const parsed = JSON.parse(raw);
    return {
      sessionId: parsed.sessionId ?? null,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return { sessionId: null, items: [] };
  }
}

function writeStoredCart(sessionId: string | null, items: CartItem[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({ sessionId, items }),
    );
  } catch {
    // ignore quota errors
  }
}

function clearStoredCart() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CART_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function genLocalId(): string {
  return 'c_' + Math.random().toString(36).slice(2, 10);
}

export default function KioskPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center text-neutral-400 text-lg">
        Memuat…
      </main>
    }>
      <KioskPageContent />
    </Suspense>
  );
}

function KioskPageContent() {
  const router = useRouter();
  const params = useSearchParams();
  const branchIdFromUrl = params.get('branchId') || '';

  // Branch picker state
  const [branches, setBranches] = useState<Branch[]>([]);
  const [pickingBranch, setPickingBranch] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState<string>(branchIdFromUrl);

  // Menu + cart
  const [branch, setBranch] = useState<Branch | null>(null);
  const [categories, setCategories] = useState<KioskCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [orderResult, setOrderResult] = useState<{
    orderId: string;
    orderNumber: string;
    totalCents: number;
  } | null>(null);

  // Step 1: load the branch list (so the customer can pick a branch in
  // dev environments). In production with branchId in URL, skip this.
  useEffect(() => {
    if (branchIdFromUrl) {
      setSelectedBranchId(branchIdFromUrl);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listBranches();
        if (cancelled) return;
        const list = (res.data?.branches ?? []).filter((b) => b.isActive !== false);
        setBranches(list);
        setPickingBranch(list.length > 1);
      } catch (e) {
        toast.error((e as Error).message || 'Gagal memuat daftar branch');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branchIdFromUrl]);

  // Step 2: load the menu for the selected branch and start a session.
  useEffect(() => {
    if (!selectedBranchId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Load menu
        const menuRes = await fetch(
          `/api/kiosk/menu?branchId=${encodeURIComponent(selectedBranchId)}`,
          { credentials: 'include' },
        );
        if (!menuRes.ok) {
          const err = await menuRes.json().catch(() => ({}));
          throw new Error(err.message || 'Gagal memuat menu');
        }
        const menuJson = await menuRes.json();
        if (cancelled) return;
        setBranch(menuJson.data.branch);
        setCategories(menuJson.data.categories ?? []);
        if ((menuJson.data.categories ?? []).length > 0) {
          setActiveCategory(menuJson.data.categories[0].id);
        }
        // Restore previous cart (same browser → same kiosk hardware)
        const stored = readStoredCart();
        if (stored.sessionId) {
          // Verify the session is still alive
          try {
            const r = await fetch(
              `/api/kiosk/cart/${encodeURIComponent(stored.sessionId)}`,
              { credentials: 'include' },
            );
            if (r.ok) {
              const data = await r.json();
              setSessionId(stored.sessionId);
              setCart(data.data.cart?.items ?? stored.items);
            } else {
              // Session dead — start a new one
              clearStoredCart();
              setCart([]);
              await startSession(selectedBranchId, stored.items);
            }
          } catch {
            clearStoredCart();
            setCart([]);
            await startSession(selectedBranchId, stored.items);
          }
        } else {
          // Start a fresh session
          await startSession(selectedBranchId, stored.items);
        }
      } catch (e) {
        toast.error((e as Error).message || 'Gagal memuat halaman');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId]);

  const startSession = useCallback(async (branchId: string, seedItems: CartItem[]) => {
    try {
      const r = await fetch('/api/kiosk/cart', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          branchId,
          items: seedItems.map((it) => ({
            menuItemId: it.menuItemId,
            quantity: it.quantity,
            notes: it.notes,
          })),
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || 'Gagal memulai sesi kiosk');
      }
      const data = await r.json();
      setSessionId(data.data.sessionId);
      setCart(data.data.cart?.items ?? []);
      writeStoredCart(data.data.sessionId, data.data.cart?.items ?? []);
    } catch (e) {
      toast.error((e as Error).message || 'Gagal memulai sesi kiosk');
    }
  }, []);

  // Persist cart on every change
  useEffect(() => {
    if (sessionId) writeStoredCart(sessionId, cart);
  }, [cart, sessionId]);

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return categories;
    const q = search.trim().toLowerCase();
    return categories
      .map((c) => ({
        ...c,
        items: c.items.filter(
          (i) => i.name.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q),
        ),
      }))
      .filter((c) => c.items.length > 0);
  }, [categories, search]);

  const subtotal = cart.reduce((s, it) => s + it.lineTotalCents, 0);
  const totalItems = cart.reduce((s, it) => s + it.quantity, 0);

  async function addToCart(item: KioskMenuItem) {
    if (!sessionId) {
      toast.error('Sesi kiosk belum siap, coba lagi');
      return;
    }
    // Optimistic local update
    setCart((prev) => {
      const idx = prev.findIndex(
        (it) => it.menuItemId === item.id && (it.notes ?? '').trim() === '',
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          quantity: next[idx].quantity + 1,
          lineTotalCents: next[idx].priceCents * (next[idx].quantity + 1),
        };
        return next;
      }
      return [
        ...prev,
        {
          id: genLocalId(),
          menuItemId: item.id,
          name: item.name,
          priceCents: item.priceCents,
          quantity: 1,
          lineTotalCents: item.priceCents,
        },
      ];
    });
    // Persist to server
    try {
      const r = await fetch(
        `/api/kiosk/cart/${encodeURIComponent(sessionId)}/items`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ menuItemId: item.id, quantity: 1 }),
        },
      );
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || 'Gagal menambah item');
      }
      const data = await r.json();
      // Reconcile with server state
      setCart(data.data.cart?.items ?? []);
    } catch (e) {
      toast.error((e as Error).message || 'Gagal menambah item');
    }
  }

  async function changeQuantity(itemId: string, delta: number) {
    if (!sessionId) return;
    const existing = cart.find((it) => it.id === itemId);
    if (!existing) return;
    const newQty = existing.quantity + delta;
    if (newQty <= 0) {
      await removeItem(itemId);
      return;
    }
    setCart((prev) =>
      prev.map((it) =>
        it.id === itemId
          ? { ...it, quantity: newQty, lineTotalCents: it.priceCents * newQty }
          : it,
      ),
    );
    // Simplest: remove and re-add. (We could PATCH; not exposed in API.)
    try {
      await fetch(
        `/api/kiosk/cart/${encodeURIComponent(sessionId)}/items/${encodeURIComponent(itemId)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      await fetch(
        `/api/kiosk/cart/${encodeURIComponent(sessionId)}/items`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ menuItemId: existing.menuItemId, quantity: newQty }),
        },
      );
    } catch {
      // ignore — UI already updated
    }
  }

  async function removeItem(itemId: string) {
    if (!sessionId) return;
    setCart((prev) => prev.filter((it) => it.id !== itemId));
    try {
      await fetch(
        `/api/kiosk/cart/${encodeURIComponent(sessionId)}/items/${encodeURIComponent(itemId)}`,
        { method: 'DELETE', credentials: 'include' },
      );
    } catch {
      // ignore
    }
  }

  async function handleCheckout() {
    if (!sessionId) return;
    if (cart.length === 0) {
      toast.error('Keranjang kosong');
      return;
    }
    setCheckingOut(true);
    try {
      const r = await fetch(
        `/api/kiosk/cart/${encodeURIComponent(sessionId)}/checkout`,
        { method: 'POST', credentials: 'include' },
      );
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || 'Checkout gagal');
      }
      const data = await r.json();
      setOrderResult({
        orderId: data.data.orderId,
        orderNumber: data.data.orderNumber,
        totalCents: data.data.totalCents,
      });
      clearStoredCart();
      setCart([]);
      setSessionId(null);
    } catch (e) {
      toast.error((e as Error).message || 'Checkout gagal');
    } finally {
      setCheckingOut(false);
    }
  }

  function resetForNewOrder() {
    setOrderResult(null);
    setShowCart(false);
    if (selectedBranchId) startSession(selectedBranchId, []);
  }

  // ─── Branch picker (dev convenience) ─────────────────────────────────────
  if (pickingBranch && !selectedBranchId) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-neutral-950 text-neutral-100">
        <h1 className="text-2xl sm:text-4xl font-bold mb-2">Pilih Lokasi</h1>
        <p className="text-neutral-400 mb-6 text-center">Pilih cabang untuk memesan</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-xl">
          {branches.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setSelectedBranchId(b.id);
                setPickingBranch(false);
                router.replace(`/kiosk?branchId=${encodeURIComponent(b.id)}`);
              }}
              className="min-h-[120px] rounded-2xl bg-neutral-900 border border-neutral-800 hover:border-red-500 hover:bg-neutral-800 active:scale-[0.98] transition-all p-5 text-left"
            >
              <div className="text-lg font-semibold">{b.name}</div>
              <div className="text-sm text-neutral-400 mt-1">{b.code}</div>
              {b.address ? (
                <div className="text-xs text-neutral-500 mt-2 truncate">{b.address}</div>
              ) : null}
            </button>
          ))}
        </div>
      </main>
    );
  }

  // ─── Order complete (show QR + order #) ─────────────────────────────────
  if (orderResult) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-neutral-950 text-neutral-100">
        <div className="max-w-md w-full text-center">
          <div className="text-6xl mb-4">✅</div>
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">Pesanan Diterima</h1>
          <p className="text-neutral-400 mb-6">Tunjukkan nomor ini ke kasir untuk pembayaran</p>
          <Card>
            <CardContent className="p-6">
              <div className="text-sm text-neutral-500">Nomor Pesanan</div>
              <div className="text-4xl font-bold tracking-widest mt-1 text-red-500">
                {orderResult.orderNumber}
              </div>
              <div className="text-sm text-neutral-400 mt-4">Total</div>
              <div className="text-2xl font-semibold mt-1">
                {formatIDR(orderResult.totalCents)}
              </div>
            </CardContent>
          </Card>
          <div className="mt-6 flex flex-col gap-3">
            <Button
              size="lg"
              variant="primary"
              className="h-16 text-lg"
              onClick={() =>
                router.push(`/kiosk/${encodeURIComponent(orderResult.orderId)}`)
              }
            >
              📺 Lacak Pesanan
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-16 text-lg"
              onClick={resetForNewOrder}
            >
              Pesan Lagi
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center text-neutral-400 text-lg">
        Memuat menu…
      </main>
    );
  }

  if (!branch || categories.length === 0) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 text-neutral-400 text-center">
        <div>
          <p>Menu belum tersedia untuk cabang ini.</p>
          <Button
            size="lg"
            variant="outline"
            className="mt-4"
            onClick={() => router.push('/kiosk')}
          >
            Pilih cabang lain
          </Button>
        </div>
      </main>
    );
  }

  // ─── Main menu grid ─────────────────────────────────────────────────────
  return (
    <main className="min-h-screen flex flex-col bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-neutral-900 border-b border-neutral-800">
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-neutral-500">Self-Order</div>
            <div className="text-lg sm:text-xl font-semibold">{branch.name}</div>
          </div>
          <button
            type="button"
            onClick={() => setShowCart((v) => !v)}
            className="relative h-14 min-w-[120px] px-5 rounded-2xl bg-red-600 hover:bg-red-500 active:scale-95 transition-all text-white font-semibold flex items-center justify-center gap-2"
          >
            <span className="text-2xl">🛒</span>
            <span>Lihat ({totalItems})</span>
            {subtotal > 0 ? (
              <span className="absolute -top-1 -right-1 bg-yellow-400 text-black text-xs font-bold rounded-full px-2 py-0.5">
                {formatIDR(subtotal)}
              </span>
            ) : null}
          </button>
        </div>
        {/* Search */}
        <div className="px-4 pb-3">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari menu…"
            className="h-12 text-base"
          />
        </div>
        {/* Category tabs */}
        <div className="flex gap-2 overflow-x-auto px-4 pb-3">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveCategory(c.id)}
              className={cn(
                'h-10 px-4 rounded-full text-sm font-medium whitespace-nowrap transition-colors',
                activeCategory === c.id
                  ? 'bg-red-600 text-white'
                  : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700',
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      </header>

      {/* Items grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filteredCategories
            .filter((c) => !activeCategory || c.id === activeCategory)
            .flatMap((c) =>
              c.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => addToCart(item)}
                  className="text-left min-h-[180px] rounded-2xl bg-neutral-900 border border-neutral-800 hover:border-red-500 active:scale-[0.97] transition-all p-3 flex flex-col"
                >
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      className="w-full h-24 object-cover rounded-xl mb-2 bg-neutral-800"
                    />
                  ) : (
                    <div className="w-full h-24 rounded-xl mb-2 bg-neutral-800 flex items-center justify-center text-3xl">
                      🍽️
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-base truncate">{item.name}</div>
                    {item.description ? (
                      <div className="text-xs text-neutral-500 line-clamp-2 mt-0.5">
                        {item.description}
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-1 text-red-400 font-bold">
                    {formatIDR(item.priceCents)}
                  </div>
                </button>
              )),
          )}
        </div>
      </div>

      {/* Floating cart button (when not in cart view) */}
      {!showCart && totalItems > 0 ? (
        <div className="sticky bottom-0 p-4 bg-gradient-to-t from-neutral-950 via-neutral-950 to-transparent">
          <button
            type="button"
            onClick={() => setShowCart(true)}
            className="w-full h-16 rounded-2xl bg-red-600 hover:bg-red-500 active:scale-[0.99] transition-all text-white font-semibold text-lg flex items-center justify-between px-6"
          >
            <span>🛒 Lihat Pesanan ({totalItems})</span>
            <span>{formatIDR(subtotal)}</span>
          </button>
        </div>
      ) : null}

      {/* Cart drawer (full screen) */}
      {showCart ? (
        <div className="fixed inset-0 z-30 bg-neutral-950 flex flex-col">
          <header className="bg-neutral-900 border-b border-neutral-800 px-4 py-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowCart(false)}
              className="h-12 px-4 rounded-xl bg-neutral-800 text-neutral-200 active:scale-95"
            >
              ← Kembali
            </button>
            <h2 className="text-lg font-semibold">Pesanan Anda</h2>
            <div className="w-20" />
          </header>
          <div className="flex-1 overflow-y-auto p-4">
            {cart.length === 0 ? (
              <p className="text-center text-neutral-500 mt-12">Keranjang kosong</p>
            ) : (
              <div className="space-y-3">
                {cart.map((it) => (
                  <div
                    key={it.id}
                    className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{it.name}</div>
                      <div className="text-sm text-neutral-400">
                        {formatIDR(it.priceCents)} × {it.quantity}
                      </div>
                      <div className="text-sm font-semibold text-red-400 mt-1">
                        {formatIDR(it.lineTotalCents)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => changeQuantity(it.id, -1)}
                        className="h-12 w-12 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xl active:scale-95"
                      >
                        −
                      </button>
                      <span className="w-8 text-center text-lg font-semibold">
                        {it.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => changeQuantity(it.id, +1)}
                        className="h-12 w-12 rounded-xl bg-red-600 hover:bg-red-500 text-xl active:scale-95"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {cart.length > 0 ? (
            <div className="border-t border-neutral-800 p-4 bg-neutral-900 space-y-3">
              <div className="flex items-center justify-between text-xl font-bold">
                <span>Total</span>
                <span className="text-red-500">{formatIDR(subtotal)}</span>
              </div>
              <Button
                size="lg"
                variant="primary"
                disabled={checkingOut}
                onClick={handleCheckout}
                className="w-full h-16 text-lg"
              >
                {checkingOut ? 'Memproses…' : '💳 Bayar di Kasir'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
