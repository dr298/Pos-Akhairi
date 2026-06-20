'use client';

import type { MenuItem } from '@/lib/api';
import { formatIDR } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

interface Props {
  item: MenuItem;
  onClick: (item: MenuItem) => void;
}

export function MenuItemCard({ item, onClick }: Props) {
  const disabled = !item.isActive || !item.isAvailable;
  return (
    <button
      type="button"
      onClick={() => !disabled && onClick(item)}
      disabled={disabled}
      className={cn(
        'group relative flex flex-col text-left rounded-lg border border-neutral-800',
        'bg-neutral-900 hover:bg-neutral-800 hover:border-neutral-700 transition-colors',
        'min-h-[120px] p-3',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60',
        disabled && 'opacity-50 cursor-not-allowed hover:bg-neutral-900 hover:border-neutral-800',
      )}
    >
      <div className="flex-1">
        <div className="text-sm font-medium text-neutral-100 line-clamp-2">{item.name}</div>
        {item.sku && (
          <div className="text-[10px] text-neutral-500 mt-0.5 uppercase">{item.sku}</div>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="text-sm font-semibold text-red-400">
          {formatIDR(item.priceCents)}
        </div>
        {!item.isAvailable && <Badge tone="danger">Habis</Badge>}
        {!item.isActive && <Badge tone="muted">Off</Badge>}
      </div>
    </button>
  );
}
