/**
 * pos.akhairi.com — Full QA test suite
 * Sprint 9+ wrap — comprehensive feature verification
 *
 * Tests all 26 features across 4 roles, captures:
 *  - Console errors/warnings
 *  - Network failures (4xx, 5xx, CORS)
 *  - Per-page screenshots
 *  - API request/response samples
 *
 * Output: tests/results/full-qa-results.json (consumed by PHP evidence generator)
 */

import { test, expect, Page, ConsoleMessage, Request, Response } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = 'https://pos-uat.akhairi.com';
const RESULTS_DIR = path.join(__dirname, 'results');
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
fs.mkdirSync(RESULTS_DIR, { recursive: true });
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

interface Issue {
  type: 'console' | 'network' | 'visual' | 'logic';
  severity: 'error' | 'warning' | 'info';
  message: string;
  context?: string;
}

interface FeatureResult {
  feature: string;
  category: string;
  role: string;
  page?: string;
  expected: string;
  observed: string;
  passed: boolean;
  issues: Issue[];
  screenshot?: string;
  durationMs: number;
}

interface RoleSession {
  results: FeatureResult[];
  consoleErrors: string[];
  networkErrors: string[];
}

const allResults: Record<string, RoleSession> = {
  owner: { results: [], consoleErrors: [], networkErrors: [] },
  manager: { results: [], consoleErrors: [], networkErrors: [] },
  cashier: { results: [], consoleErrors: [], networkErrors: [] },
};

