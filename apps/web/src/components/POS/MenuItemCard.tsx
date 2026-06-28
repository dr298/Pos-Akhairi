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
        'group relative flex flex-col text-left rounded-lg border overflow-hidden',
        // Theme-aware base surfaces (light/dark variants)
        'border-neutral-200 dark:border-neutral-800',
        'bg-white dark:bg-neutral-900',
        'hover:bg-neutral-50 dark:hover:bg-neutral-800',
        'hover:border-neutral-300 dark:hover:border-neutral-700',
        // Click feedback: scale + tint
        'active:scale-[0.96] active:bg-red-50 dark:active:bg-red-950/30',
        'transition-[transform,background-color,border-color] duration-150 ease-out',
        'min-h-[120px] p-3',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60',
        disabled && 'opacity-50 cursor-not-allowed',
        disabled && 'active:scale-100 hover:bg-white dark:hover:bg-neutral-900 hover:border-neutral-200 dark:hover:border-neutral-800',
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
        <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100 line-clamp-2">{item.displayName || item.name}</div>
        {item.sku && (
          <div className="text-[10px] text-neutral-500 mt-0.5 uppercase">{item.sku}</div>
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
