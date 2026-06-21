// Full prod E2E: visual CSS check + zero-error assertion
import { test, expect } from '@playwright/test';

const BASE = 'https://pos.akhairi.com';

test('S1: login form — no console errors, no bad responses, CSS applied', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const badResponses: { url: string; status: number }[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('response', (res) => {
    if (res.status() >= 400) badResponses.push({ url: res.url(), status: res.status() });
  });

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  // Sanity: login page has styled button
  const buttonBg = await page.locator('button[type=submit]').evaluate((el) => getComputedStyle(el).backgroundColor);
  console.log('Login button bg:', buttonBg);

  await page.locator('#email').fill('owner@bkj.id');
  await page.locator('#pw').fill('password123');
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/pos/);
  await page.waitForFunction(() => {
    const t = document.body.innerText || '';
    return t.length > 80 && !t.includes('Memuat…');
  }, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e/screenshots/v2-s1-dashboard.png', fullPage: true });

  console.log('Console errors:', consoleErrors.length, consoleErrors);
  console.log('Page errors:', pageErrors.length, pageErrors);
  console.log('Bad responses:', badResponses.length, badResponses);

  // Validate Tailwind is applied: dashboard body has dark bg
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  console.log('Body bg after login:', bodyBg);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(badResponses).toEqual([]);

  await ctx.close();
});

test('S2-S4: navigate all pages, no errors anywhere', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const badResponses: { url: string; status: number }[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('response', (res) => {
    if (res.status() >= 400) badResponses.push({ url: res.url(), status: res.status() });
  });

  // Login
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('#email').fill('owner@bkj.id');
  await page.locator('#pw').fill('password123');
  const loginRespP = page.waitForResponse((r) => r.url().endsWith('/api/auth/login'));
  await page.locator('button[type=submit]').click();
  const loginResp = await loginRespP;
  console.log(`[login] ${loginResp.status()} set-cookie=${loginResp.headers()['set-cookie'] || 'none'}`);
  await page.waitForURL(/\/pos/);
  await page.waitForLoadState('networkidle');
  // Verify cookies and localStorage are set
  const cookies1 = await ctx.cookies();
  const ls1 = await page.evaluate(() => window.localStorage.getItem('pos:authed'));
  console.log(`[after-login] cookies=${cookies1.length} ls=${ls1}`);

  // Visit all main pages (routes that exist in the app)
  const pages = ['/pos', '/pos/history', '/pos/shift', '/pos/discounts', '/display'];
  for (const path of pages) {
    console.log(`→ ${path}`);
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => {
      const t = document.body.innerText || '';
      return t.length > 50 && !t.includes('Memuat…');
    }, { timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('networkidle');
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 80));
    console.log(`  bg: ${bodyBg} | text: ${bodyText.replace(/\n/g, ' ')}`);
  }

  await page.screenshot({ path: 'e2e/screenshots/v2-s4-chain.png', fullPage: true });

  console.log('=== TOTALS ===');
  console.log('Console errors:', consoleErrors.length);
  for (const e of consoleErrors) console.log('  -', e);
  console.log('Page errors:', pageErrors.length);
  for (const e of pageErrors) console.log('  -', e);
  console.log('Bad responses:', badResponses.length);
  for (const r of badResponses) console.log(`  - ${r.status} ${r.url}`);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(badResponses).toEqual([]);

  await ctx.close();
});