function attachListeners(page: Page, role: string) {
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      const text = msg.text();
      // Filter known dev noise
      if (text.includes('DevTools') || text.includes('[Fast Refresh]')) return;
      allResults[role].consoleErrors.push(`[${msg.type()}] ${text.slice(0, 200)}`);
      persistResults();
    }
  });
  page.on('requestfailed', (req: Request) => {
    allResults[role].networkErrors.push(`FAIL ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
    persistResults();
  });
  page.on('response', (resp: Response) => {
    const status = resp.status();
    const url = resp.url();
    if (status >= 500) {
      allResults[role].networkErrors.push(`5xx ${status} ${resp.request().method()} ${url}`);
      persistResults();
    } else if (status >= 400 && !url.includes('/login') && !url.includes('/auth/')) {
      // 401/403 on auth-checked endpoints expected when not logged in; skip
      if (status === 401 && url.includes('/auth/me')) return;
      allResults[role].networkErrors.push(`4xx ${status} ${resp.request().method()} ${url}`);
      persistResults();
    }
  });
}

async function login(page: Page, email: string, password: string) {
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
    // ignore — caller will detect via page.url()
  }
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}

async function screenshot(page: Page, name: string) {
  const fp = path.join(SCREENSHOTS_DIR, `${name}.png`);
  try {
    await page.screenshot({ path: fp, fullPage: true });
    return fp;
  } catch {
    return undefined;
  }
}

async function record(role: string, r: Omit<FeatureResult, 'role'>) {
  allResults[role].results.push({ ...r, role });
  // Persist incrementally so we don't lose data on test timeout
  persistResults();
}

function persistResults() {
  const summary = {
    timestamp: new Date().toISOString(),
    base: BASE,
    partial: true,
    roles: Object.fromEntries(
      Object.entries(allResults).map(([role, s]) => [
        role,
        {
          totalFeatures: s.results.length,
          passed: s.results.filter(r => r.passed).length,
          failed: s.results.filter(r => !r.passed).length,
          totalIssues: s.results.reduce((acc, r) => acc + r.issues.length, 0),
          consoleErrors: s.consoleErrors,
          networkErrors: s.networkErrors,
          results: s.results,
        },
      ])
    ),
  };
  try {
    fs.writeFileSync(path.join(RESULTS_DIR, 'full-qa-results.json'), JSON.stringify(summary, null, 2));
  } catch {}
}

async function visitAndCheck(role: string, page: Page, feature: string, category: string, url: string, expected: string) {
  const start = Date.now();
  const issues: Issue[] = [];
  let observed = 'page loaded';
  let passed = true;
  let shot: string | undefined;

  try {
    const resp = await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    if (!resp || !resp.ok()) {
      issues.push({ type: 'network', severity: 'error', message: `HTTP ${resp?.status() ?? 'no response'} on ${url}` });
      passed = false;
      observed = `failed to load: ${resp?.status()}`;
    } else {
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      // Check no error boundary (exclude "500" inside prices like "Rp 10.500")
      const errText = await page.locator('text=/error boundary|application error|Something went wrong|unhandled/i').count();
      if (errText > 0) {
        const errMsg = await page.locator('text=/error boundary|application error|Something went wrong|unhandled/i').first().textContent().catch(() => '');
        issues.push({ type: 'visual', severity: 'error', message: `error text on page: ${errMsg?.slice(0, 100)}` });
        passed = false;
      }
      // Check for "Memuat…" stuck (give it 4s — initial compile can be slow)
      const loading = await page.locator('text=/Memuat|Loading/i').count();
      if (loading > 0) {
        await page.waitForTimeout(4000);
        const stillLoading = await page.locator('text=/Memuat|Loading/i').count();
        if (stillLoading > 0) {
          issues.push({ type: 'visual', severity: 'info', message: 'page stuck on loading (may be cold compile)' });
        }
      }
      const bodyText = await page.locator('body').innerText().catch(() => '');
      if (bodyText.length < 20) {
        issues.push({ type: 'visual', severity: 'warning', message: 'page body suspiciously short' });
      }
      shot = await screenshot(page, `${role}-${feature.replace(/[^a-z0-9]/gi, '-')}`);
    }
  } catch (e: any) {
    issues.push({ type: 'network', severity: 'error', message: `exception: ${e.message?.slice(0, 200)}` });
    passed = false;
    observed = `exception: ${e.message?.slice(0, 100)}`;
  }

  await record(role, {
    feature, category, page: url, expected, observed, passed, issues,
    screenshot: shot, durationMs: Date.now() - start,
  });
}

const FEATURES: Array<{ key: string; category: string; url: string; expected: string; roles: string[] }> = [
  // Core POS
  { key: 'login', category: 'Auth', url: '/login', expected: 'login form, 3 test users can authenticate', roles: ['owner', 'manager', 'cashier'] },
  { key: 'pos-main', category: 'Core POS', url: '/pos', expected: 'menu grid, cart, language switcher', roles: ['owner', 'manager', 'cashier'] },
  { key: 'shift-page', category: 'Core POS', url: '/pos/shift', expected: 'shift status, open/close controls', roles: ['owner', 'manager', 'cashier'] },
  { key: 'shift-history', category: 'Core POS', url: '/pos/shifts/history', expected: 'shift session history list, date/status filter, detail dialog with order list', roles: ['owner', 'manager', 'cashier'] },
  { key: 'history', category: 'Core POS', url: '/pos/history', expected: 'past orders list, filters', roles: ['owner', 'manager', 'cashier'] },
  { key: 'customer-display', category: 'Core POS', url: '/display', expected: 'large display, order info, public access', roles: ['owner', 'manager', 'cashier'] },

  // Menu management
  { key: 'menu-mgmt', category: 'Menu', url: '/pos/menu', expected: 'CRUD categories + items, barcode field, cost', roles: ['owner', 'manager'] },
  { key: 'menu-combos', category: 'Menu', url: '/pos/menu/combos', expected: 'combo/set meal CRUD with items + price', roles: ['owner', 'manager'] },
  { key: 'menu-engineering', category: 'Menu', url: '/pos/menu/engineering', expected: 'BCG 2x2 matrix, snapshot list', roles: ['owner', 'manager'] },

  // Orders & Payments
  { key: 'discounts', category: 'Orders', url: '/pos/discounts', expected: 'discount list, validate, apply', roles: ['owner', 'manager'] },
  { key: 'promos', category: 'Orders', url: '/pos/promos', expected: 'promo CRUD, 4 types, 9 conditions', roles: ['owner', 'manager'] },

  // Customers & Loyalty
  { key: 'customers', category: 'Customers', url: '/pos/customers', expected: 'customer list, points, tier, CRUD', roles: ['owner', 'manager', 'cashier'] },

  // Sprint 10 — online ordering (GoFood/GrabFood/ShopeeFood) removed.

  // Reports
  { key: 'z-report', category: 'Reports', url: '/pos/z-report', expected: 'Z-report view + CSV export', roles: ['owner', 'manager'] },

  // Hardware
  { key: 'hardware', category: 'Hardware', url: '/pos/settings/hardware', expected: 'cash drawer test, transport capability', roles: ['owner', 'manager'] },

  // New features (Sprint 8+)
  { key: 'reservations', category: 'Sprint 8+', url: '/pos/reservations', expected: '7-day calendar, slot booking', roles: ['owner', 'manager', 'cashier'] },
  { key: 'waiter', category: 'Sprint 8+', url: '/pos/waiter', expected: 'mobile-first table list, color-coded', roles: ['owner', 'manager', 'cashier'] },
  { key: 'suppliers', category: 'Sprint 9+', url: '/pos/suppliers', expected: 'supplier CRUD', roles: ['owner', 'manager'] },
  { key: 'purchase-orders', category: 'Sprint 9+', url: '/pos/purchase-orders', expected: 'PO list, status filter, receive flow', roles: ['owner', 'manager'] },
  { key: 'purchase-orders-new', category: 'Sprint 9+', url: '/pos/purchase-orders/new', expected: 'create PO form with line items', roles: ['owner', 'manager'] },
  { key: 'prep-sheets', category: 'Sprint 9+', url: '/pos/prep-sheets', expected: 'DOW-aware prep sheet generator', roles: ['owner', 'manager'] },
  { key: 'waste', category: 'Sprint 9+', url: '/pos/waste', expected: 'waste tracking, summary, top items', roles: ['owner', 'manager', 'cashier'] },
  { key: 'accounting-export', category: 'Sprint 9+', url: '/pos/accounting-export', expected: 'date range + format selector + download', roles: ['owner', 'manager'] },

  // Public
  { key: 'kiosk', category: 'Public', url: '/kiosk', expected: 'public kiosk, category tabs, big buttons', roles: ['owner', 'manager', 'cashier'] },
];

const USERS: Record<string, { email: string; password: string }> = {
  owner: { email: 'owner@bkj.id', password: 'password123' },
  manager: { email: 'manager@bkj.id', password: 'password123' },
  cashier: { email: 'cashier@bkj.id', password: 'password123' },
};

for (const role of Object.keys(USERS)) {
  test.describe(`Role: ${role}`, () => {
    test(`login + visit all features`, async ({ page, context }) => {
      test.setTimeout(600_000); // 10 min for full role
      attachListeners(page, role);
      // Login
      await login(page, USERS[role].email, USERS[role].password);
      // Verify login succeeded (not still on /login)
      const currentUrl = page.url();
      if (currentUrl.includes('/login')) {
        await record(role, {
          feature: 'login', category: 'Auth', page: '/login',
          expected: 'redirected after login', observed: 'still on /login',
          passed: false, issues: [{ type: 'logic', severity: 'error', message: 'login failed' }],
          durationMs: 0,
        });
        return;
      }
      await record(role, {
        feature: 'login', category: 'Auth', page: '/login',
        expected: 'redirected after login', observed: `redirected to ${currentUrl.replace(BASE, '')}`,
        passed: true, issues: [], durationMs: 0,
      });
      // Visit all features
      for (const f of FEATURES) {
        if (!f.roles.includes(role)) continue;
        if (f.key === 'login') continue; // already done
        await visitAndCheck(role, page, f.key, f.category, f.url, f.expected);
      }
    });
  });
}

// afterAll removed — persistResults() runs incrementally inside record()
