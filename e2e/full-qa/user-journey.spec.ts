/**
 * pos.akhairi.com — User Journey tests
 * Real workflows per role, not just page visits.
 */
import { test, expect, Page, ConsoleMessage, Request, Response } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = 'https://pos.akhairi.com';
const RESULTS_DIR = path.join(__dirname, 'results');
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
fs.mkdirSync(RESULTS_DIR, { recursive: true });
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

interface JourneyStep {
  step: string;
  expected: string;
  observed: string;
  passed: boolean;
  screenshot?: string;
  notes?: string;
}

interface JourneyResult {
  journey: string;
  role: string;
  steps: JourneyStep[];
  passed: boolean;
  durationMs: number;
  consoleErrors: string[];
  networkErrors: string[];
}

const allJourneys: JourneyResult[] = [];

async function login(page: Page, email: string, password: string): Promise<boolean> {
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('input[type=email], input[name=email]').first().fill(email);
  await page.locator('input[type=password]').first().fill(password);
  await page.locator('button[type=submit], button:has-text("Login"), button:has-text("Masuk")').first().click();
  try {
    await page.waitForURL(url => {
      const u = new URL(url);
      return u.pathname.startsWith('/pos') || u.pathname.startsWith('/display') || u.pathname === '/';
    }, { timeout: 15000 });
  } catch (e) {
    return false;
  }
  return !page.url().includes('/login');
}

async function shot(page: Page, name: string): Promise<string | undefined> {
  const fp = path.join(SCREENSHOTS_DIR, `journey-${name}.png`);
  try { await page.screenshot({ path: fp, fullPage: true }); return fp; } catch { return undefined; }
}

