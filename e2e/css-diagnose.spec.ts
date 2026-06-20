// Diagnose CSS issue
import { test, expect } from '@playwright/test';

const BASE = 'https://pos.akhairi.com';

test('CSS: check all stylesheet links load and apply', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleLogs: { type: string; text: string }[] = [];
  const networkLog: { url: string; status: number; method: string; type: string; size?: number }[] = [];

  page.on('console', (msg) => consoleLogs.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', (err) => consoleLogs.push({ type: 'pageerror', text: err.message }));
  page.on('requestfailed', (req) => consoleLogs.push({ type: 'requestfailed', text: `${req.url()} - ${req.failure()?.errorText}` }));
  page.on('response', async (res) => {
    const req = res.request();
    networkLog.push({
      url: res.url(),
      status: res.status(),
      method: req.method(),
      type: req.resourceType(),
    });
  });

  // 1. Login
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('#email').fill('owner@bkj.id');
  await page.locator('#pw').fill('password123');
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/pos/);
  await page.waitForFunction(() => {
    const t = document.body.innerText || '';
    return t.length > 80 && !t.includes('Memuat…');
  }, { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  // 2. Inspect HTML head: <link rel="stylesheet">
  const head = await page.locator('head').innerHTML();
  console.log('--- HEAD HTML ---');
  console.log(head);

  // 3. Check all CSS files
  const cssResponses = networkLog.filter((r) => r.url.includes('.css') || r.type === 'stylesheet');
  console.log('--- CSS REQUESTS ---');
  for (const r of cssResponses) {
    console.log(`  ${r.status} ${r.method} ${r.type} ${r.url}`);
  }

  // 4. Check styles applied: pick a known styled element and check computed style
  const computedStyles = await page.evaluate(() => {
    const out: Record<string, string> = {};
    const body = document.body;
    const header = document.querySelector('header');
    const nav = document.querySelector('nav');
    const button = document.querySelector('button');
    out['body.background'] = getComputedStyle(body).backgroundColor;
    out['body.color'] = getComputedStyle(body).color;
    out['body.fontFamily'] = getComputedStyle(body).fontFamily;
    if (header) {
      const h = getComputedStyle(header as Element);
      out['header.position'] = h.position;
      out['header.background'] = h.backgroundColor;
    }
    if (nav) {
      const n = getComputedStyle(nav as Element);
      out['nav.display'] = n.display;
    }
    if (button) {
      const b = getComputedStyle(button as Element);
      out['button.background'] = b.backgroundColor;
      out['button.color'] = b.color;
      out['button.border'] = b.border;
    }
    return out;
  });
  console.log('--- COMPUTED STYLES ---');
  for (const [k, v] of Object.entries(computedStyles)) {
    console.log(`  ${k}: ${v}`);
  }

  // 5. Take a screenshot for visual check
  await page.screenshot({ path: 'e2e/screenshots/css-dashboard.png', fullPage: true });

  // 6. Console + pageerror + requestfailed
  console.log('--- CONSOLE LOGS (' + consoleLogs.length + ' total) ---');
  for (const l of consoleLogs) {
    console.log(`  [${l.type}] ${l.text}`);
  }

  // 7. All 4xx/5xx network responses
  const bad = networkLog.filter((r) => r.status >= 400);
  console.log('--- BAD RESPONSES (' + bad.length + ') ---');
  for (const r of bad) {
    console.log(`  ${r.status} ${r.method} ${r.type} ${r.url}`);
  }

  await ctx.close();
});
