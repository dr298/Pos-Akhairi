'use client';

import { useRef, useState } from 'react';
import type { MenuItem } from '@/lib/api';
import { formatIDR } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

interface Props {
  item: MenuItem;
  onClick: (item: MenuItem) => void;
}

interface Ripple {
  x: number;
  y: number;
  size: number;
  key: number;
}

export function MenuItemCard({ item, onClick }: Props) {
  const disabled = !item.isActive || !item.isAvailable;
  const ref = useRef<HTMLButtonElement>(null);
  const [ripples, setRipples] = useState<Ripple[]>([]);

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (disabled) return;

    // Spawn a ripple at the click point. Bounded to the card's max dimension
    // so it always covers the full surface from the click origin.
    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      const size = Math.max(rect.width, rect.height);
      setRipples((r) => [
        ...r,
        {
          x: e.clientX - rect.left - size / 2,
          y: e.clientY - rect.top - size / 2,
          size,
          key: Date.now(),
        },
      ]);
    }

    onClick(item);
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={cn(
        'group relative flex flex-col text-left rounded-xl overflow-hidden',
        'bg-[var(--neo-bg)]',
        // Neomorphic raised shadow
        'shadow-[4px_4px_8px_var(--neo-shadow-dark),-4px_-4px_8px_var(--neo-shadow-light)]',
        'hover:shadow-[6px_6px_12px_var(--neo-shadow-dark),-6px_-6px_12px_var(--neo-shadow-light)]',
        // Click feedback: pressed inset
        'active:shadow-[inset_4px_4px_8px_var(--neo-shadow-dark),inset_-4px_-4px_8px_var(--neo-shadow-light)] active:scale-[0.98]',
        'transition-[transform,box-shadow,background-color] duration-200 ease-out',
        'min-h-[120px] p-3',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60',
        disabled && 'opacity-50 cursor-not-allowed',
        disabled && 'active:shadow-[4px_4px_8px_var(--neo-shadow-dark),-4px_-4px_8px_var(--neo-shadow-light)] active:scale-100',
      )}
    >
      {ripples.map((r) => (
        <span
          key={r.key}
          aria-hidden
          onAnimationEnd={() =>
            setRipples((cur) => cur.filter((x) => x.key !== r.key))
          }
          className="pointer-events-none absolute rounded-full bg-red-500/25 dark:bg-red-400/25 animate-[ripple_500ms_ease-out_forwards]"
          style={{ left: r.x, top: r.y, width: r.size, height: r.size }}
        />
      ))}
      <div className="relative flex-1">
        <div className="text-sm font-medium text-[var(--foreground)] line-clamp-2">{item.displayName || item.name}</div>
        {item.sku && (
          <div className="text-[10px] text-neo-muted mt-0.5 uppercase">{item.sku}</div>
        )}
      </div>
      <div className="relative mt-2 flex items-end justify-between gap-2">
        <div className="text-sm font-semibold text-red-500 dark:text-red-400">
          {formatIDR(item.priceCents)}
        </div>
        {!item.isAvailable && <Badge tone="danger">Habis</Badge>}
        {!item.isActive && <Badge tone="muted">Off</Badge>}
      </div>
    </button>
  );
}
