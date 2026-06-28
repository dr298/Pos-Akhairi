// e2e/debug-310.spec.ts
// Sprint 25.4 — Debug script to reproduce #310 on /pos for cashier role
// Usage: npx playwright test e2e/debug-310.spec.ts --reporter=list

import { test, expect } from '@playwright/test';

const BASE = 'https://pos-uat.akhairi.com';
const CASHIER = { email: 'cashier@bkj.id', password: 'password123' };

test('cashier login → /pos must not throw React #310', async ({ page }) => {
  // Collect console errors
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  // Collect page errors (uncaught)
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  // Login
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', CASHIER.email);
  await page.fill('input[type="password"]', CASHIER.password);
  await page.click('button[type="submit"]');

  // Wait for navigation to /pos (with a small timeout)
  try {
    await page.waitForURL('**/pos/**', { timeout: 5000 });
  } catch {
    // If it times out, we still check the current page
    console.log('Navigation to /pos timed out, checking current page');
  }

  // Wait a bit for effects to fire
  await page.waitForTimeout(3000);

  // Check for React #310 errors
  const has310 = [...consoleErrors, ...pageErrors].some(
    (e) => e.includes('#310') || e.includes('fewer hooks')
  );

  // Also check if the error boundary caught it
  const bodyText = await page.textContent('body');
  const hasErrorUI =
    bodyText?.includes('Terjadi kesalahan') ||
    bodyText?.includes('Coba lagi');

  console.log('--- DEBUG #310 ---');
  console.log('Console errors:', consoleErrors.length);
  consoleErrors.forEach((e, i) => console.log(`  [${i}]`, e.slice(0, 500)));
  console.log('Page errors:', pageErrors.length);
  pageErrors.forEach((e, i) => console.log(`  [${i}]`, e.slice(0, 500)));
  console.log('Has #310:', has310);
  console.log('Has error UI:', hasErrorUI);
  console.log('Body text snippet:', bodyText?.slice(0, 500));

  // Try to extract component stack from error boundary
  try {
    const componentStack = await page.evaluate(() => {
      // The error boundary stores the component stack
      // Look for it in the DOM or in a global
      const errDiv = document.querySelector('[data-component-stack]');
      if (errDiv) return errDiv.getAttribute('data-component-stack');
      // Also check console for the full error
      return null;
    });
    console.log('Component stack:', componentStack?.slice(0, 2000));
  } catch {}

  // Also try to evaluate the React internals
  try {
    const reactInfo = await page.evaluate(() => {
      // @ts-ignore
      const fibers = Object.values(document.querySelector('#__next')?._reactRootContainer?._internalRoot?.current?.memoizedState || {});
      return fibers.length;
    });
    console.log('React fibers:', reactInfo);
  } catch {}

  // Fail if #310 is present
  expect(has310, 'React #310 error detected').toBe(false);
  expect(hasErrorUI, 'Error boundary UI visible').toBe(false);
});