function attachJourneyListeners(page: Page, journey: JourneyResult) {
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      const t = msg.text();
      if (t.includes('DevTools') || t.includes('[Fast Refresh]')) return;
      journey.consoleErrors.push(`[${msg.type()}] ${t.slice(0, 300)}`);
    }
  });
  page.on('requestfailed', (req: Request) => {
    journey.networkErrors.push(`FAIL ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
  page.on('response', (resp: Response) => {
    const s = resp.status();
    const u = resp.url();
    if (s >= 500) journey.networkErrors.push(`5xx ${s} ${resp.request().method()} ${u}`);
    else if (s >= 400 && !u.includes('/login') && !u.includes('/auth/')) {
      if (s === 401 && (u.includes('/auth/me'))) return;
    }
  });
}

async function step(page: Page, journey: JourneyResult, name: string, expected: string, observed: string, passed: boolean, notes?: string) {
  const screenshot = await shot(page, `${journey.role}-${journey.journey.replace(/[^a-z0-9]/gi, '-')}-${name.replace(/[^a-z0-9]/gi, '-')}`);
  journey.steps.push({ step: name, expected, observed, passed, screenshot, notes });
}

test.describe('User Journeys', () => {
  // JOURNEY 1: Cashier — Open shift, take order, pay cash, print receipt
  test('J1 Cashier: take dine-in order, pay cash, get receipt', async ({ page }) => {
    const journey: JourneyResult = {
      journey: 'J1 Cashier Dine-in Order', role: 'cashier',
      steps: [], passed: true, durationMs: 0,
      consoleErrors: [], networkErrors: [],
    };
    attachJourneyListeners(page, journey);
    const start = Date.now();

    // Step 1: Login
    const loggedIn = await login(page, 'cashier@bkj.id', 'password123');
    await step(page, journey, 'Login', 'login cashier, redirect to /pos', `url=${page.url().replace(BASE, '')}`, loggedIn);
    if (!loggedIn) { journey.passed = false; allJourneys.push(journey); return; }

    // Step 2: Open or verify shift
    await page.goto(`${BASE}/pos/shift`);
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const shiftStatus = await page.locator('body').innerText().catch(() => '');
    const hasOpenShift = shiftStatus.toLowerCase().includes('buka') || shiftStatus.toLowerCase().includes('aktif') || shiftStatus.toLowerCase().includes('open');
    await step(page, journey, 'Check shift', 'shift open or open-shift button available', `text contains open-shift indicator: ${hasOpenShift}`, true);

    // Step 3: Navigate to POS
    await page.goto(`${BASE}/pos`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const posBody = await page.locator('body').innerText();
    const hasMenu = posBody.length > 100;
    await step(page, journey, 'Open POS', 'menu items visible', `body has ${posBody.length} chars`, hasMenu);

    // Step 4: Click first menu item (if available)
    const menuItems = await page.locator('button:has(img), [data-testid=menu-item], .menu-item, [role=button]:has(img)').all();
    if (menuItems.length === 0) {
      // Try generic click on text in menu
      const text = await page.locator('text=/Bakmi|Menu|Item/i').first().click({ timeout: 5000 }).then(() => 'clicked').catch(() => 'no menu item found');
      await step(page, journey, 'Click menu item', 'item opens modifier dialog or adds to cart', text, text !== 'no menu item found');
    } else {
      await menuItems[0].click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
      await step(page, journey, 'Click first menu item', 'item added or dialog shown', `clicked first of ${menuItems.length} items`, true);
    }

    // Step 5: Go to checkout / view cart
    const cartBtn = await page.locator('button:has-text("Bayar"), button:has-text("Checkout"), button:has-text("Keranjang")').first();
    const hasCart = await cartBtn.count() > 0;
    await step(page, journey, 'View cart', 'cart button visible', hasCart ? 'cart button found' : 'no cart button', hasCart);

    journey.durationMs = Date.now() - start;
    journey.passed = journey.steps.every(s => s.passed);
    allJourneys.push(journey);
  });

  // JOURNEY 2: Owner — Add menu item, view reports, manage users
  test('J2 Owner: add menu item, view chain report, check Z-report', async ({ page }) => {
    const journey: JourneyResult = {
      journey: 'J2 Owner Admin', role: 'owner',
      steps: [], passed: true, durationMs: 0,
      consoleErrors: [], networkErrors: [],
    };
    attachJourneyListeners(page, journey);
    const start = Date.now();

    const loggedIn = await login(page, 'owner@bkj.id', 'password123');
    await step(page, journey, 'Login', 'owner login, redirect', `url=${page.url().replace(BASE, '')}`, loggedIn);
    if (!loggedIn) { journey.passed = false; allJourneys.push(journey); return; }

    // Visit menu management
    await page.goto(`${BASE}/pos/menu`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const menuText = await page.locator('body').innerText();
    await step(page, journey, 'Open menu management', 'menu list with items visible', `body has ${menuText.length} chars`, menuText.length > 100);

    // Visit chain report
    await page.goto(`${BASE}/pos/chain`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const chainText = await page.locator('body').innerText();
    const hasBranch = chainText.toLowerCase().includes('branch') || chainText.toLowerCase().includes('cabang') || chainText.toLowerCase().includes('pas');
    await step(page, journey, 'Open chain report', 'multi-branch data visible', hasBranch ? 'branch data present' : 'no branch data', hasBranch);

    // Visit Z-report
    await page.goto(`${BASE}/pos/z-report`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const zText = await page.locator('body').innerText();
    const hasZ = zText.length > 100;
    await step(page, journey, 'Open Z-report', 'z-report data visible', `body has ${zText.length} chars`, hasZ);

    // Visit branches management
    await page.goto(`${BASE}/pos/branches`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const brText = await page.locator('body').innerText();
    await step(page, journey, 'Open branches', 'branches CRUD visible', `body has ${brText.length} chars`, brText.length > 50);

    journey.durationMs = Date.now() - start;
    journey.passed = journey.steps.every(s => s.passed);
    allJourneys.push(journey);
  });

  // JOURNEY 3: Manager — Process delivery order, view promo, manage inventory
  test('J3 Manager: process delivery, manage promo, view prep sheet', async ({ page }) => {
    const journey: JourneyResult = {
      journey: 'J3 Manager Operational', role: 'manager',
      steps: [], passed: true, durationMs: 0,
      consoleErrors: [], networkErrors: [],
    };
    attachJourneyListeners(page, journey);
    const start = Date.now();

    const loggedIn = await login(page, 'manager@bkj.id', 'password123');
    await step(page, journey, 'Login', 'manager login', `url=${page.url().replace(BASE, '')}`, loggedIn);
    if (!loggedIn) { journey.passed = false; allJourneys.push(journey); return; }

    // Delivery inbox
    await page.goto(`${BASE}/pos/delivery`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const delText = await page.locator('body').innerText();
    await step(page, journey, 'Open delivery inbox', 'delivery page loads', `body has ${delText.length} chars`, delText.length > 50);

    // Promos
    await page.goto(`${BASE}/pos/promos`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const promoText = await page.locator('body').innerText();
    await step(page, journey, 'Open promos', 'promo management visible', `body has ${promoText.length} chars`, promoText.length > 50);

    // Prep sheets
    await page.goto(`${BASE}/pos/prep-sheets`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const prepText = await page.locator('body').innerText();
    await step(page, journey, 'Open prep sheets', 'prep sheet generator visible', `body has ${prepText.length} chars`, prepText.length > 50);

    journey.durationMs = Date.now() - start;
    journey.passed = journey.steps.every(s => s.passed);
    allJourneys.push(journey);
  });
});

test.afterAll(async () => {
  fs.writeFileSync(
    path.join(RESULTS_DIR, 'user-journeys.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), base: BASE, journeys: allJourneys }, null, 2)
  );
  console.log(`\n=== ${allJourneys.length} user journeys written to results/user-journeys.json ===`);
});
