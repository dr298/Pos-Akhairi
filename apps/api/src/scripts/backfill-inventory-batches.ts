// Backfill script: seed one InventoryBatch per existing InventoryItem.
// Run ONCE after the InventoryBatch table is created and before any
// FIFO consume runs. Idempotent: skips InventoryItems that already
// have at least one batch.
//
// Usage:
//   npx tsx apps/api/src/scripts/backfill-inventory-batches.ts
//
// Safe to re-run.

import { Prisma } from '@pos/db';
import { prisma } from '@pos/db';

const RECEIVED_AT_BACKDATE_DAYS = 30;

async function main() {
  // Seed default suppliers if none exist (needed for PO creation).
  const supplierCount = await prisma.supplier.count();
  if (supplierCount === 0) {
    console.log('[backfill] No suppliers — seeding 3 defaults');
    await prisma.supplier.createMany({
      data: [
        { name: 'Supplier A (Default)', contactName: 'Bpk. A', phone: '0812-0000-0001' },
        { name: 'Supplier B (Default)', contactName: 'Bpk. B', phone: '0812-0000-0002' },
        { name: 'Supplier C (Default)', contactName: 'Bpk. C', phone: '0812-0000-0003' },
      ],
    });
  }

  const items = await prisma.inventoryItem.findMany({
    where: {
      // Only seed items that don't yet have a batch.
      batches: { none: {} },
    },
  });

  if (items.length === 0) {
    console.log('[backfill] No inventory items need backfill. Done.');
    return;
  }

  console.log(`[backfill] Seeding batches for ${items.length} inventory items...`);

  const backdate = new Date();
  backdate.setDate(backdate.getDate() - RECEIVED_AT_BACKDATE_DAYS);

  let created = 0;
  for (const item of items) {
    const qty = Number(item.quantity);
    if (qty <= 0) {
      // No stock → no batch needed. Owner can receive a PO later to
      // create the first batch.
      console.log(`  - ${item.sku} (${item.name}): zero stock, skipping`);
      continue;
    }
    await prisma.inventoryBatch.create({
      data: {
        inventoryItemId: item.id,
        qtyReceived: new Prisma.Decimal(qty),
        qtyRemaining: new Prisma.Decimal(qty),
        costPerUnit: new Prisma.Decimal(item.costPerUnit),
        receivedAt: backdate,
        note: 'Migration backfill — opening balance',
      },
    });
    created += 1;
    console.log(`  ✓ ${item.sku} (${item.name}): ${qty} @ ${item.costPerUnit}/u`);
  }

  console.log(`[backfill] Done. ${created} batches created.`);

  // After seeding batches, enqueue an HPP recalc for every menu item
  // that has a recipe touching any inventory item. This refreshes
  // MenuItem.costCents to match the FIFO view (vs the legacy manual
  // value). For backfilled items with no recipes, the menu's costCents
  // is left alone — there's nothing to recalc.
  const recipes = await prisma.recipe.findMany({
    select: { menuItemId: true },
  });
  const menuIds = new Set(recipes.map((r) => r.menuItemId));
  console.log(`[backfill] Enqueuing HPP recalc for ${menuIds.size} menu items with recipes...`);
  for (const id of menuIds) {
    const { enqueueRecalcForMenuItem } = await import(
      '../services/hpp-recalculator.js'
    );
    enqueueRecalcForMenuItem(id);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill] FAILED:', err);
    process.exit(1);
  });
