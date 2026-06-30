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
        'bg-card border border-border shadow-sm',
        'hover:shadow-md hover:border-primary/30 hover:-translate-y-0.5',
        'active:scale-[0.98]',
        'transition-all duration-200 ease-out',
        'min-h-[120px] p-3',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
        disabled && 'opacity-50 cursor-not-allowed',
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
          <div className="text-[10px] text-muted-foreground mt-0.5 uppercase">{item.sku}</div>
        )}
      </div>
      <div className="relative mt-2 flex items-end justify-between gap-2">
        <div className="text-sm font-semibold text-primary">
          {formatIDR(item.priceCents)}
        </div>
        {!item.isAvailable && <Badge tone="danger">Habis</Badge>}
        {!item.isActive && <Badge tone="muted">Off</Badge>}
      </div>
    </button>
  );
}
