'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MenuItem, Modifier } from '@/lib/api';
import { api } from '@/lib/api';

// Cart line: the item the user picked + the modifier choices they made.
export interface CartLine {
  // Unique key for this line so the same menu item with different modifiers
  // shows up as a separate row.
  lineId: string;
  menuItemId: string;
  name: string;
  basePriceCents: number;
  quantity: number;
  modifiers: { modifierId: string; nameSnapshot: string; priceDeltaCents: number }[];
  notes?: string;
}

export type OrderType = 'DINE_IN' | 'TAKEOUT'; // UI types: DINE_IN | TAKEOUT (server normalizes to DINE_IN | TAKEAWAY | KIOSK)

export interface AppliedDiscount {
  code: string;
  discountId: string;
  name: string;
  discountCents: number;
  /** Subtotal BEFORE discount — used to recompute tax. */
  baseSubtotalCents: number;
}

export interface UseCart {
  lines: CartLine[];
  orderType: OrderType;
  tableNumber: string;
  customerName: string;
  notes: string;
  taxRateBp: number;
  discount: AppliedDiscount | null;
  setOrderType: (t: OrderType) => void;
  setTableNumber: (s: string) => void;
  setCustomerName: (s: string) => void;
  setNotes: (s: string) => void;
  addItem: (item: MenuItem, opts?: { modifiers?: Modifier[]; notes?: string }) => void;
  incrementLine: (lineId: string) => void;
  decrementLine: (lineId: string) => void;
  removeLine: (lineId: string) => void;
  setLineQuantity: (lineId: string, qty: number) => void;
  clear: () => void;
  setDiscount: (d: AppliedDiscount | null) => void;
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  itemCount: number;
}

const TAX_RATE_BP_DEFAULT = 0; // 0% — actual rate fetched from settings API

function lineUnitPriceCents(line: CartLine): number {
  const modSum = line.modifiers.reduce((s, m) => s + m.priceDeltaCents, 0);
  return line.basePriceCents + modSum;
}

function lineTotalCents(line: CartLine): number {
  return lineUnitPriceCents(line) * line.quantity;
}

function makeLineId(): string {
  return `l_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

// React Context so all consumers in the tree share the same cart state.
// Without this, calling useCart() in <MenuGrid> and <Cart> (siblings) created
// two independent state instances — items added via one didn't appear in the
// other. Now PosPage wraps the tree in <CartProvider> and all children call
// useCartContext() to read/write the same cart.
const CartContext = createContext<UseCart | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('DINE_IN');
  const [tableNumber, setTableNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [notes, setNotes] = useState('');
  const [discount, setDiscount] = useState<AppliedDiscount | null>(null);
  const [taxRateBp, setTaxRateBp] = useState(TAX_RATE_BP_DEFAULT);

  // Fetch PPN from settings on mount
  useEffect(() => {
    let cancelled = false;
    api.listSettings().then((res) => {
      if (cancelled) return;
      const ppn = res.data.settings.find((s) => s.key === 'DEFAULT_PPN_BP');
      if (ppn) setTaxRateBp(Number(ppn.value) || 0);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const addItem = useCallback(
    (item: MenuItem, opts?: { modifiers?: Modifier[]; notes?: string }) => {
      const mods = (opts?.modifiers || []).map((m) => ({
        modifierId: m.id,
        nameSnapshot: m.name,
        priceDeltaCents: m.priceDeltaCents,
      }));
      const line: CartLine = {
        lineId: makeLineId(),
        menuItemId: item.id,
        name: item.name,
        basePriceCents: item.priceCents,
        quantity: 1,
        modifiers: mods,
        notes: opts?.notes,
      };
      setLines((prev) => [...prev, line]);
    },
    [],
  );

  const incrementLine = useCallback((lineId: string) => {
    setLines((prev) =>
      prev.map((l) => (l.lineId === lineId ? { ...l, quantity: l.quantity + 1 } : l)),
    );
  }, []);

  const decrementLine = useCallback((lineId: string) => {
    setLines((prev) =>
      prev
        .map((l) =>
          l.lineId === lineId ? { ...l, quantity: Math.max(0, l.quantity - 1) } : l,
        )
        .filter((l) => l.quantity > 0),
    );
  }, []);

  const removeLine = useCallback((lineId: string) => {
    setLines((prev) => prev.filter((l) => l.lineId !== lineId));
  }, []);

  const setLineQuantity = useCallback((lineId: string, qty: number) => {
    setLines((prev) =>
      prev
        .map((l) =>
          l.lineId === lineId ? { ...l, quantity: Math.max(0, Math.floor(qty)) } : l,
        )
        .filter((l) => l.quantity > 0),
    );
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    setTableNumber('');
    setCustomerName('');
    setNotes('');
    setOrderType('DINE_IN');
    setDiscount(null);
  }, []);

  const subtotalCents = useMemo(
    () => lines.reduce((s, l) => s + lineTotalCents(l), 0),
    [lines],
  );
  // Tax is computed on the post-discount subtotal, matching backend behaviour
  // (total = subtotal + tax - discount, with tax = floor(subtotal*rate)).
  const discountCents = useMemo(() => {
    if (!discount) return 0;
    if (subtotalCents === 0) return 0;
    // If the cart subtotal grew past the discount's baseline, cap the
    // discount at the recorded baseSubtotal. Otherwise use the recorded value.
    return Math.min(discount.discountCents, subtotalCents);
  }, [discount, subtotalCents]);
  const discountedSubtotalCents = Math.max(0, subtotalCents - discountCents);
  const taxCents = useMemo(
    () => Math.round((discountedSubtotalCents * taxRateBp) / 10000),
    [discountedSubtotalCents, taxRateBp],
  );
  const totalCents = discountedSubtotalCents + taxCents;
  const itemCount = useMemo(
    () => lines.reduce((s, l) => s + l.quantity, 0),
    [lines],
  );

  const value: UseCart = {
    lines,
    orderType,
    tableNumber,
    customerName,
    notes,
    taxRateBp,
    discount,
    setOrderType,
    setTableNumber,
    setCustomerName,
    setNotes,
    addItem,
    incrementLine,
    decrementLine,
    removeLine,
    setLineQuantity,
    clear,
    setDiscount,
    subtotalCents,
    taxCents,
    discountCents,
    totalCents,
    itemCount,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): UseCart {
  const ctx = useContext(CartContext);
  if (!ctx) {
    // Fallback for callers that haven't been wrapped in <CartProvider> yet.
    // Most commonly: PosPage wraps the tree, so this should not trigger in
    // production. We throw a clear error so the dev sees it immediately.
    throw new Error('useCart must be used inside <CartProvider>. Wrap PosPage (or parent) in <CartProvider>.');
  }
  return ctx;
}
