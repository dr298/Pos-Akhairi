import { test, expect } from '@playwright/test';
test('basic page load', async ({ page }) => {
  await page.goto('http://127.0.0.1:4080/login');
  await expect(page).toHaveTitle(/Login/);
});
