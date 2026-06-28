const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  
  const viewports = [
    { name: 'iPhone SE (375x667)', width: 375, height: 667 },
    { name: 'Laptop (1280x800)', width: 1280, height: 800 },
  ];
  
  const pages = [
    '/pos', '/pos/menu', '/pos/settings', '/pos/history', '/pos/purchase-orders',
    '/pos/inventory/adjustment', '/pos/customers', '/pos/reservations', '/pos/discounts',
    '/pos/promos', '/pos/shift', '/pos/waste', '/pos/z-report', '/pos/transfers',
    '/pos/suppliers', '/pos/prep-sheets', '/pos/settings/hardware', '/pos/accounting-export',
    '/pos/accounting/pnl', '/pos/purchase-orders/report', '/pos/purchase-orders/new',
    '/pos/menu/combos', '/pos/menu/engineering', '/pos/shifts/history', '/pos/orders/receipt',
  ];
  
  const context = await browser.newContext();
  // Login
  const loginPage = await context.newPage();
  await loginPage.goto('https://pos-uat.akhairi.com/login');
  await loginPage.fill('input[type="email"], input[name="email"]', 'owner@bkj.id');
  await loginPage.fill('input[type="password"], input[name="password"]', 'password123');
  await loginPage.click('button:has-text("Masuk")');
  await loginPage.waitForURL('**/pos', { timeout: 10000 });
  await loginPage.close();
  
  let allPassed = true;
  const failures = [];
  
  for (const vp of viewports) {
    console.log(`\n=== ${vp.name} ===`);
    const page = await context.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    
    for (const path of pages) {
      try {
        await page.goto(`https://pos-uat.akhairi.com${path}`, { waitUntil: 'networkidle', timeout: 15000 });
        const result = await page.evaluate(() => ({
          bodyScrollH: document.body.scrollHeight,
          clientH: document.documentElement.clientHeight,
          overflows: document.body.scrollHeight > document.documentElement.clientHeight + 5,
          hasHScroll: document.body.scrollWidth > document.documentElement.clientWidth + 5,
        }));
        
        if (result.overflows || result.hasHScroll) {
          const reason = result.overflows ? 'V-OVERFLOW' : 'H-OVERFLOW';
          console.log(`  ${path}: ✗ ${reason} scrollH=${result.bodyScrollH} clientH=${result.clientH}`);
          failures.push(`${vp.name} ${path}`);
          allPassed = false;
        }
      } catch (e) {
        console.log(`  ${path}: ✗ ERROR`);
        failures.push(`${vp.name} ${path} ERROR`);
        allPassed = false;
      }
    }
    await page.close();
  }
  
  await browser.close();
  console.log(allPassed ? `\n✓ ALL ${pages.length * viewports.length} PASSED` : `\n✗ FAILURES: ${failures.join(', ')}`);
  process.exit(allPassed ? 0 : 1);
})();
