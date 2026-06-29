'use client';

import { useState } from 'react';
import type { MenuItem, Modifier } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogClose } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { formatIDR } from '@/lib/format';
import { toast } from 'sonner';

interface Props {
  item: MenuItem | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (item: MenuItem, modifiers: Modifier[], notes?: string) => void;
}

export function ModifierModal({ item, open, onOpenChange, onConfirm }: Props) {
  const [selected, setSelected] = useState<Record<string, Modifier>>({});
  const [notes, setNotes] = useState('');

  // Reset when item changes.
  const itemId = item?.id;
  if (itemId && selected && Object.keys(selected).length > 0) {
    // don't reset here — handled by open prop changes below
  }

  // Re-init on every open.
  if (open && item && selected !== undefined) {
    // no-op: keep selection in state across renders; on close we reset.
  }

  function handleClose(v: boolean) {
    onOpenChange(v);
    if (!v) {
      setSelected({});
      setNotes('');
    }
  }

  function toggle(mod: Modifier) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[mod.id]) delete next[mod.id];
      else next[mod.id] = mod;
      return next;
    });
  }

  function confirm() {
    if (!item) return;
    const mods = Object.values(selected);
    const required = (item.modifiers || []).filter((m: any) => m.required);
    if (required.length > 0) {
      const missing = required.filter((m) => !selected[m.id]);
      if (missing.length > 0) {
        toast.error(`Pilih: ${missing.map((m) => m.name).join(', ')}`);
        return;
      }
    }
    onConfirm(item, mods, notes.trim() || undefined);
    handleClose(false);
  }

  const mods = item?.modifiers || [];
  const hasMods = mods.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        {item && (
          <>
            <DialogHeader>
              <div>
                <DialogTitle>{item.name}</DialogTitle>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
                  {formatIDR(item.priceCents)}
                </p>
              </div>
              <DialogClose />
            </DialogHeader>
            <DialogBody>
              {hasMods ? (
                <div className="space-y-2">
                  <p className="text-sm text-neutral-700 dark:text-neutral-300 font-medium">Modifiers</p>
                  <div className="grid grid-cols-1 gap-2">
                    {mods.map((m) => {
                      const active = !!selected[m.id];
                      return (
                        <button
                          type="button"
                          key={m.id}
                          onClick={() => toggle(m)}
                          className={
                            'flex items-center justify-between rounded-lg px-3 py-3 text-left text-sm transition-all duration-200 ' +
                            (active
                              ? 'bg-red-600 text-white shadow-[3px_3px_6px_var(--neo-shadow-dark),-3px_-3px_6px_var(--neo-shadow-light)]'
                              : 'bg-[var(--neo-bg)] text-[var(--foreground)] shadow-[3px_3px_6px_var(--neo-shadow-dark),-3px_-3px_6px_var(--neo-shadow-light)] hover:shadow-[4px_4px_8px_var(--neo-shadow-dark),-4px_-4px_8px_var(--neo-shadow-light)] active:shadow-[inset_3px_3px_6px_var(--neo-shadow-dark),inset_-3px_-3px_6px_var(--neo-shadow-light)]')
                          }
                        >
                          <span>{m.name}</span>
                          <span className="text-neutral-500 dark:text-neutral-400">
                            {m.priceDeltaCents > 0
                              ? `+ ${formatIDR(m.priceDeltaCents)}`
                              : m.priceDeltaCents < 0
                                ? `- ${formatIDR(Math.abs(m.priceDeltaCents))}`
                                : '—'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">Tambah ke keranjang?</p>
              )}
              <div className="space-y-1">
                <label className="text-sm text-neutral-700 dark:text-neutral-300" htmlFor="mod-notes">
                  Catatan (opsional)
                </label>
                <Textarea
                  id="mod-notes"
                  placeholder="Misal: tidak pedas, extra bawang..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Batal
              </Button>
              <Button onClick={confirm}>Tambah ke keranjang</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
