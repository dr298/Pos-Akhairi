/**
 * Seed: 3 users (owner/manager/cashier) only.
 *
 * Run: npm run db:seed -w @pos/db
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('[seed] starting');

  // Users (owner/manager/cashier) — password: password123
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
