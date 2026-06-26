'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Category, MenuItem } from '@/lib/api';
import { api } from '@/lib/api';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { MenuItemCard } from './MenuItemCard';
import { ModifierModal } from './ModifierModal';

interface Props {
  onAdd: (item: MenuItem, mods: { modifierId: string; nameSnapshot: string; priceDeltaCents: number }[], notes?: string) => void;
}

export function MenuGrid({ onAdd }: Props) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<string>('');
  const [search, setSearch] = useState('');
  const [modalItem, setModalItem] = useState<MenuItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const [cats, its] = await Promise.all([api.getCategories(), api.getMenuItems()]);
          if (cancelled) return;
          const activeCats = (cats.data || [])
            .filter((c) => c.isActive)
            .sort((a, b) => a.sortOrder - b.sortOrder);
          // Add ALL category at the beginning
          const allCat: Category = { id: 'all', name: 'ALL', sortOrder: -1, isActive: true };
          setCategories([allCat, ...activeCats]);
          setItems(its.data || []);
          // Default to 'all' category
          setActiveCat('all');
        } catch (e: any) {
          toast.error('Gagal memuat menu: ' + (e?.message || 'unknown'));
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []);

    const itemsByCat = useMemo(() => {
      const m = new Map<string, MenuItem[]>();
      // Initialize non-all categories to empty
      for (const c of categories) {
        if (c.id !== 'all') m.set(c.id, []);
      }
      // Populate 'all' with every active item
      m.set('all', items.filter(it => it.isActive));
      // Populate per-category
      for (const it of items) {
        if (it.isActive && m.has(it.categoryId)) m.get(it.categoryId)!.push(it);
      }
      return m;
    }, [items, categories]);

    const filteredActive = useMemo(() => {
      if (!search.trim()) return itemsByCat.get(activeCat) || [];
      const q = search.toLowerCase();
      return (itemsByCat.get(activeCat) || []).filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          (it.sku || '').toLowerCase().includes(q),
      );
    }, [search, activeCat, itemsByCat]);

  function handleClick(item: MenuItem) {
    if (item.modifiers && item.modifiers.length > 0) {
      setModalItem(item);
      setModalOpen(true);
    } else {
      onAdd(item, []);
    }
  }

  function handleModalConfirm(
    item: MenuItem,
    mods: { id: string; name: string; priceDeltaCents: number }[],
    notes?: string,
  ) {
    onAdd(
      item,
      mods.map((m) => ({ modifierId: m.id, nameSnapshot: m.name, priceDeltaCents: m.priceDeltaCents })),
      notes,
    );
    toast.success(`${item.name} ditambahkan`);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500 dark:text-neutral-400 text-sm">
        Memuat menu…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari menu…"
          className="flex h-10 w-full max-w-xs rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-red-500/60"
        />
      </div>
      <Tabs value={activeCat} onValueChange={setActiveCat} className="flex flex-col h-full">
        <TabsList className="w-fit max-w-full">
          {categories.map((c) => (
            <TabsTrigger key={c.id} value={c.id}>
              {c.name}
            </TabsTrigger>
          ))}
        </TabsList>
        {categories.map((c) => {
          const list = search
            ? c.id === activeCat
              ? filteredActive
              : []
            : c.id === activeCat
              ? filteredActive
              : itemsByCat.get(c.id) || [];
          return (
            <TabsContent key={c.id} value={c.id} className="flex-1 overflow-y-auto pt-3">
              {list.length === 0 ? (
                <div className="text-sm text-neutral-500 py-8 text-center">
                  {search ? 'Tidak ada hasil.' : 'Kategori kosong.'}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2">
                  {list.map((it) => (
                    <MenuItemCard key={it.id} item={it} onClick={handleClick} />
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      <ModifierModal
        item={modalItem}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onConfirm={handleModalConfirm}
      />
    </div>
  );
}
