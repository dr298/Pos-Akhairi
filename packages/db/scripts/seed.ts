/**
 * Seed: 3 users (owner/manager/cashier), 10 bakmie menus, 1 inventory set,
 * 2 discounts.
 *
 * Run: npm run db:seed -w @pos/db
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('[seed] starting');

  // 1. Users (owner/manager/cashier) — password: password123
  const passwordHash = await bcrypt.hash('password123', 10);
  const usersData = [
    { email: 'owner@bkj.id',   name: 'Harry (Owner)',   role: 'OWNER'   as const },
    { email: 'manager@bkj.id', name: 'Sinta (Manager)', role: 'MANAGER' as const },
    { email: 'cashier@bkj.id', name: 'Budi (Cashier)',  role: 'CASHIER' as const },
  ];
  for (const u of usersData) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, isActive: true },
      create: {
        email: u.email,
        passwordHash,
        name: u.name,
        role: u.role,
      },
    });
    console.log(`[seed] user: ${user.email} (${user.role})`);
  }

  // 2. Menu categories
  const categoriesData = [
    { name: 'Bakmie',     sortOrder: 1 },
    { name: 'Pangsit',    sortOrder: 2 },
    { name: 'Pelengkap',  sortOrder: 3 },
    { name: 'Minuman',    sortOrder: 4 },
  ];
  const categories: Array<{ id: string; name: string; sortOrder: number }> = [];
  for (const c of categoriesData) {
    const cat = await prisma.menuCategory.upsert({
      where: { id: `cat-${c.name.toLowerCase()}` },
      update: { sortOrder: c.sortOrder },
      create: { id: `cat-${c.name.toLowerCase()}`, name: c.name, sortOrder: c.sortOrder },
    });
    categories.push(cat);
  }
  const catBy = (n: string) => categories.find((c) => c.name === n)!;

  // 3. Menus — 10 bakmie items
  const menusData = [
    { sku: 'BKJ-001', name: 'Bakmie Ayam',          desc: 'Bakmie dengan topping ayam suwir',           price: 28000, cat: 'Bakmie'    },
    { sku: 'BKJ-002', name: 'Bakmie Babi',          desc: 'Bakmie dengan topping babi spesial',         price: 35000, cat: 'Bakmie'    },
    { sku: 'BKJ-003', name: 'Bakmie Special BKJ',   desc: 'Bakmie ayam + babi + pangsit',               price: 42000, cat: 'Bakmie'    },
    { sku: 'BKJ-004', name: 'Bakmie Polos',         desc: 'Bakmie kuah kaldu saja',                    price: 22000, cat: 'Bakmie'    },
    { sku: 'BKJ-005', name: 'Bakmie Goreng Ayam',   desc: 'Bakmie goreng dengan ayam',                 price: 30000, cat: 'Bakmie'    },
    { sku: 'BKJ-006', name: 'Pangsit Goreng (5pcs)', desc: 'Pangsit goreng renyah isi 5',              price: 22000, cat: 'Pangsit'   },
    { sku: 'BKJ-007', name: 'Pangsit Kuah (5pcs)',   desc: 'Pangsit rebus kuah kaldu, isi 5',          price: 22000, cat: 'Pangsit'   },
    { sku: 'BKJ-008', name: 'Bakso Sapi',           desc: 'Bakso urat sapi (isi 4)',                   price: 25000, cat: 'Pelengkap' },
    { sku: 'BKJ-009', name: 'Es Teh Manis',         desc: 'Teh manis dingin',                          price:  8000, cat: 'Minuman'   },
    { sku: 'BKJ-010', name: 'Es Jeruk',             desc: 'Jeruk peras dingin',                        price: 12000, cat: 'Minuman'   },
  ];

  for (const m of menusData) {
    const existing = await prisma.menuItem.findFirst({ where: { sku: m.sku } });
    if (existing) {
      await prisma.menuItem.update({
        where: { id: existing.id },
        data: { name: m.name, description: m.desc, priceCents: m.price * 100, isActive: true, isAvailable: true },
      });
    } else {
      await prisma.menuItem.create({
        data: {
          categoryId: catBy(m.cat).id,
          sku: m.sku,
          name: m.name,
          description: m.desc,
          priceCents: m.price * 100,
          costCents: Math.round(m.price * 0.35) * 100,
          taxRateBp: 1100,
        },
      });
    }
  }
  console.log(`[seed] menus: ${menusData.length} items`);

  // 4. Inventory — basic raw materials
  const invData = [
    { sku: 'RM-MIE',    name: 'Mie Telor',     unit: 'kg',  qty: 50,  reorder: 10, cost: 22000 },
    { sku: 'RM-AYAM',   name: 'Daging Ayam',   unit: 'kg',  qty: 20,  reorder: 5,  cost: 38000 },
    { sku: 'RM-BABI',   name: 'Daging Babi',   unit: 'kg',  qty: 10,  reorder: 3,  cost: 85000 },
    { sku: 'RM-PANGSIT',name: 'Kulit Pangsit', unit: 'pack',qty: 30,  reorder: 8,  cost: 18000 },
    { sku: 'RM-BAKSO',  name: 'Adonan Bakso',  unit: 'kg',  qty: 15,  reorder: 5,  cost: 45000 },
  ];
  for (const i of invData) {
    const existing = await prisma.inventoryItem.findFirst({ where: { sku: i.sku } });
    if (!existing) {
      await prisma.inventoryItem.create({
        data: {
          sku: i.sku,
          name: i.name,
          unit: i.unit,
          quantity: i.qty,
          reorderPoint: i.reorder,
          costPerUnit: i.cost,
        },
      });
    }
  }
  console.log(`[seed] inventory: ${invData.length} items`);

  // 5. Discounts (S2.5)
  const discountsData = [
    {
      code: 'WELCOME10',
      name: 'Welcome 10% off',
      type: 'PERCENTAGE' as const,
      value: 10, // 10%
      minOrderCents: 3000000, // Rp 30,000
      maxDiscountCents: 500000, // cap at Rp 5,000
      validFrom: null,
      validUntil: null,
      usageLimit: null as number | null,
    },
    {
      code: 'HEMAT5K',
      name: 'Hemat Rp 5,000',
      type: 'FIXED' as const,
      value: 500000, // Rp 5,000 in cents
      minOrderCents: 5000000, // Rp 50,000
      maxDiscountCents: null as number | null,
      validFrom: null,
      validUntil: null,
      usageLimit: null as number | null,
    },
  ];
  for (const d of discountsData) {
    const existing = await prisma.discount.findFirst({ where: { code: d.code } });
    if (existing) {
      await prisma.discount.update({
        where: { id: existing.id },
        data: {
          name: d.name,
          type: d.type,
          value: d.value,
          minOrderCents: d.minOrderCents,
          maxDiscountCents: d.maxDiscountCents,
          isActive: true,
        },
      });
    } else {
      await prisma.discount.create({
        data: {
          code: d.code,
          name: d.name,
          type: d.type,
          value: d.value,
          minOrderCents: d.minOrderCents,
          maxDiscountCents: d.maxDiscountCents,
          usageLimit: d.usageLimit,
          isActive: true,
        },
      });
    }
  }
  console.log(`[seed] discounts: ${discountsData.length} items`);

  // Sprint 13 — default global settings.
  await prisma.setting.upsert({
    where: { key: 'DEFAULT_PPN_BP' },
    create: {
      key: 'DEFAULT_PPN_BP',
      value: '0',
      description: 'Default PPN / VAT rate in basis points. 1100 = 11%, 0 = hide PPN everywhere.',
    },
    update: {},
  });

  // Sprint 14 — default printer name prefix.
  await prisma.setting.upsert({
    where: { key: 'PRINTER_NAME_PREFIX' },
    create: {
      key: 'PRINTER_NAME_PREFIX',
      value: '',
      description: 'Name prefix for the Bluetooth printer (e.g. "MTP-" or "RPP"). Empty = no filter.',
    },
    update: {},
  });

  // Sprint 15 — business identity. Real resto is "Bakmie BKJ" at
  // Jln. … Tangerang; seeded as sensible defaults the OWNER can edit
  // from /pos/settings.
  await prisma.setting.upsert({
    where: { key: 'BUSINESS_NAME' },
    create: {
      key: 'BUSINESS_NAME',
      value: 'Bakmie BKJ',
      description: 'Business name printed on receipts and shown in the POS header.',
    },
    update: {},
  });

  await prisma.setting.upsert({
    where: { key: 'BUSINESS_ADDRESS' },
    create: {
      key: 'BUSINESS_ADDRESS',
      value: 'Jl. Raya Serang No. 88, Tangerang',
      description: 'Business address printed under the business name on receipts. Empty = no address line.',
    },
    update: {},
  });

  await prisma.setting.upsert({
    where: { key: 'RECEIPT_FOOTER' },
    create: {
      key: 'RECEIPT_FOOTER',
      value: 'Terima kasih, sampai jumpa lagi!',
      description: 'Custom thank-you / closing line at the bottom of every receipt. Empty = default ("Terima kasih!").',
    },
    update: {},
  });

  // Sprint 19 — default paper width = 80mm.
  await prisma.setting.upsert({
    where: { key: 'PRINTER_PAPER_WIDTH' },
    create: {
      key: 'PRINTER_PAPER_WIDTH',
      value: '80',
      description: 'Thermal printer paper width: "58" (32 chars/line) or "80" (42 chars/line). Default 80mm.',
    },
    update: {},
  });

  console.log('[seed] settings: 6 rows');
  console.log('[seed] done');
}

main()
  .catch((e) => {
    console.error('[seed] failed', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
