// Screenshot every page in both dark and light mode
import { test } from '@playwright/test';

const BASE = 'http://localhost:3080';
const PAGES = ['/pos', '/pos/history', '/pos/shift', '/pos/menu', '/pos/discounts', '/pos/customers', '/pos/waiter', '/pos/z-report', '/pos/reservations'];

test('screenshot all pages in both themes', async ({ page }) => {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill('owner@bkj.id');
  await page.locator('#pw').fill('password123');
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/pos/, { timeout: 10000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  for (const path of PAGES) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const name = path.replace(/\//g, '_').replace(/^_/, '') || 'home';
    await page.screenshot({ path: `/tmp/theme-shots/dark-${name}.png`, fullPage: false });
  }

  // Switch to light
  await page.locator('button[aria-label="Switch to light mode"]').click();
  await page.waitForTimeout(500);

  for (const path of PAGES) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const name = path.replace(/\//g, '_').replace(/^_/, '') || 'home';
    await page.screenshot({ path: `/tmp/theme-shots/light-${name}.png`, fullPage: false });
  }
});
