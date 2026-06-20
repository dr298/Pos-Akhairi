// Debug: why does /api/auth/me return 401 on navigation?
import { test, expect } from '@playwright/test';

const BASE = 'https://pos.akhairi.com';

test('debug: cookie + auth/me across navigation', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const log: string[] = [];
  page.on('console', (msg) => log.push(`[console:${msg.type()}] ${msg.text()}`));
  page.on('request', (req) => {
    if (req.url().includes('/api/')) {
      const cookie = req.headers().cookie || '(none)';
      log.push(`[request] ${req.method()} ${req.url()} cookie=${cookie}`);
    }
  });
  page.on('response', async (res) => {
    log.push(`[response] ${res.status()} ${res.url()}`);
    if (res.url().includes('/api/')) {
      const headers = res.headers();
      log.push(`  set-cookie: ${headers['set-cookie'] || '(none)'}`);
      const body = await res.text().catch(() => '<no body>');
      log.push(`  body: ${body.substring(0, 200)}`);
    }
  });

  // Login
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  log.push('=== LOGIN FORM ===');
  await page.locator('#email').fill('owner@bkj.id');
  await page.locator('#pw').fill('password123');

  // Set up response waiter BEFORE click
  const loginResponsePromise = page.waitForResponse(
    (r) => r.url().endsWith('/api/auth/login'),
    { timeout: 10000 }
  ).then((res) => {
    log.push(`[LOGIN RESPONSE] ${res.status()} ${res.url()}`);
    log.push(`  set-cookie: ${res.headers()['set-cookie'] || '(none)'}`);
    return res;
  });

  await page.locator('button[type=submit]').click();
  const loginResponse = await loginResponsePromise;
  log.push(`=== AFTER LOGIN RESPONSE (status ${loginResponse.status()}) ===`);

  await page.waitForURL(/\/pos/, { timeout: 10000 });
  log.push('=== URL CHANGED TO /pos ===');
  await page.waitForLoadState('networkidle');

  log.push('=== AFTER LOGIN ===');
  const cookies1 = await ctx.cookies();
  log.push(`cookies: ${JSON.stringify(cookies1)}`);

  // Navigate to /pos/chain
  log.push('=== NAV TO /pos/chain ===');
  await page.goto(`${BASE}/pos/chain`, { waitUntil: 'networkidle' });
  const cookies2 = await ctx.cookies();
  log.push(`cookies: ${JSON.stringify(cookies2)}`);
  const localStorage = await page.evaluate(() => window.localStorage.getItem('pos:authed'));
  log.push(`localStorage pos:authed: ${localStorage}`);

  for (const l of log) console.log(l);
  await ctx.close();
});
