import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4080';
const CASHIER_EMAIL = 'cashier@bkj.id';
const OWNER_EMAIL = 'owner@bkj.id';
const PASSWORD = 'password123';

async function login(page: any, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/pos/, { timeout: 15000 });
}

test.describe('POS Comprehensive E2E', () => {

  test('T01: Login → /pos redirect', async ({ page }) => {
    await login(page, CASHIER_EMAIL, PASSWORD);
    await expect(page).toHaveURL(/\/pos$/);
  });

  test('T02: /login redirects authed user to /pos', async ({ page }) => {
    await login(page, CASHIER_EMAIL, PASSWORD);
    await page.goto(`${BASE_URL}/login`);
    await expect(page).toHaveURL(/\/pos$/);
  });

  test('T03: Sidebar nav visible (Sales group)', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();
    await expect(page.locator('a[href="/pos"]')).toBeVisible();
  });

  test('T04: Nav → /pos/menu works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/menu"]');
    await expect(page).toHaveURL(/\/pos\/menu$/);
  });

  test('T05: Nav → /pos/history works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    // /pos/orders nav link redirects to /pos/history
    const histLink = page.locator('a[href="/pos/orders"], a[href="/pos/history"]').first();
    await histLink.click();
    await expect(page).toHaveURL(/\/pos\/(history|orders)/);
  });

  test('T06: Nav → /pos/customers works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/customers"]');
    await expect(page).toHaveURL(/\/pos\/customers$/);
  });

  test('T07: Nav → /pos/reservations works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/reservations"]');
    await expect(page).toHaveURL(/\/pos\/reservations$/);
  });

  test('T08: Nav → /pos/purchase-orders works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/purchase-orders"]');
    await expect(page).toHaveURL(/\/pos\/purchase-orders$/);
  });

  test('T09: Nav → /pos/suppliers works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/suppliers"]');
    await expect(page).toHaveURL(/\/pos\/suppliers$/);
  });

  test('T10: Nav → /pos/inventory/adjustment works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/inventory/adjustment"]');
    await expect(page).toHaveURL(/\/pos\/inventory\/adjustment$/);
  });

  test('T11: Nav → /pos/waste works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/waste"]');
    await expect(page).toHaveURL(/\/pos\/waste$/);
  });

  test('T12: Nav → /pos/prep-sheets works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/prep-sheets"]');
    await expect(page).toHaveURL(/\/pos\/prep-sheets$/);
  });

  test('T13: Nav → /pos/promos works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/promos"]');
    await expect(page).toHaveURL(/\/pos\/promos$/);
  });

  test('T14: Nav → /pos/discounts works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/discounts"]');
    await expect(page).toHaveURL(/\/pos\/discounts$/);
  });

  test('T15: Nav → /pos/z-report works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/z-report"]');
    await expect(page).toHaveURL(/\/pos\/z-report$/);
  });

  test('T16: Nav → /pos/accounting/pnl works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/accounting/pnl"]');
    await expect(page).toHaveURL(/\/pos\/accounting\/pnl$/);
  });

  test('T17: Nav → /pos/transfers works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/transfers"]');
    await expect(page).toHaveURL(/\/pos\/transfers$/);
  });

  test('T18: Nav → /pos/accounting-export works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/accounting-export"]');
    await expect(page).toHaveURL(/\/pos\/accounting-export$/);
  });

  test('T19: Nav → /pos/shift works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/shift"]');
    await expect(page).toHaveURL(/\/pos\/shift$/);
  });

  test('T20: Nav → /pos/shifts/history works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/shifts/history"]');
    await expect(page).toHaveURL(/\/pos\/shifts\/history$/);
  });

  test('T21: Nav → /pos/waiter works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/waiter"]');
    await expect(page).toHaveURL(/\/pos\/waiter$/);
  });

  test('T22: Nav → /pos/settings works (OWNER)', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/settings"]');
    await expect(page).toHaveURL(/\/pos\/settings$/);
    await expect(page.getByText('Identitas Bisnis')).toBeVisible();
  });

  test('T23: Nav → /pos/settings/hardware works', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/settings/hardware"]');
    await expect(page).toHaveURL(/\/pos\/settings\/hardware$/);
  });

  test('T24: /kiosk loads (public, no auth)', async ({ page }) => {
    await page.goto(`${BASE_URL}/kiosk`);
    await expect(page).toHaveURL(/\/kiosk$/);
    // Should see menu categories/items
    await page.waitForTimeout(3000);
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('T25: /display loads (public, no auth)', async ({ page }) => {
    await page.goto(`${BASE_URL}/display`);
    await expect(page).toHaveURL(/\/display$/);
    await page.waitForTimeout(3000);
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('T26: Keyboard shortcut Ctrl+R does NOT navigate', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    const url = page.url();
    await page.keyboard.down('Control');
    await page.keyboard.press('r');
    await page.keyboard.up('Control');
    // Should reload, not navigate to /pos/reservations
    await page.waitForTimeout(2000);
    // After reload, should still be on /pos (or login redirect after reload)
    const newUrl = page.url();
    expect(newUrl).not.toContain('/reservations');
  });

  test('T27: Cashier cannot see Settings nav', async ({ page }) => {
    await login(page, CASHIER_EMAIL, PASSWORD);
    const settingsLink = page.locator('a[href="/pos/settings"]');
    await expect(settingsLink).toHaveCount(0);
  });

  test('T28: Page title contains business name', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    const title = await page.title();
    expect(title).toContain('Bakmie');
  });

  test('T29: Console errors on /pos load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err: Error) => {
      errors.push(err.message);
    });
    await login(page, CASHIER_EMAIL, PASSWORD);
    await page.waitForTimeout(3000);
    // Filter out known benign errors
    const realErrors = errors.filter(e =>
      !e.includes('ResizeObserver') &&
      !e.includes('Non-Error')
    );
    expect(realErrors).toHaveLength(0);
  });

  test('T30: Menu engineering page loads', async ({ page }) => {
    await login(page, OWNER_EMAIL, PASSWORD);
    await page.click('a[href="/pos/menu/engineering"]');
    await expect(page).toHaveURL(/\/pos\/menu\/engineering$/);
  });
});
