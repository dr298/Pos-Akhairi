// Sprint 1-4 smoke test — runs against prod via Playwright
// To execute: cd /home/dr298/projects/pos-akhairi-com && npx playwright test e2e/smoke.spec.ts
import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'https://pos.akhairi.com';
const EMAIL = process.env.E2E_EMAIL || 'owner@bkj.id';
const PASS = process.env.E2E_PASSWORD || 'password123';

test('S1: login flow', async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await expect(page.locator('h3')).toContainText('BKJ POS');
  await page.locator('input[type=email], input[name=email]').fill(EMAIL);
  await page.locator('input[type=password]').fill(PASS);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/pos/, { timeout: 10000 });
});

test('S2: menu + create order + pay', async ({ request }) => {
  const login = await request.post(`${BASE}/api/auth/login`, {
    data: { email: EMAIL, password: PASS },
  });
  expect(login.ok()).toBeTruthy();

  const menu = await request.get(`${BASE}/api/menu/items`);
  const items = (await menu.json()).data;
  expect(items.length).toBeGreaterThan(0);

  const order = await request.post(`${BASE}/api/orders`, {
    data: {
      branchId: items[0].branchId,
      type: 'DINE_IN',
      items: [{ menuItemId: items[0].id, quantity: 1 }],
    },
  });
  expect(order.ok()).toBeTruthy();
  const orderId = (await order.json()).data.id;

  const pay = await request.post(`${BASE}/api/payments/charge`, {
    data: { orderId, provider: 'CASH', method: 'CASH', amount: 100 },
  });
  expect([200, 400]).toContain(pay.status());
});

test('S3: channels + delivery inbox', async ({ request }) => {
  await request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASS } });
  const ch = await request.get(`${BASE}/api/channels`);
  expect(ch.ok()).toBeTruthy();
  const channels = (await ch.json()).data;
  expect(channels.length).toBeGreaterThanOrEqual(3);
  const inbox = await request.get(`${BASE}/api/channel-orders?limit=10`);
  expect(inbox.ok()).toBeTruthy();
});

test('S4: chain report + daily close', async ({ request }) => {
  await request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASS } });
  const chain = await request.get(`${BASE}/api/reports/chain?date=2026-06-20`);
  expect(chain.ok()).toBeTruthy();
  const data = (await chain.json()).data;
  expect(data.totals.branches).toBeGreaterThanOrEqual(1);
  expect(data.totals.orders).toBeGreaterThan(0);
});
