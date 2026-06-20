'use client';

import { useCallback, useMemo, useState } from 'react';
import type { MenuItem, Modifier } from '@/lib/api';

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

export type OrderType = 'DINE_IN' | 'TAKEOUT' | 'DELIVERY';

export interface UseCart {
  lines: CartLine[];
  orderType: OrderType;
  tableNumber: string;
  customerName: string;
  notes: string;
  taxRateBp: number;
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
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  itemCount: number;
}

const TAX_RATE_BP_DEFAULT = 1100; // 11% — matches backend seed (taxRateBp: 1100)

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

export function useCart(): UseCart {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('DINE_IN');
  const [tableNumber, setTableNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [notes, setNotes] = useState('');

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
  }, []);

  const subtotalCents = useMemo(
    () => lines.reduce((s, l) => s + lineTotalCents(l), 0),
    [lines],
  );
  const taxRateBp = TAX_RATE_BP_DEFAULT;
  const taxCents = useMemo(
    () => Math.round((subtotalCents * taxRateBp) / 10000),
    [subtotalCents, taxRateBp],
  );
  const totalCents = subtotalCents + taxCents;
  const itemCount = useMemo(
    () => lines.reduce((s, l) => s + l.quantity, 0),
    [lines],
  );

  return {
    lines,
    orderType,
    tableNumber,
    customerName,
    notes,
    taxRateBp,
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
    subtotalCents,
    taxCents,
    totalCents,
    itemCount,
  };
}
