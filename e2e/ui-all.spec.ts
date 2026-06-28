import { test, expect } from '@playwright/test';

test.describe('POS UI Testing', () => {

  test('Login Flow', async ({ page }) => {
    await page.goto('https://pos-uat.akhairi.com');
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'password');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*\/pos/);
  });

  test('Cart Flow', async ({ page }) => {
    await page.goto('https://pos-uat.akhairi.com');
    // Assume logged in already or handle login
    await page.click('text=Add Item');
    await expect(page.locator('.cart-item')).toBeVisible();
  });

  test('Receipt Generation', async ({ page }) => {
    await page.goto('https://pos-uat.akhairi.com/pos');
    await page.click('text=Checkout');
    await expect(page.locator('.receipt-modal')).toBeVisible();
  });

  test('Menu Management', async ({ page }) => {
    await page.goto('https://pos-uat.akhairi.com/menu');
    await page.click('text=Add Menu Item');
    await page.fill('input[name="name"]', 'New Burger');
    await page.click('text=Save');
    await expect(page.locator('text=New Burger')).toBeVisible();
  });

  test('Shift Management', async ({ page }) => {
    await page.goto('https://pos-uat.akhairi.com/shifts');
    await page.click('text=Start Shift');
    await expect(page.locator('.shift-active')).toBeVisible();
  });

  test('Shortcut (O)', async ({ page }) => {
    await page.goto('https://pos-uat.akhairi.com/pos');
    await page.keyboard.press('o');
    // Verify shortcut action, e.g., open orders list
    await expect(page.locator('.orders-list')).toBeVisible();
  });

  test('Printer UI', async ({ page }) => {
    await page.goto('https://pos-uat.akhairi.com/settings/printer');
    await expect(page.locator('.printer-status')).toBeVisible();
  });

  test('Error Boundary', async ({ page }) => {
    await page.goto('https://pos-uat.akhairi.com/non-existent-page');
    await expect(page.locator('.error-message')).toBeVisible();
  });

  test('Role-based Access (Cashier)', async ({ page }) => {
    // Assuming logged in as cashier
    await page.goto('https://pos-uat.akhairi.com/settings');
    await expect(page.locator('text=Access Denied')).toBeVisible();
  });

  test('Logout', async ({ page }) => {
    await page.goto('https://pos-uat.akhairi.com/pos');
    await page.click('text=Logout');
    await expect(page).toHaveURL(/.*\/login/);
  });

});
