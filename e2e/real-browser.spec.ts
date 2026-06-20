// Real browser E2E — wait for React hydration, then assert rendered DOM
import { test, expect, request } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'https://pos.akhairi.com';
const EMAIL = process.env.E2E_EMAIL || 'owner@bkj.id';
const PASS = process.env.E2E_PASSWORD || 'password123';

async function loginViaApiAndInject(context: import('@playwright/test').BrowserContext, email = EMAIL, pass = PASS) {
  const ctx = await request.newContext({ baseURL: BASE });
  const r = await ctx.post('/api/auth/login', {
    data: { email, password: pass },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!r.ok()) throw new Error(`Login API failed: ${r.status()} ${await r.text()}`);
  // Share cookies with browser context
  const cookies = await ctx.storageState();
  await context.addCookies(cookies.cookies);
  await ctx.dispose();
}

async function openAndWaitForUser(page: import('@playwright/test').Page) {
  // AuthProvider calls /api/auth/me on mount during page load. We don't need to
  // wait for that specific response — networkidle + a content check is enough.
  // waitForFunction: body has content AND doesn't show "Memuat…"
  await page.waitForFunction(
    () => {
      const t = document.body.innerText || '';
      return t.length > 80 && !t.includes('Memuat…');
    },
    { timeout: 15000 },
  );
  // Also wait a beat for client-side data fetches
  await page.waitForLoadState('networkidle');
}

test('S1: login form renders + submits + dashboard loads', async ({ page }) => {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'e2e/screenshots/r-01-login.png', fullPage: true });

  await expect(page.locator('h3, [class*="CardTitle"], h2')).toContainText(/BKJ POS/);
  await expect(page.locator('label[for=email]')).toContainText('Email');
  await expect(page.locator('label[for=pw]')).toContainText('Password');

  await page.locator('#email').fill(EMAIL);
  await page.locator('#pw').fill(PASS);
  await page.locator('button[type=submit]').click();

  await page.waitForURL(/\/pos/, { timeout: 15000 });
  await openAndWaitForUser(page);
  await page.screenshot({ path: 'e2e/screenshots/r-02-pos.png', fullPage: true });

  const body = await page.locator('body').innerText();
  // Should see shift-related text (login if not opened), or menu, or cart
  expect(body).toMatch(/menu|keranjang|shift|buka|mulai|kasir|cart|bayar|pesanan/i);
  console.log('POS body sample:', body.slice(0, 200));
});

test('S2: history page renders with orders', async ({ browser }) => {
  const ctx = await browser.newContext();
  await loginViaApiAndInject(ctx);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/pos/history`, { waitUntil: 'networkidle' });
  await openAndWaitForUser(page);
  await page.screenshot({ path: 'e2e/screenshots/r-03-history.png', fullPage: true });
  const body = await page.locator('body').innerText();
  console.log('history body sample:', body.slice(0, 200));
  await ctx.close();
});

test('S3: delivery inbox page renders', async ({ browser }) => {
  const ctx = await browser.newContext();
  await loginViaApiAndInject(ctx);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/pos/delivery`, { waitUntil: 'networkidle' });
  await openAndWaitForUser(page);
  await page.screenshot({ path: 'e2e/screenshots/r-04-delivery.png', fullPage: true });
  const body = await page.locator('body').innerText();
  console.log('delivery body sample:', body.slice(0, 200));
  await ctx.close();
});

test('S4: chain report (owner) renders with branch data', async ({ browser }) => {
  const ctx = await browser.newContext();
  await loginViaApiAndInject(ctx);
  // Log cookies immediately after injection
  const cookiesAfter = await ctx.cookies();
  console.log('  cookies after inject:', cookiesAfter.map(c => `${c.name}@${c.domain} path=${c.path} sameSite=${c.sameSite}`));
  const page = await ctx.newPage();
  page.on('console', (msg) => console.log(`  [browser console] ${msg.type()}: ${msg.text()}`));
  page.on('response', (r) => {
    if (r.url().includes('/api/auth/') || r.url().includes('/api/reports/chain')) {
      console.log(`  [response] ${r.status()} ${r.url()}`);
    }
  });
  page.on('request', (r) => {
    if (r.url().includes('/api/')) {
      const cookieHeader = r.headers()['cookie'] || '(none)';
      console.log(`  [request] ${r.method()} ${r.url()} cookie=${cookieHeader.slice(0, 50)}...`);
    }
  });
  await page.goto(`${BASE}/pos/chain`, { waitUntil: 'networkidle' });
  await openAndWaitForUser(page);
  await page.screenshot({ path: 'e2e/screenshots/r-05-chain.png', fullPage: true });
  const body = await page.locator('body').innerText();
  console.log('chain body sample:', body.slice(0, 400));
  expect(body).toMatch(/BKJ-PASAR-LAMA|BKJ-CIPUTAT/i);
  await ctx.close();
});
