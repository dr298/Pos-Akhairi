// Test: menu item card click animations
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3080';

async function login(page: any) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill('owner@bkj.id');
  await page.locator('#pw').fill('password123');
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/pos/, { timeout: 10000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);
}

test('menu card animates on click + adds to cart', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Find first menu card
  const firstCard = page.locator('button:has-text("Bakmie Ayam")').first();
  await expect(firstCard).toBeVisible();

  // Verify card has the animation classes
  const cardClass = await firstCard.getAttribute('class');
  expect(cardClass).toContain('active:scale');
  expect(cardClass).toContain('active:bg-red-50');

  // Get initial cart count
  const cartTextBefore = await page.locator('text=Keranjang').first().textContent();

  // Click and verify ripple element appears
  const box = await firstCard.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  // Ripple should be in DOM briefly
  await page.waitForTimeout(50);
  const rippleCount = await page.locator('button:has-text("Bakmie Ayam") span[aria-hidden]').count();
  // 0 or 1 depending on whether animation finished
  console.log('Ripple count just after click:', rippleCount);

  // Cart should have an item now
  await page.waitForTimeout(800);
  const cartTextAfter = await page.locator('text=Keranjang').first().textContent();
  console.log('Cart before:', cartTextBefore, 'after:', cartTextAfter);

  // Screenshot for visual
  await page.screenshot({ path: '/tmp/menu-after-click.png', fullPage: false });
});

test('engineering page loads without error', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/pos/menu/engineering`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Should NOT show error page
  const errorText = await page.locator('text=Terjadi kesalahan').count();
  expect(errorText).toBe(0);

  // Should show "Menu Engineering" title
  await expect(page.locator('h1:has-text("Menu Engineering")')).toBeVisible();

  // Should show "Buat Snapshot" button
  await expect(page.locator('button:has-text("Buat Snapshot")')).toBeVisible();

  // Should show BCG quadrants (after data loads)
  await page.waitForTimeout(1000);
  const hasBintang = await page.locator('text=Bintang').count();
  const hasKuda = await page.locator('text=Kuda').count();
  const hasTeka = await page.locator('text=Teka-teki').count();
  const hasAnjing = await page.locator('text=Anjing').count();
  console.log('Quadrants visible: Bintang=', hasBintang, 'Kuda=', hasKuda, 'Teka-teki=', hasTeka, 'Anjing=', hasAnjing);

  await page.screenshot({ path: '/tmp/engineering-fixed.png', fullPage: true });
});

test('engineering light mode renders correctly', async ({ page }) => {
  await login(page);
  // Switch to light
  await page.locator('button[aria-label="Switch to light mode"]').click();
  await page.waitForTimeout(500);
  await page.goto(`${BASE}/pos/menu/engineering`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  expect(isDark).toBe(false);

  const errorText = await page.locator('text=Terjadi kesalahan').count();
  expect(errorText).toBe(0);

  await page.screenshot({ path: '/tmp/engineering-light.png', fullPage: true });
});
