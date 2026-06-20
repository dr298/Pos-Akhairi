/**
 * Seed: 1 branch (BKJ Pasar Lama), 3 users, 10 bakmie menus, 1 inventory set.
 * Run: npm run db:seed -w @pos/db
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('[seed] starting');

  // 1. Branches
  const branchCodes = [
    { code: 'BKJ-PASAR-LAMA', name: 'Bakmie Kota Juang - Pasar Lama', address: 'Jl. Pasar Lama No. 1, Tangerang', phone: '+62-21-555-0101' },
    { code: 'BKJ-CIPUTAT-01', name: 'Bakmie Kota Juang - Ciputat',    address: 'Jl. Ciputat Raya No. 50, Tangerang Selatan', phone: '+62-21-555-0102' },
  ];
  const branches = [];
  for (const b of branchCodes) {
    const branch = await prisma.branch.upsert({
      where: { code: b.code },
      update: { name: b.name, address: b.address, phone: b.phone, city: 'Tangerang', timezone: 'Asia/Jakarta' },
      create: { code: b.code, name: b.name, address: b.address, city: 'Tangerang', phone: b.phone, timezone: 'Asia/Jakarta' },
    });
    branches.push(branch);
    console.log(`[seed] branch: ${branch.code} (${branch.id})`);
  }

  // 2. Users (owner/manager/cashier/cashier2) — password: password123
  const passwordHash = await bcrypt.hash('password123', 10);
  const usersData = [
    { email: 'owner@bkj.id',   name: 'Harry (Owner)',    role: 'OWNER'   as const },
    { email: 'manager@bkj.id', name: 'Sinta (Manager)',  role: 'MANAGER' as const },
    { email: 'cashier@bkj.id',  name: 'Budi (Cashier)',   role: 'CASHIER' as const, branchCode: 'BKJ-PASAR-LAMA' },
    { email: 'cashier2@bkj.id', name: 'Andi (Cashier 2)', role: 'CASHIER' as const, branchCode: 'BKJ-CIPUTAT-01' },
  ];
  const users = [];
  for (const u of usersData) {
    const userBranch = u.branchCode
      ? branches.find(b => b.code === u.branchCode)
      : branches[0];
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, branchId: userBranch?.id, isActive: true },
      create: {
        email: u.email,
        passwordHash,
        name: u.name,
        role: u.role,
        branchId: userBranch?.id,
      },
    });
    users.push(user);
    console.log(`[seed] user: ${user.email} (${user.role}) branch=${userBranch?.code}`);
  }

  // 3. Menu categories
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

  // 4. Menus — 10 bakmie items
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

  for (const branch of branches) {
  for (const m of menusData) {
    await prisma.menuItem.upsert({
      where: { branchId_sku: { branchId: branch.id, sku: m.sku } },
      update: { name: m.name, description: m.desc, priceCents: m.price * 100, isActive: true, isAvailable: true },
      create: {
        branchId: branch.id,
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
  console.log(`[seed] menus for ${branch.code}: ${menusData.length} items`);

  // 5. Inventory — basic raw materials
  const invData = [
    { sku: 'RM-MIE',    name: 'Mie Telor',     unit: 'kg',  qty: 50,  reorder: 10, cost: 22000 },
    { sku: 'RM-AYAM',   name: 'Daging Ayam',   unit: 'kg',  qty: 20,  reorder: 5,  cost: 38000 },
    { sku: 'RM-BABI',   name: 'Daging Babi',   unit: 'kg',  qty: 10,  reorder: 3,  cost: 85000 },
    { sku: 'RM-PANGSIT',name: 'Kulit Pangsit', unit: 'pack',qty: 30,  reorder: 8,  cost: 18000 },
    { sku: 'RM-BAKSO',  name: 'Adonan Bakso',  unit: 'kg',  qty: 15,  reorder: 5,  cost: 45000 },
  ];
  for (const i of invData) {
    await prisma.inventoryItem.upsert({
      where: { branchId_sku: { branchId: branch.id, sku: i.sku } },
      update: {},
      create: {
        branchId: branch.id,
        sku: i.sku,
        name: i.name,
        unit: i.unit,
        quantity: i.qty,
        reorderPoint: i.reorder,
        costPerUnit: i.cost,
      },
    });
  }
  console.log(`[seed] inventory for ${branch.code}: ${invData.length} items`);

  // 6. Discounts (S2.5) — per branch
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
    await prisma.discount.upsert({
      where: { branchId_code: { branchId: branch.id, code: d.code } },
      update: {
        name: d.name,
        type: d.type,
        value: d.value,
        minOrderCents: d.minOrderCents,
        maxDiscountCents: d.maxDiscountCents,
        isActive: true,
      },
      create: {
        branchId: branch.id,
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
  console.log(`[seed] discounts for ${branch.code}: ${discountsData.length} items`);
  } // end for each branch

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
