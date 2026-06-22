// Quick theme test: login, verify default dark, click toggle, verify light, click back, verify dark, reload and verify persistence
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3080';

test('theme toggle works', async ({ page }) => {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  // Login first to access the POS layout (which has the theme toggle)
  await page.locator('#email').fill('owner@bkj.id');
  await page.locator('#pw').fill('password123');
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/pos/, { timeout: 10000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  // Should start in dark by default
  const isDarkInitially = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  console.log('Initial is dark:', isDarkInitially);
  expect(isDarkInitially).toBe(true);
  await page.screenshot({ path: '/tmp/theme-dark.png', fullPage: false });

  // Click theme toggle
  await page.locator('button[aria-label="Switch to light mode"]').click();
  await page.waitForTimeout(300);

  const isDarkAfter = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  console.log('After click is dark:', isDarkAfter);
  expect(isDarkAfter).toBe(false);
  await page.screenshot({ path: '/tmp/theme-light.png', fullPage: false });

  // Click again to go back
  await page.locator('button[aria-label="Switch to dark mode"]').click();
  await page.waitForTimeout(300);
  const isDarkFinal = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  console.log('After second click is dark:', isDarkFinal);
  expect(isDarkFinal).toBe(true);

  // Verify localStorage persistence
  const stored = await page.evaluate(() => localStorage.getItem('pos:theme'));
  console.log('Stored theme:', stored);
  expect(stored).toBe('dark');

  // Reload and verify persistence
  await page.reload({ waitUntil: 'domcontentloaded' });
  const isDarkAfterReload = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  expect(isDarkAfterReload).toBe(true);
  console.log('After reload is dark:', isDarkAfterReload);
});
